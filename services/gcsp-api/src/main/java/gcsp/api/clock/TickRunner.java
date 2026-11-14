package gcsp.api.clock;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/** Plans, resumes and finishes one tick; handlers run outside any transaction. */
final class TickRunner {

    private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
    private static final String PLAN_FAILED = "A registered clock handler did not complete. Retry this tick ID.";

    private record Receipt(String digest, JsonNode outcome) {}

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final PolicyService policy;
    private final HandlerRegistry registry;

    TickRunner(DataSource dataSource, TransactionRunner runner, PolicyService policy, HandlerRegistry registry) {
        this.dataSource = dataSource;
        this.runner = runner;
        this.policy = policy;
        this.registry = registry;
    }

    ClockResult run(RunContext scope, String tickId, long expectedClockVersion, TickKind kind) {
        if (!Digests.validTickId(tickId) || expectedClockVersion <= 0 || kind == null) {
            return ClockResult.invalid("invalid-tick", "Supply a tick ID and the expected clock version.");
        }
        ObjectNode input = NODES.objectNode();
        input.put("tickId", tickId);
        input.put("expectedClockVersion", expectedClockVersion);
        input.put("kind", kind.value());
        String digest = Canonical.digest(input);
        try {
            ClockRows.Lookup run = lookup(scope);
            if (!run.exists() || !run.active()) return ClockResult.staleRun();
            if (run.clock() == null) return ClockResult.unavailable("clock-not-initialized", "The clock is unavailable.", true);
            Optional<ClockRows.Tick> stored = tick(scope, tickId);
            if (stored.isEmpty()) {
                ClockResult started = start(scope, run.clock(), tickId, expectedClockVersion, kind, digest, input);
                if (started instanceof ClockResult.Failure failure && !"tick-exists".equals(failure.code())) return failure;
                stored = tick(scope, tickId);
                if (stored.isEmpty()) return ClockResult.unavailable("tick-missing", "The tick is not stored.", true);
            }
            ClockRows.Tick row = stored.get();
            if (!row.digest().equals(digest)) {
                return ClockResult.conflict("tick-input-changed", "This tick ID was used with different input.", null);
            }
            if (row.finished()) return ClockResult.ok(row.view(scope.runId()));
            return execute(scope, row, digest);
        } catch (SQLException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not complete the request.", true);
        }
    }

