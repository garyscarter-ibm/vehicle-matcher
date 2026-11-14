package gcsp.api.scenario;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockConfiguration;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClock;
import gcsp.api.clock.ScenarioClockStart;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Explicit, labelled-synthetic preparation of one run: fictional employees, their account records and entitlement
 * slots from the packaged file, then the scenario row, in one command. Existing rows are never overwritten.
 */
public final class DemoPreparation {

    public static final String ACTOR = "system:scenario";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final DateTimeFormatter ISO =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final RunClock clock;
    private final PolicyService policy;
    private final InstantSource wall;
    private final DemoPreparationFile file;

    public DemoPreparation(DataSource dataSource, TransactionRunner runner, RunClock clock, PolicyService policy,
            InstantSource wall, DemoPreparationFile file) {
        this.dataSource = dataSource;
        this.runner = runner;
        this.clock = clock;
        this.policy = policy;
        this.wall = wall;
        this.file = file;
    }

    /** The scenario id already recorded for the run, one selected read. */
    public Optional<String> existing(String environmentId, String runId) throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT scenario_id FROM scenario_runs "
                        + "WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(rs.getString(1)) : Optional.empty();
            }
        }
    }

    /** The catalogue read from the run's clock policy, or the reason it is unavailable. */
    public record Loaded(ScenarioCatalogue catalogue, ClockResult.Failure failure) {
        public boolean ok() {
            return catalogue != null;
        }
    }

    /** Versions and start come from the clock policy, so the catalogue needs no clock on the run (a reset retry relies on it). */
    public Loaded catalogue(RunContext scope) {
        Instant today = wall.instant();
        ClockConfiguration.Loaded probe = ClockConfiguration.read(policy, scope.runId(), today);
        if (probe.ok()) probe = ClockConfiguration.read(policy, scope.runId(), probe.configuration().startsAt());
        if (!probe.ok()) {
            return new Loaded(null, ClockResult.unavailable("clock-policy-unavailable", probe.problem(), true));
        }
        ClockConfiguration config = probe.configuration();
        ScenarioClockStart.Dated dated = ScenarioClockStart.derive(config.startsAt(), config.namedTimes(), today);
        ObjectNode named = F.objectNode();
        dated.namedTimes().forEach((name, at) -> named.put(name, iso(at)));
        return new Loaded(ScenarioCatalogue.build(file, config.policyVersion(), config.scenarioVersion(),
                config.fixtureVersion(), iso(dated.startsAt()), named), null);
    }

    private static String iso(Instant at) {
        return ISO.format(at.truncatedTo(ChronoUnit.MILLIS));
    }

    /**
     * Ensures the run's clock, then prepares the run once for the scenario. A run that already has a scenario row is
     * left alone, so a replay or a restart never reseeds.
     */
    public ClockResult prepare(RunContext scope, String scenarioId) {
        ClockResult started = clock.initialize(scope.environmentId(), scope.runId());
        if (started instanceof ClockResult.Failure) return started;
        try {
            if (existing(scope.environmentId(), scope.runId()).isPresent()) {
                return ClockResult.ok(F.objectNode().put("runId", scope.runId()).put("prepared", false));
            }
        } catch (SQLException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not be reached.", true);
        }
        Loaded loaded = catalogue(scope);
        if (!loaded.ok()) return loaded.failure();
        Optional<ScenarioCatalogue.Entry> entry = loaded.catalogue().find(scenarioId);
        if (entry.isEmpty()) return ClockResult.notFound("scenario-not-found", "No such scenario.");
        return write(scope.environmentId(), scope.runId(), entry.get());
    }

    private ClockResult write(String environmentId, String runId, ScenarioCatalogue.Entry scenario) {
        RunContext scope = new RunContext(environmentId, runId, ACTOR);
        ObjectNode input = F.objectNode().put("runId", runId).put("preparationVersion", file.preparationVersion());
        Outcome done = runner.execute(scope, new Command("scenario.prepare", "scenario:prepare:" + runId, input), tx -> {
            if (tx.first("SELECT 1 FROM scenario_runs WHERE environment_id = ? AND run_id = ?", rs -> 1, environmentId,
                    runId).isPresent()) {
                return WorkResult.ok(F.objectNode().put("runId", runId).put("prepared", false));
            }
            for (JsonNode p : file.principals()) insertPerson(tx, environmentId, runId, p);
            tx.write("INSERT INTO scenario_runs (environment_id, run_id, scenario_id, scenario_version, fixture_version, "
                    + "policy_version, preparation_version, state, prepared_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', now())",
                    environmentId, runId, scenario.scenarioId(), scenario.scenarioVersion(), scenario.fixtureVersion(),
                    scenario.policyVersion(), file.preparationVersion());
            return WorkResult.ok(F.objectNode().put("runId", runId).put("prepared", true));
        });
        if (done instanceof Outcome.Committed c) return ClockResult.ok(c.result());
        if (done instanceof Outcome.Conflict c && "stale-run".equals(c.code())) return ClockResult.staleRun();
        if (done instanceof Outcome.Uncertain u) return ClockResult.uncertain(u.operationId());
        return ClockResult.unavailable("scenario-preparation-failed", "The demo preparation did not complete.", true);
    }

    private static void insertPerson(gcsp.api.persistence.Tx tx, String env, String run, JsonNode p) throws SQLException {
        String id = p.get("employeeId").textValue();
        ObjectNode membership = F.objectNode();
        for (String key : new String[] {"name", "companyId", "schemeId", "gradeId", "entitlementSlotId"}) {
            membership.put(key, p.get(key).textValue());
        }
        tx.write("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, ?, ?) "
                + "ON CONFLICT DO NOTHING", env, run, id, membership);
        tx.write("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                + "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", env, run, id,
                p.get("record").get("recordSetId").textValue(), p.get("record"), p.get("recordVersion").longValue());
        for (JsonNode s : p.get("slots")) {
            tx.write("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, version) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING", env, run, s.get("slotId").textValue(), id,
                    s.get("capacity").intValue(), s.get("attributes"), s.get("version").longValue());
        }
    }
}
