package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Optional;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** Allocates eligible offers for one trigger: prepare once, then claim ranked contenders, one transaction each. */
public final class AllocationService {

    static final String ACTOR = "system:allocation";
    private static final int MAX_NO_PROGRESS = 3;

    private record RunRow(String state, int nextIndex, int count) {}

    private record Contender(String employeeId, String orderUuid) {}

    /** A step outcome: continue, or stop with a result. */
    private record Step(AllocationResult stop) {
        static final Step CONTINUE = new Step(null);
    }

    private final DataSource dataSource;
    private final PolicyService policy;
    private final EligibleCandidates candidates;

    public AllocationService(DataSource dataSource, PolicyService policy, EligibleCandidates candidates) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.candidates = candidates;
    }

    /** One trigger allocation: prepare (once) then claim contenders in order. Idempotent by trigger. */
    public AllocationResult allocate(AllocationScope scope, Trigger trigger) {
        String problem = scope == null ? "The allocation scope is missing." : scope.problem();
        if (problem == null) problem = trigger == null ? "The trigger is missing." : trigger.problem();
        if (problem != null) return new AllocationResult.Refused("invalid-trigger", problem);
        RunContext ctx = new RunContext(scope.environmentId(), scope.runId(), ACTOR);
        TransactionRunner runner = new TransactionRunner(dataSource);
        ObjectNode input = trigger.json();
        String allocationId = "allocation:" + Canonical.digest(Sql.JSON.createArrayNode().add(trigger.type())
                .add(trigger.sourceEventId()));
        String digest = Canonical.digest(input);

        Prepare prepare = new Prepare(policy, candidates);
        Command prepareCommand = new Command("allocation.prepare", allocationId, input);
        Outcome prepared = settle(runner, ctx, allocationId, () -> runner.execute(ctx, prepareCommand,
                tx -> prepare.run(tx, scope, trigger, allocationId, digest)));
        if (prepared instanceof Outcome.Committed) {
            // fall through to claiming
        } else {
            return failure(prepared);
        }
        try {
            RunRow first = run(ctx, allocationId);
            if (first == null) return new AllocationResult.Pending("allocation-missing", allocationId, true);
            if ("completed".equals(first.state())) return completed(ctx, allocationId, true);
            int stalled = 0;
            while (true) {
                RunRow row = run(ctx, allocationId);
                if ("completed".equals(row.state())) return completed(ctx, allocationId, false);
                int before = row.nextIndex();
                Step step = row.nextIndex() >= row.count()
                        ? complete(runner, ctx, allocationId)
                        : claimNext(runner, ctx, allocationId, row.nextIndex());
                if (step.stop() != null) return step.stop();
                RunRow after = run(ctx, allocationId);
                boolean progressed = "completed".equals(after.state()) || after.nextIndex() != before;
                stalled = progressed ? 0 : stalled + 1;
                if (stalled >= MAX_NO_PROGRESS) {
                    return new AllocationResult.Pending("no-progress", allocationId, true);
                }
            }
        } catch (SQLException e) {
            return new AllocationResult.Pending("database-unavailable", allocationId, true);
        }
    }

    /** The stored plan and (once completed) outcome of one allocation, for inspection. */
    public Optional<JsonNode> read(AllocationScope scope, String allocationId) {
        try (Connection c = dataSource.getConnection()) {
            return Optional.ofNullable(Sql.one(c, "SELECT state, plan::text, outcome::text, next_index, contender_count "
                    + "FROM allocation_runs WHERE environment_id = ? AND run_id = ? AND allocation_id = ?", rs -> {
                        ObjectNode o = Sql.JSON.createObjectNode();
                        o.put("allocationId", allocationId);
                        o.put("state", rs.getString(1));
                        o.set("plan", Sql.json(rs.getString(2)));
                        if (rs.getString(3) != null) o.set("outcome", Sql.json(rs.getString(3)));
                        o.put("nextIndex", rs.getInt(4));
                        o.put("contenderCount", rs.getInt(5));
                        return (JsonNode) o;
                    }, scope.environmentId(), scope.runId(), allocationId));
        } catch (SQLException e) {
            return Optional.empty();
        }
    }

    private Step claimNext(TransactionRunner runner, RunContext ctx, String allocationId, int ordinal) throws SQLException {
        Contender k = contender(ctx, allocationId, ordinal);
        String operationId = "allocation:" + Canonical.digest(Sql.JSON.createArrayNode().add(ctx.runId())
                .add(allocationId).add(k.employeeId()).add(k.orderUuid()));
        Command command = new Command("allocation.claim", operationId,
                Sql.JSON.createObjectNode().put("allocationId", allocationId).put("ordinal", ordinal));
        Outcome o = settle(runner, ctx, operationId,
                () -> runner.execute(ctx, command, tx -> Claim.run(tx, allocationId, ordinal, operationId)));
        return stepOf(o, operationId);
    }

    private Step complete(TransactionRunner runner, RunContext ctx, String allocationId) {
        String commandId = allocationId + ":complete";
        Command command = new Command("allocation.complete", commandId,
                Sql.JSON.createObjectNode().put("allocationId", allocationId));
        Outcome o = settle(runner, ctx, commandId, () -> runner.execute(ctx, command, tx -> Completion.run(tx, allocationId)));
        return stepOf(o, commandId);
    }

    /** A committed or stale (another worker moved it) outcome continues; anything else stops with its result. */
    private static Step stepOf(Outcome o, String operationId) {
        if (o instanceof Outcome.Committed) return Step.CONTINUE;
        if (o instanceof Outcome.Conflict c && ("stale-version".equals(c.code()) || "duplicate-record".equals(c.code()))) {
            return Step.CONTINUE;
        }
        return new Step(failure(o, operationId));
    }

    /** Runs a command; an uncertain commit is inspected, never assumed (absent is retried once). */
    static Outcome settle(TransactionRunner runner, RunContext ctx, String commandId, Supplier<Outcome> attempt) {
        Outcome o = attempt.get();
        for (int retries = 0; o instanceof Outcome.Uncertain; retries++) {
            Inspection seen = runner.inspect(ctx, commandId);
            if (seen instanceof Inspection.Committed committed) {
                return new Outcome.Committed(committed.result(), committed.runRevision(), true, false);
            }
            if (seen instanceof Inspection.Unavailable || retries >= 1) return o;
            o = attempt.get();
        }
        return o;
    }

    private static AllocationResult failure(Outcome o) {
        return failure(o, null);
    }

    static AllocationResult failure(Outcome o, String operationId) {
        if (o instanceof Outcome.Refused r) return new AllocationResult.Refused(r.code(), r.message());
        if (o instanceof Outcome.Conflict c) {
            return "command-input-changed".equals(c.code())
                    ? new AllocationResult.Refused(c.code(), c.message())
                    : new AllocationResult.Pending(c.code(), operationId, c.retryable());
        }
        if (o instanceof Outcome.Uncertain u) return new AllocationResult.Pending(u.code(), u.operationId(), true);
        return new AllocationResult.Pending(o.code(), operationId, o.retryable());
    }

    private AllocationResult completed(RunContext ctx, String allocationId, boolean replayed) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            JsonNode outcome = Sql.one(c, "SELECT outcome::text FROM allocation_runs WHERE environment_id = ? "
                    + "AND run_id = ? AND allocation_id = ?", rs -> Sql.json(rs.getString(1)), ctx.environmentId(),
                    ctx.runId(), allocationId);
            return new AllocationResult.Completed(allocationId, outcome, replayed);
        }
    }

    private RunRow run(RunContext ctx, String allocationId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return Sql.one(c, "SELECT state, next_index, contender_count FROM allocation_runs WHERE environment_id = ? "
                    + "AND run_id = ? AND allocation_id = ?", rs -> new RunRow(rs.getString(1), rs.getInt(2), rs.getInt(3)),
                    ctx.environmentId(), ctx.runId(), allocationId);
        }
    }

    private Contender contender(RunContext ctx, String allocationId, int ordinal) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return Sql.one(c, "SELECT employee_id, order_uuid FROM allocation_contenders WHERE environment_id = ? "
                    + "AND run_id = ? AND allocation_id = ? AND ordinal = ?",
                    rs -> new Contender(rs.getString(1), rs.getString(2)), ctx.environmentId(), ctx.runId(), allocationId,
                    ordinal);
        }
    }
}
