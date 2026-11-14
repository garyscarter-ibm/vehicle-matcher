package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;

/** The run clock: initialize, read, advance and tick. Every write is a small TransactionRunner command. */
public final class RunClock {

    /** The actor of work the clock starts itself. */
    public static final String SYSTEM_ACTOR = "system:clock";

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final long MAX_SAFE = 9_007_199_254_740_991L;
    private static final String POLICY_CODE = "clock-policy-unavailable";

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final PolicyService policy;
    private final HandlerRegistry registry;
    private final InstantSource wall;
    private final TickRunner ticks;
    private ClockResult startup;

    /** Throws IllegalArgumentException for an invalid or duplicate handler id. */
    public RunClock(DataSource dataSource, TransactionRunner runner, PolicyService policy, List<TickHandler> handlers,
            InstantSource wall) {
        this.dataSource = dataSource;
        this.runner = runner;
        this.policy = policy;
        this.registry = HandlerRegistry.of(handlers);
        this.wall = wall;
        this.ticks = new TickRunner(dataSource, runner, policy, registry);
    }

    /** Throws IllegalStateException for a handler stage the policy lacks; each tick start re-checks. */
    public void verifyHandlers(String environmentId, String runId) {
        try {
            Instant at = null;
            try (Connection c = dataSource.getConnection()) {
                ClockRows.Lookup run = ClockRows.lookup(c, environmentId, runId);
                if (run.clock() != null) at = run.clock().now();
            }
            if (at == null) at = wall.instant();
            ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, runId, at);
            if (loaded.ok()) {
                String problem = registry.firstUnknownStage(loaded.configuration().stages());
                if (problem != null) throw new IllegalStateException(problem);
            }
        } catch (SQLException e) {
            // the tick start repeats this check against the stored clock
        }
    }

    /** Creates the run's clock from the policy template and today's London date when it has none. Idempotent. */
    public ClockResult initialize(String environmentId, String runId) {
        RunContext scope = new RunContext(environmentId, runId, SYSTEM_ACTOR);
        try {
            ClockRows.Lookup run = lookup(scope);
            if (!run.exists() || !run.active()) return ClockResult.staleRun();
            if (run.clock() != null) return ClockResult.ok(initialized(runId, false));
            Instant today = wall.instant();
            ClockConfiguration.Loaded probe = ClockConfiguration.read(policy, runId, today);
            if (!probe.ok()) return ClockResult.unavailable(POLICY_CODE, probe.problem(), true);
            ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, runId, probe.configuration().startsAt());
            if (!loaded.ok()) return ClockResult.unavailable(POLICY_CODE, loaded.problem(), true);
            ClockConfiguration config = loaded.configuration();
            ScenarioClockStart.Dated dated = ScenarioClockStart.derive(config.startsAt(), config.namedTimes(), today);
            ObjectNode named = NODES.objectNode();
            dated.namedTimes().forEach((name, at) -> named.put(name, Instants.format(at)));
            ObjectNode input = NODES.objectNode().put("runId", runId);
            Outcome done = runner.execute(scope, new Command("clock.initialize", "clock:initialize:" + runId, input), tx -> {
                tx.write("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                        + "fixture_version, starts_at, named_times) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
                        + "ON CONFLICT DO NOTHING", environmentId, runId, dated.startsAt(), config.initialClockVersion(),
                        config.scenarioVersion(), config.fixtureVersion(), dated.startsAt(), named);
                return WorkResult.ok(initialized(runId, true));
            });
            return CommandOutcomes.map(done, value -> ClockResult.ok(value));
        } catch (SQLException e) {
            return databaseDown();
        }
    }

    private static ObjectNode initialized(String runId, boolean created) {
        return NODES.objectNode().put("runId", runId).put("initialized", created);
    }

    /** The clock of the run when it is the active run and has a clock row; one selected read. */
    public Optional<ClockReading> now(String environmentId, String runId) {
        try (Connection c = dataSource.getConnection()) {
            ClockRows.Lookup run = ClockRows.lookup(c, environmentId, runId);
            if (!run.active() || run.clock() == null) return Optional.empty();
            return Optional.of(new ClockReading(run.clock().now(), run.clock().clockVersion()));
        } catch (SQLException e) {
            throw new ClockUnavailableException("The run clock could not be read.", e);
        }
    }

    /** The clock with its versions, named times and last tick. */
    public ClockResult state(RunContext scope) {
        try (Connection c = dataSource.getConnection()) {
            ClockRows.Lookup run = ClockRows.lookup(c, scope.environmentId(), scope.runId());
            if (!run.exists() || !run.active()) return ClockResult.staleRun();
            if (run.clock() == null) return notInitialized();
            ObjectNode last = null;
            if (run.clock().lastTickId() != null) {
                Optional<ClockRows.Tick> tick = ClockRows.tick(c, scope.environmentId(), scope.runId(),
                        run.clock().lastTickId());
                if (tick.isEmpty()) return ClockResult.unavailable("tick-missing", "The last tick is not stored.", true);
                last = tick.get().view(scope.runId());
            }
            return ClockResult.ok(run.clock().view(scope.runId(), last));
        } catch (SQLException e) {
            return databaseDown();
        }
    }

    /** The state plus the presenter controls: policy version, step, named times and the next release cue. */
    public ClockResult controls(RunContext scope) {
        ClockResult state = state(scope);
        if (!(state instanceof ClockResult.Ok ok)) return state;
        try {
            ClockRows.Lookup run = lookup(scope);
            if (run.clock() == null) return notInitialized();
            ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, scope.runId(), run.clock().now());
            if (!loaded.ok()) return ClockResult.unavailable(POLICY_CODE, loaded.problem(), true);
            ClockConfiguration config = loaded.configuration();
            ObjectNode controls = NODES.objectNode().put("policyVersion", config.policyVersion());
            controls.putObject("step").put("value", config.stepSeconds()).put("unit", "seconds");
            ObjectNode named = controls.putObject("namedTimes");
            run.clock().namedTimes().forEach((name, at) -> named.put(name, Instants.format(at)));
            Instant release = run.clock().namedTimes().get("release");
            ObjectNode next = controls.putObject("nextRelease");
            if (release != null && release.isAfter(run.clock().now())) {
                next.put("status", "available").put("to", "release").put("at", Instants.format(release));
            } else {
                next.put("status", "unavailable").put("reason", "No future release cue is configured.");
            }
            ObjectNode value = ((ObjectNode) ok.value()).deepCopy();
            value.set("controls", controls);
            return ClockResult.ok(value);
        } catch (SQLException e) {
            return databaseDown();
        }
    }

    /** One stored tick of the run, or tick-not-found. */
    public ClockResult tickView(RunContext scope, String tickId) {
        if (!Digests.validTickId(tickId)) return ClockResult.notFound("tick-not-found", "No such tick for the active run.");
        try (Connection c = dataSource.getConnection()) {
            ClockRows.Lookup run = ClockRows.lookup(c, scope.environmentId(), scope.runId());
            if (!run.exists() || !run.active()) return ClockResult.staleRun();
            Optional<ClockRows.Tick> tick = ClockRows.tick(c, scope.environmentId(), scope.runId(), tickId);
            return tick.isEmpty() ? ClockResult.notFound("tick-not-found", "No such tick for the active run.")
                    : ClockResult.ok(tick.get().view(scope.runId()));
        } catch (SQLException e) {
            return databaseDown();
        }
    }

    /** Moves the clock forward by seconds or to a named time or UTC instant; give exactly one of the two. */
    public ClockResult advance(RunContext scope, String commandId, long expectedClockVersion, Long bySeconds, String to) {
        if (!Digests.validCommandId(commandId) || expectedClockVersion <= 0 || (bySeconds == null) == (to == null)) {
            return ClockResult.invalid("invalid-clock-command",
                    "Supply a command ID, the expected clock version and one of bySeconds or to.");
        }
        ObjectNode input = NODES.objectNode().put("expectedClockVersion", expectedClockVersion);
        if (bySeconds != null) input.put("bySeconds", bySeconds);
        else input.put("to", to);
        Outcome done = runner.execute(scope, new Command("clock.advance", "clock:advance:" + commandId, input),
                tx -> moveClock(tx, scope, expectedClockVersion, bySeconds, to, null));
        return answer(scope, done);
    }

    /** Plans, advances and ticks in one go; the plan is stored with the advance so a replay keeps its target. */
    public ClockResult presenterTick(RunContext scope, String commandId, long expectedClockVersion, PresenterMode mode,
            String to) {
        boolean modeOk = mode != null && (mode == PresenterMode.TO ? Instants.text(to, 128) : to == null);
        if (!Digests.validCommandId(commandId) || expectedClockVersion <= 0 || !modeOk) {
            return ClockResult.invalid("invalid-presenter-tick", "Supply commandId, expectedClockVersion and mode step, "
                    + "to or next-release. Only mode to accepts a named time or UTC instant.");
        }
        ClockConfiguration.Loaded loaded;
        try {
            ClockRows.Lookup run = lookup(scope);
            if (!run.exists() || !run.active()) return ClockResult.staleRun();
            if (run.clock() == null) return notInitialized();
            loaded = ClockConfiguration.read(policy, scope.runId(), run.clock().now());
        } catch (SQLException e) {
            return databaseDown();
        }
        String tickId = "presenter-" + Digests.sha256(commandId).substring(0, 32);
        ObjectNode input = NODES.objectNode().put("expectedClockVersion", expectedClockVersion).put("mode", mode.name());
        if (to != null) input.put("to", to);
        Outcome done = runner.execute(scope, new Command("clock.presenter-tick", "clock:presenter-tick:" + commandId,
                input), tx -> {
                    ObjectNode plan = NODES.objectNode().put("tickId", tickId);
                    return moveClock(tx, scope, expectedClockVersion, null, to, new Presenter(mode, loaded, plan));
                });
        ClockResult planned = answer(scope, done);
        if (!(planned instanceof ClockResult.Ok ok)) return planned;
        JsonNode advance = ok.value().get("advance");
        ClockResult ticked = ticks.run(scope, tickId, advance.get("clockVersion").asLong(), TickKind.PRESENTER);
        if (ticked instanceof ClockResult.Ok t) {
            return ClockResult.ok(NODES.objectNode().<ObjectNode>set("advance", advance).set("tick", t.value()));
        }
        ClockResult.Failure failure = (ClockResult.Failure) ticked;
        ObjectNode detail = failure.detail() instanceof ObjectNode o ? o.deepCopy() : NODES.objectNode();
        detail.set("advance", advance);
        return failure.withDetail(detail);
    }

    private record Presenter(PresenterMode mode, ClockConfiguration.Loaded loaded, ObjectNode plan) {}

    /** The shared forward move of advance and presenter-tick; a refusal writes nothing. */
    private static WorkResult moveClock(gcsp.api.persistence.Tx tx, RunContext scope, long expected, Long bySeconds,
            String to, Presenter presenter) throws SQLException {
        Optional<ClockRows.Clock> found = tx.first(ClockRows.CLOCK_SQL, ClockRows::mapClock, scope.environmentId(),
                scope.runId());
        if (found.isEmpty()) return TickRunner.refusal("unavailable", "clock-not-initialized", "The clock is unavailable.", true, null);
        ClockRows.Clock clock = found.get();
        if (clock.clockVersion() != expected) {
            return TickRunner.refusal("conflict", "stale-version", "The clock moved. Reload to see the latest.", false,
                    clock.clockVersion());
        }
        Instant target;
        if (presenter != null) {
            if (!presenter.loaded().ok()) {
                return TickRunner.refusal("unavailable", POLICY_CODE, presenter.loaded().problem(), true, null);
            }
            Instant next = presenterTarget(presenter, clock, to);
            if (next == null && presenter.mode() == PresenterMode.NEXT_RELEASE) {
                return TickRunner.refusal("unavailable", "no-future-release", "No future release cue is configured.", false, null);
            }
            target = next;
        } else if (bySeconds != null) {
            target = bySeconds > 0 && bySeconds <= Instants.MAX.getEpochSecond() - clock.now().getEpochSecond()
                    ? clock.now().plusSeconds(bySeconds) : null;
            if (target == null) return invalidTime("bySeconds", "Supply a positive integer in seconds.");
        } else {
            target = named(clock, to);
        }
        if (target == null || !target.isAfter(clock.now()) || target.isAfter(Instants.MAX)) {
            return invalidTime("to", "Time must move forward to a valid instant.");
        }
        target = target.truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        if (clock.clockVersion() >= MAX_SAFE) return TickRunner.refusal("unavailable", "clock-version-exhausted", "The clock is unavailable.", false, null);
        long version = clock.clockVersion() + 1;
        tx.cas("UPDATE run_clocks SET clock_instant = ?, clock_version = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND version = ? AND clock_version = ?", target, version,
                scope.environmentId(), scope.runId(), clock.version(), clock.clockVersion());
        ObjectNode advance = NODES.objectNode().put("runId", scope.runId()).put("now", Instants.format(target))
                .put("clockVersion", version);
        if (presenter == null) return WorkResult.ok(advance);
        presenter.plan().set("advance", advance);
        return WorkResult.ok(presenter.plan());
    }

    private static WorkResult invalidTime(String field, String reason) {
        return TickRunner.refusal("invalid", "invalid-clock-command", reason + " (" + field + ")", false, null);
    }

    private static Instant presenterTarget(Presenter presenter, ClockRows.Clock clock, String to) {
        return switch (presenter.mode()) {
            case STEP -> {
                long step = presenter.loaded().configuration().stepSeconds();
                yield step <= Instants.MAX.getEpochSecond() - clock.now().getEpochSecond()
                        ? clock.now().plusSeconds(step) : null;
            }
            case TO -> named(clock, to);
            case NEXT_RELEASE -> {
                Instant release = clock.namedTimes().get("release");
                yield release != null && release.isAfter(clock.now()) ? release : null;
            }
        };
    }

    private static Instant named(ClockRows.Clock clock, String to) {
        Instant named = clock.namedTimes().get(to);
        return named != null ? named : Instants.parse(to);
    }

    /** Runs one scoped tick for the run. */
    public ClockResult tick(RunContext scope, String tickId, long expectedClockVersion, TickKind kind) {
        return ticks.run(scope, tickId, expectedClockVersion, kind);
    }

    /** Once per process: initialize if absent, then tick the startup stages. Never throws; the result is kept. */
    public synchronized ClockResult reconcileStartup(String environmentId, String runId) {
        if (startup == null) {
            try {
                ClockResult initialized = initialize(environmentId, runId);
                if (initialized instanceof ClockResult.Failure) {
                    startup = initialized;
                } else {
                    Optional<ClockReading> reading = now(environmentId, runId);
                    startup = reading.isEmpty() ? ClockResult.staleRun()
                            : ticks.run(new RunContext(environmentId, runId, SYSTEM_ACTOR), "startup-" + UUID.randomUUID(),
                                    reading.get().clockVersion(), TickKind.STARTUP);
                }
            } catch (RuntimeException e) {
                startup = ClockResult.unavailable("startup-failed", "The startup clock pass failed: "
                        + e.getClass().getSimpleName() + ".", true);
            }
        }
        return startup;
    }

    private ClockRows.Lookup lookup(RunContext scope) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return ClockRows.lookup(c, scope.environmentId(), scope.runId());
        }
    }

    /** Maps a command outcome; a stale-version conflict also carries the clock's current version. */
    private ClockResult answer(RunContext scope, Outcome done) {
        ClockResult mapped = CommandOutcomes.map(done, value -> ClockResult.ok(value));
        if (mapped instanceof ClockResult.Failure f && "stale-version".equals(f.code()) && f.currentVersion() == null) {
            try {
                ClockRows.Lookup run = lookup(scope);
                if (run.clock() != null) return f.withCurrentVersion(run.clock().clockVersion());
            } catch (SQLException e) {
                return f;
            }
        }
        return mapped;
    }

    private static ClockResult.Failure notInitialized() {
        return ClockResult.unavailable("clock-not-initialized", "The clock is unavailable.", true);
    }

    private static ClockResult.Failure databaseDown() {
        return ClockResult.unavailable("database-unavailable", "The database could not complete the request.", true);
    }
}