    private ClockRows.Lookup lookup(RunContext scope) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return ClockRows.lookup(c, scope.environmentId(), scope.runId());
        }
    }

    private Optional<ClockRows.Tick> tick(RunContext scope, String tickId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return ClockRows.tick(c, scope.environmentId(), scope.runId(), tickId);
        }
    }

    /** Records the tick row with its handler order from the registered handlers and the clock's policy. */
    private ClockResult start(RunContext scope, ClockRows.Clock clock, String tickId, long expected, TickKind kind,
            String digest, ObjectNode input) {
        ClockConfiguration config = null;
        if (clock.clockVersion() == expected) {
            ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, scope.runId(), clock.now());
            if (!loaded.ok()) return ClockResult.unavailable("clock-policy-unavailable", loaded.problem(), true);
            config = loaded.configuration();
            String unknown = registry.firstUnknownStage(config.stages());
            if (unknown != null) return ClockResult.unavailable("handler-stage-unknown", unknown, false);
        }
        ClockConfiguration plan = config;
        Outcome outcome = runner.execute(scope, new Command("clock.tick.start", "clock:tick:start:" + tickId, input), tx -> {
            Optional<ClockRows.Clock> current = tx.first(ClockRows.CLOCK_SQL, ClockRows::mapClock,
                    scope.environmentId(), scope.runId());
            if (current.isEmpty()) {
                return refusal("unavailable", "clock-not-initialized", "The clock is unavailable.", true, null);
            }
            ClockRows.Clock now = current.get();
            if (now.clockVersion() != expected || plan == null) {
                return refusal("conflict", "stale-version", "The clock moved. Reload to see the latest.", false,
                        now.clockVersion());
            }
            List<String> stages = plan.stagesFor(kind);
            List<TickHandler> order = registry.order(plan.stages(), stages);
            ArrayNode handlerOrder = NODES.arrayNode();
            order.forEach(h -> handlerOrder.addObject().put("handlerId", h.handlerId()).put("stage", h.stage()));
            ArrayNode missing = NODES.arrayNode();
            stages.stream().filter(s -> order.stream().noneMatch(h -> h.stage().equals(s))).forEach(missing::add);
            tx.write("INSERT INTO clock_ticks (environment_id, run_id, tick_id, kind, input_digest, target_now, "
                    + "target_clock_version, policy_version, handler_order, missing_stages, outcomes, state) "
                    + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]'::jsonb, 'running')", scope.environmentId(),
                    scope.runId(), tickId, kind.value(), digest, now.now(), now.clockVersion(), plan.policyVersion(),
                    handlerOrder, missing);
            tx.cas("UPDATE run_clocks SET last_tick_id = ?, version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND version = ? AND clock_version = ?", tickId,
                    scope.environmentId(), scope.runId(), now.version(), now.clockVersion());
            return WorkResult.ok(NODES.objectNode().put("tickId", tickId));
        });
        if (outcome instanceof Outcome.Conflict c && "duplicate-record".equals(c.code())) {
            return ClockResult.conflict("tick-exists", "The tick is already stored.", null);
        }
        ClockResult mapped = CommandOutcomes.map(outcome, value -> ClockResult.ok(value));
        return mapped instanceof ClockResult.Failure failure ? withCurrent(scope, failure) : mapped;
    }

    // Two deliveries of one unfinished tick may both call a handler; handlers own idempotency via operationId.
    private ClockResult execute(RunContext scope, ClockRows.Tick row, String digest) throws SQLException {
        Map<String, Receipt> receipts = receipts(scope, row.tickId());
        ArrayNode order = row.handlerOrder();
        for (JsonNode entry : order) {
            String handlerId = entry.get("handlerId").textValue();
            String handlerDigest = Canonical.digest(NODES.arrayNode().add(digest).add(entry));
            Receipt receipt = receipts.get(handlerId);
            if (receipt != null) {
                if (!receipt.digest().equals(handlerDigest)) {
                    return ClockResult.conflict("tick-input-changed", "This tick ID was used with different input.", null);
                }
                continue;
            }
            ClockResult handled = callHandler(scope, row, entry, handlerDigest);
            if (handled instanceof ClockResult.Failure failure) return failure;
        }
        return finish(scope, row, digest);
    }

    private ClockResult callHandler(RunContext scope, ClockRows.Tick row, JsonNode entry, String handlerDigest)
            throws SQLException {
        String handlerId = entry.get("handlerId").textValue();
        ObjectNode failure = failure("unavailable", "handler-not-registered", true);
        TickHandler handler = registry.find(handlerId);
        if (handler == null || !handler.stage().equals(entry.get("stage").textValue())) {
            return interrupt(scope, row, entry, failure);
        }
        ClockRows.Lookup run = lookup(scope);
        if (!run.exists() || !run.active()) return ClockResult.staleRun();
        String operationId = "clock:tick:handler:" + Canonical.digest(NODES.arrayNode().add(row.tickId()).add(handlerId));
        HandlerOutcome result;
        try {
            result = handler.handle(new TickRequest(scope, row.tickId(), row.now(), row.clockVersion(),
                    row.policyVersion(), operationId, row.kind()));
        } catch (Exception e) {
            ObjectNode threw = failure("unavailable", "handler-threw", true);
            threw.put("exception", e.getClass().getSimpleName());
            return interrupt(scope, row, entry, threw);
        }
        ObjectNode outcome = outcomeJson(result);
        if (outcome == null) return interrupt(scope, row, entry, failure("unavailable", "handler-outcome-invalid", true));
        if (!"ok".equals(outcome.path("status").asText()) && !"pending".equals(outcome.path("status").asText())) {
            if ("stale-run".equals(outcome.path("status").asText())) return ClockResult.staleRun();
            return interrupt(scope, row, entry, outcome);
        }
        return recordReceipt(scope, row.tickId(), entry, handlerDigest, outcome);
    }

    private static ObjectNode failure(String status, String code, boolean retryable) {
        ObjectNode out = NODES.objectNode();
        out.put("status", status);
        out.put("code", code);
        out.put("retryable", retryable);
        return out;
    }

    /** The stored outcome form, or null for an invalid result. */
    private static ObjectNode outcomeJson(HandlerOutcome result) {
        if (result instanceof HandlerOutcome.Ok ok) {
            ObjectNode out = NODES.objectNode();
            out.put("status", "ok");
            out.set("value", ok.value().deepCopy());
            return out;
        }
        if (result instanceof HandlerOutcome.Pending p) {
            if (!Instants.text(p.operationId(), 512) || !Instants.text(p.operationType(), 128)
                    || !Instants.text(p.lastKnownState(), 128)) {
                return null;
            }
            ObjectNode out = NODES.objectNode();
            out.put("status", "pending");
            out.put("operationId", p.operationId());
            out.put("operationType", p.operationType());
            out.put("lastKnownState", p.lastKnownState());
            return out;
        }
        if (result instanceof HandlerOutcome.Failed f) {
            if (!Instants.text(f.status(), 64) || !Instants.text(f.code(), 128)) return null;
            return failure(f.status(), f.code(), f.retryable());
        }
        return null;
    }

    private Map<String, Receipt> receipts(RunContext scope, String tickId) throws SQLException {
        Map<String, Receipt> out = new HashMap<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(ClockRows.RECEIPTS_SQL)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, tickId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), new Receipt(rs.getString(2), ClockRows.json(rs.getString(4))));
            }
        }
        return out;
    }

    /** Writes the handler receipt and replaces that handler's entry in the tick's outcomes, in one command. */
    private ClockResult recordReceipt(RunContext scope, String tickId, JsonNode entry, String handlerDigest, JsonNode outcome) {
        String handlerId = entry.get("handlerId").textValue();
        ObjectNode input = NODES.objectNode();
        input.put("tickId", tickId);
        input.put("handlerId", handlerId);
        input.put("digest", handlerDigest);
        String commandId = "clock:tick:receipt:" + Canonical.digest(NODES.arrayNode().add(tickId).add(handlerId));
        Outcome done = runner.execute(scope, new Command("clock.tick.receipt", commandId, input), tx -> {
            Optional<ClockRows.Tick> found = tx.first(ClockRows.TICK_SQL, ClockRows::mapTick, scope.environmentId(),
                    scope.runId(), tickId);
            if (found.isEmpty()) return refusal("not-found", "tick-missing", "The tick is not stored.", false, null);
            ClockRows.Tick tick = found.get();
            String state = "pending".equals(outcome.path("status").asText()) ? "pending" : "completed";
            int added = tx.write("INSERT INTO clock_handler_receipts (environment_id, run_id, tick_id, handler_id, "
                    + "input_digest, state, outcome) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                    scope.environmentId(), scope.runId(), tickId, handlerId, handlerDigest, state, outcome);
            JsonNode kept = outcome;
            if (added == 0) {
                Optional<Receipt> existing = tx.first("SELECT input_digest, outcome::text FROM clock_handler_receipts "
                        + "WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND handler_id = ?",
                        rs -> new Receipt(rs.getString(1), ClockRows.json(rs.getString(2))), scope.environmentId(),
                        scope.runId(), tickId, handlerId);
                if (existing.isEmpty() || !existing.get().digest().equals(handlerDigest)) {
                    return refusal("conflict", "tick-input-changed", "This tick ID was used with different input.", false, null);
                }
                kept = existing.get().outcome();
            }
            if (tick.finished()) return WorkResult.ok(NODES.objectNode().set("outcome", kept));
            ArrayNode outcomes = replaceEntry(tick.outcomes(), entry, kept);
            tx.cas("UPDATE clock_ticks SET outcomes = ?, state = 'running', version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND version = ?", outcomes,
                    scope.environmentId(), scope.runId(), tickId, tick.version());
            return WorkResult.ok(NODES.objectNode().set("outcome", kept));
        });
        ClockResult mapped = CommandOutcomes.map(done, ClockResult::ok);
        return mapped instanceof ClockResult.Failure failure ? failure : mapped;
    }

    private static ArrayNode replaceEntry(ArrayNode outcomes, JsonNode entry, JsonNode outcome) {
        ArrayNode out = NODES.arrayNode();
        String handlerId = entry.get("handlerId").textValue();
        for (JsonNode existing : outcomes) {
            if (!handlerId.equals(existing.path("handlerId").asText())) out.add(existing);
        }
        ObjectNode replaced = NODES.objectNode();
        replaced.put("handlerId", handlerId);
        replaced.put("stage", entry.get("stage").textValue());
        replaced.set("outcome", outcome);
        out.add(replaced);
        return out;
    }

    private ClockResult interrupt(RunContext scope, ClockRows.Tick row, JsonNode entry, ObjectNode outcome) {
        String handlerId = entry.get("handlerId").textValue();
        ObjectNode input = NODES.objectNode();
        input.put("tickId", row.tickId());
        input.put("handlerId", handlerId);
        input.set("outcome", outcome);
        String commandId = "clock:tick:interrupt:" + Canonical.digest(input);
        Outcome done = runner.execute(scope, new Command("clock.tick.interrupt", commandId, input), tx -> {
            Optional<ClockRows.Tick> found = tx.first(ClockRows.TICK_SQL, ClockRows::mapTick, scope.environmentId(),
                    scope.runId(), row.tickId());
            if (found.isEmpty() || found.get().finished()) return WorkResult.ok(NODES.objectNode());
            tx.cas("UPDATE clock_ticks SET outcomes = ?, state = 'interrupted', version = version + 1, "
                    + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND version = ?",
                    replaceEntry(found.get().outcomes(), entry, outcome), scope.environmentId(), scope.runId(),
                    row.tickId(), found.get().version());
            return WorkResult.ok(NODES.objectNode());
        });
        if (!(done instanceof Outcome.Committed)) return CommandOutcomes.failure(done);
        ObjectNode detail = NODES.objectNode();
        detail.put("tickId", row.tickId());
        detail.put("handlerId", handlerId);
        detail.set("handlerOutcome", outcome);
        return ClockResult.unavailable("handler-interrupted", PLAN_FAILED, true, detail);
    }

    private ClockResult finish(RunContext scope, ClockRows.Tick row, String digest) {
        ObjectNode input = NODES.objectNode();
        input.put("tickId", row.tickId());
        input.put("digest", digest);
        Outcome done = runner.execute(scope, new Command("clock.tick.finish", "clock:tick:finish:" + row.tickId(), input),
                tx -> {
                    Optional<ClockRows.Tick> found = tx.first(ClockRows.TICK_SQL, ClockRows::mapTick,
                            scope.environmentId(), scope.runId(), row.tickId());
                    if (found.isEmpty()) return refusal("not-found", "tick-missing", "The tick is not stored.", false, null);
                    ClockRows.Tick tick = found.get();
                    if (tick.finished()) return WorkResult.ok(tick.view(scope.runId()));
                    boolean pending = false;
                    for (JsonNode o : tick.outcomes()) pending |= "pending".equals(o.path("outcome").path("status").asText());
                    String state = pending ? "pending" : "completed";
                    tx.cas("UPDATE clock_ticks SET state = ?, version = version + 1, updated_at = now() "
                            + "WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND version = ?", state,
                            scope.environmentId(), scope.runId(), row.tickId(), tick.version());
                    ObjectNode view = tick.view(scope.runId());
                    view.put("state", state);
                    return WorkResult.ok(view);
                });
        return CommandOutcomes.map(done, ClockResult::ok);
    }

    private ClockResult.Failure withCurrent(RunContext scope, ClockResult.Failure failure) {
        if (!"stale-version".equals(failure.code()) || failure.currentVersion() != null) return failure;
        try {
            ClockRows.Lookup run = lookup(scope);
            return run.clock() == null ? failure : failure.withCurrentVersion(run.clock().clockVersion());
        } catch (SQLException e) {
            return failure;
        }
    }

    static WorkResult refusal(String status, String code, String reason, boolean retryable, Long currentVersion) {
        return WorkResult.ok(CommandOutcomes.refusal(status, code, reason, retryable, currentVersion));
    }
}
