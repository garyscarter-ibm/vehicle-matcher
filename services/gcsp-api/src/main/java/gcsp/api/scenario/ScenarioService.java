package gcsp.api.scenario;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClock;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.RunReset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.Optional;
import javax.sql.DataSource;

/** The presenter's scenario controls over the demo preparation: catalogue, current scenario and run reset. */
public final class ScenarioService {

    public static final String MECHANICS_ID = "gcsp-clock-scenario-v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final DataSource dataSource;
    private final RunReset reset;
    private final RunClock clock;
    private final DemoPreparation preparation;
    private final DemoPreparationFile file;

    public ScenarioService(DataSource dataSource, RunReset reset, RunClock clock, DemoPreparation preparation,
            DemoPreparationFile file) {
        this.dataSource = dataSource;
        this.reset = reset;
        this.clock = clock;
        this.preparation = preparation;
        this.file = file;
    }

    /** The versions a reset command must carry, as the presenter last saw them. */
    public record ResetRequest(String commandId, String expectedRunId, String scenarioId, String scenarioVersion,
            String fixtureVersion, String policyVersion) {}

    public ClockResult catalogue(RunContext scope) {
        DemoPreparation.Loaded loaded = preparation.catalogue(scope);
        return loaded.ok() ? ClockResult.ok(loaded.catalogue().view()) : loaded.failure();
    }

    /** The clock state plus the scenario that prepared the active run, or null when none did. */
    public ClockResult current(RunContext scope) {
        ClockResult state = clock.state(scope);
        if (!(state instanceof ClockResult.Ok ok)) return state;
        ObjectNode value = ((ObjectNode) ok.value()).deepCopy();
        value.put("catalogueVersion", file.catalogueVersion());
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT scenario_id, scenario_version, fixture_version, "
                        + "policy_version FROM scenario_runs WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    value.putNull("currentScenario");
                } else {
                    String id = rs.getString(1);
                    value.set("currentScenario", F.objectNode().put("scenarioId", id)
                            .put("name", file.scenario(id).map(s -> s.get("name").textValue()).orElse(id))
                            .put("scenarioVersion", rs.getString(2)).put("fixtureVersion", rs.getString(3))
                            .put("policyVersion", rs.getString(4)));
                }
            }
        } catch (SQLException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not be reached.", true);
        }
        return ClockResult.ok(value);
    }

    /** Startup for demo: prepares the active run with the mechanics scenario only when it has no scenario row. */
    public ClockResult startup(String environmentId, String runId) {
        return preparation.prepare(new RunContext(environmentId, runId, DemoPreparation.ACTOR), MECHANICS_ID);
    }

    /** The newest run id a command derives, so a replay of the same command always names the same run. */
    public static String newRunId(String environmentId, String expectedRunId, String commandId) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((environmentId + ":" + expectedRunId + ":" + commandId).getBytes(StandardCharsets.UTF_8));
            return "demo-" + HexFormat.of().formatHex(hash).substring(0, 32);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public ClockResult reset(RunContext scope, ResetRequest in) {
        DemoPreparation.Loaded loaded = preparation.catalogue(scope);
        if (!loaded.ok()) return loaded.failure();
        Optional<ScenarioCatalogue.Entry> found = loaded.catalogue().find(in.scenarioId());
        if (found.isEmpty()) return ClockResult.notFound("scenario-not-found", "No such scenario.");
        ScenarioCatalogue.Entry entry = found.get();
        ClockResult.Failure stale = staleVersion("scenarioVersion", in.scenarioVersion(), entry.scenarioVersion());
        if (stale == null) stale = staleVersion("fixtureVersion", in.fixtureVersion(), entry.fixtureVersion());
        if (stale == null) stale = staleVersion("policyVersion", in.policyVersion(), entry.policyVersion());
        if (stale != null) return stale;
        if (!entry.available()) {
            ObjectNode detail = F.objectNode().put("scenarioId", entry.scenarioId());
            var list = detail.putArray("missingCapabilities");
            entry.missingCapabilities().forEach(list::add);
            return ClockResult.unavailable("scenario-not-available-yet", "not available yet", false, detail);
        }
        String newRunId = newRunId(scope.environmentId(), in.expectedRunId(), in.commandId());
        Outcome done;
        try {
            done = reset.reset(scope.environmentId(), scope.actorId(), "scenario:reset:" + in.commandId(),
                    in.expectedRunId(), newRunId);
        } catch (RuntimeException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not be reached.", true);
        }
        if (!(done instanceof Outcome.Committed committed)) return failure(done);
        String retired = committed.result().get("retiredRunId").textValue();
        String activated = committed.result().get("activatedRunId").textValue();
        ClockResult prepared = preparation.prepare(new RunContext(scope.environmentId(), activated, DemoPreparation.ACTOR),
                entry.scenarioId());
        // A replay of a reset whose run has since been replaced has nothing left to prepare.
        boolean historical = prepared instanceof ClockResult.Failure f && f.status() == ClockResult.Status.STALE_RUN
                && committed.replayed();
        if (prepared instanceof ClockResult.Failure && !historical) {
            ObjectNode detail = F.objectNode().put("runId", activated);
            return ClockResult.unavailable("scenario-preparation-incomplete",
                    "The run was reset but its preparation did not finish. Send the same reset again to finish it.", true, detail);
        }
        ObjectNode value = F.objectNode().put("retiredRunId", retired).put("activatedRunId", activated)
                .put("replayed", committed.replayed());
        value.set("scenario", entry.summary());
        JsonNode clockView = historical ? null : clockOf(scope.environmentId(), activated);
        if (clockView == null) value.putNull("clock");
        else value.set("clock", clockView);
        return ClockResult.ok(value);
    }

    private JsonNode clockOf(String environmentId, String runId) {
        ClockResult state = clock.state(new RunContext(environmentId, runId, DemoPreparation.ACTOR));
        return state instanceof ClockResult.Ok ok ? ok.value() : null;
    }

    private static ClockResult.Failure staleVersion(String field, String sent, String current) {
        if (current.equals(sent)) return null;
        ObjectNode detail = F.objectNode().put("field", field).put("expectedVersion", sent).put("currentVersion", current)
                .put("action", "refresh");
        return new ClockResult.Failure(ClockResult.Status.CONFLICT, "stale-version",
                "The scenario changed since this page loaded. Reload to see the latest.", false, null, null, detail);
    }

    /** Refusals of the reset itself; a refused reset never changes a run. */
    private static ClockResult failure(Outcome done) {
        if (done instanceof Outcome.Refused r) {
            if ("reset-not-allowed".equals(r.code()) || "reset-isolation-mismatch".equals(r.code())) {
                return ClockResult.invalid(r.code(), "Reset is not allowed on this database.");
            }
            return ClockResult.invalid(r.code(), r.message());
        }
        if (done instanceof Outcome.Conflict c) {
            if ("stale-run".equals(c.code())) return ClockResult.staleRun();
            return ClockResult.conflict(c.code(), c.message(), null);
        }
        if (done instanceof Outcome.Uncertain u) return ClockResult.uncertain(u.operationId());
        return ClockResult.unavailable("database-unavailable", "The database could not complete the request.", true);
    }
}
