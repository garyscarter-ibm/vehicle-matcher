package gcsp.api.production;

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
import gcsp.api.production.PlanSnapshotPort.Line;
import gcsp.api.production.PlanSnapshotPort.Reading;
import gcsp.api.production.PlanSnapshotPort.Snapshot;
import gcsp.api.production.ProductionProviderPort.Answer;
import gcsp.api.production.ProductionProviderPort.Status;
import gcsp.api.production.ProductionStore.RequestRow;
import gcsp.api.production.ProductionStore.Submission;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import javax.sql.DataSource;

/**
 * Intentional submission of Greg's plan to Production: intent is stored first, each request leaves outside any
 * transaction under one deterministic operation id, then settles by version CAS. Retries resume without duplicates.
 */
public final class ProductionService {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String DB_CODE = "database-unavailable";
    private static final String DB_REASON = "The database could not be reached. Try again shortly.";

    /** What Greg submitted: the plan he previewed and the input versions it was built from. */
    public record SubmitInput(String commandId, String planId, Map<String, String> versions) {}

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final ProductionProviderPort provider;
    private final PlanSnapshotPort plans;
    private final ProductionClock clock;

    public ProductionService(DataSource dataSource, ProductionProviderPort provider, PlanSnapshotPort plans,
            ProductionClock clock) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.provider = provider;
        this.plans = plans;
        this.clock = clock;
    }

    public ProductionResult submit(RunContext scope, SubmitInput in) {
        ProductionResult invalid = validate(in);
        if (invalid != null) return invalid;
        if ("none".equals(provider.mode())) {
            return new ProductionResult.Unavailable(UnconfiguredProductionProvider.CODE,
                    UnconfiguredProductionProvider.REASON, false);
        }
        ObjectNode input = inputJson(in);
        String digest = Canonical.digest(input);
        String submissionId = "submission-" + Ids.hex32(scope.runId(), scope.actorId(), in.commandId());
        try {
            Optional<Submission> prior;
            try (Connection c = dataSource.getConnection()) {
                prior = ProductionStore.submission(c, scope, submissionId);
            }
            if (prior.isPresent()) {
                if (!prior.get().inputDigest().equals(digest)) return changedInput();
                return send(scope, prior.get(), now(scope, prior.get().requestedAt()), false, true);
            }
            Optional<Instant> now = clock.now(scope);
            if (now.isEmpty()) {
                return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
            }
            Instant at = Ids.ms(now.get());
            Reading reading = plans.current(scope);
            if (reading instanceof PlanSnapshotPort.Unavailable u) {
                return new ProductionResult.Unavailable(u.code(), u.reason(), false);
            }
            Snapshot plan = (Snapshot) reading;
            ProductionResult refused = checkPlan(in, plan);
            if (refused != null) return refused;
            return create(scope, in, input, digest, submissionId, plan, at);
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    private static ProductionResult validate(SubmitInput in) {
        if (in == null || in.commandId() == null || in.commandId().isBlank() || in.commandId().length() > 200) {
            return new ProductionResult.Invalid("invalid-command-id", "Supply a command ID of 1 to 200 characters.");
        }
        if (in.planId() == null || in.planId().isBlank() || in.planId().length() > 512) {
            return new ProductionResult.Invalid("invalid-plan-id", "Supply the plan to send.");
        }
        if (in.versions() == null || in.versions().isEmpty() || in.versions().entrySet().stream()
                .anyMatch(e -> e.getKey() == null || e.getKey().isBlank() || e.getValue() == null || e.getValue().isBlank())) {
            return new ProductionResult.Invalid("invalid-versions", "Supply the input versions the plan was built from.");
        }
        return null;
    }

    private static ObjectNode inputJson(SubmitInput in) {
        ObjectNode o = F.objectNode();
        o.put("commandId", in.commandId());
        o.put("planId", in.planId());
        ObjectNode v = o.putObject("versions");
        in.versions().forEach(v::put);
        return o;
    }

    private static ProductionResult changedInput() {
        return new ProductionResult.Conflict("idempotency-input-changed", "This command ID was used with different input.",
                false, F.objectNode());
    }

    private static ProductionResult checkPlan(SubmitInput in, Snapshot plan) {
        Set<String> changed = new TreeSet<>();
        Set<String> keys = new TreeSet<>(in.versions().keySet());
        keys.addAll(plan.versions().keySet());
        for (String k : keys) {
            if (!java.util.Objects.equals(in.versions().get(k), plan.versions().get(k))) changed.add(k);
        }
        if (!in.planId().equals(plan.planId())) changed.add("plan");
        if (!changed.isEmpty()) {
            ObjectNode details = F.objectNode();
            ArrayNode list = details.putArray("changedInputs");
            changed.forEach(list::add);
            ObjectNode current = details.putObject("current");
            current.put("planId", plan.planId());
            ObjectNode v = current.putObject("versions");
            new java.util.TreeMap<>(plan.versions()).forEach(v::put);
            return new ProductionResult.Conflict("replan-needed", "Inputs changed since the preview. Replan before submitting.",
                    false, details);
        }
        if (!plan.feasible()) {
            return new ProductionResult.Invalid("plan-not-feasible", "This plan cannot be met inside the limits. Change the limits and replan.");
        }
        List<Line> wanted = wanted(plan);
        if (wanted.isEmpty()) return new ProductionResult.Invalid("plan-has-no-order", "This plan orders no vehicles.");
        Set<String> ids = new HashSet<>();
        for (Line l : wanted) {
            if (l.lineId() == null || l.lineId().isBlank() || l.lineId().length() > 200 || !ids.add(l.lineId())
                    || l.model() == null || l.model().isBlank() || l.derivative() == null || l.derivative().isBlank()
                    || l.quantity() > 1000) {
                return new ProductionResult.Invalid("plan-line-invalid", "A plan line cannot be sent. Replan and try again.");
            }
        }
        return null;
    }

    private static List<Line> wanted(Snapshot plan) {
        List<Line> out = new ArrayList<>();
        for (Line l : plan.lines() == null ? List.<Line>of() : plan.lines()) if (l != null && l.quantity() > 0) out.add(l);
        return out;
    }

    /** One command transaction stores the submission and every intent row, before any request leaves. */
    private ProductionResult create(RunContext scope, SubmitInput in, ObjectNode input, String digest, String submissionId,
            Snapshot plan, Instant at) throws SQLException {
        List<Line> lines = wanted(plan);
        String commandId = "production:submit:" + scope.actorId() + ":" + in.commandId();
        Outcome out = runner.execute(scope, new Command("production.submit", commandId, input), tx -> {
            tx.write("INSERT INTO production_submissions (environment_id, run_id, submission_id, command_id, requested_by, "
                    + "plan_id, plan_versions, input_digest, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    scope.environmentId(), scope.runId(), submissionId, in.commandId(), scope.actorId(), in.planId(),
                    input.get("versions"), digest, at);
            for (Line l : lines) {
                String requestId = "request-" + Ids.hex32(scope.runId(), submissionId, l.lineId());
                ObjectNode op = F.objectNode();
                op.put("submissionId", submissionId);
                op.put("lineId", l.lineId());
                op.put("model", l.model());
                op.put("derivative", l.derivative());
                op.put("quantity", l.quantity());
                op.put("requestedAt", at.toString());
                tx.write("INSERT INTO production_requests (environment_id, run_id, request_id, submission_id, line_id, model, "
                        + "derivative, quantity, state, input_digest, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?)",
                        scope.environmentId(), scope.runId(), requestId, submissionId, l.lineId(), l.model(), l.derivative(),
                        l.quantity(), Canonical.digest(op), at);
            }
            return WorkResult.ok(F.objectNode().put("submissionId", submissionId));
        });
        if (out instanceof Outcome.Uncertain u) return new ProductionResult.Uncertain(u.operationId());
        boolean resumed = false;
        if (out instanceof Outcome.Committed c) {
            resumed = c.replayed();
        } else if (out instanceof Outcome.Conflict c) {
            if ("command-input-changed".equals(c.code())) return changedInput();
            if (!"duplicate-record".equals(c.code())) return new ProductionResult.Conflict(c.code(), c.message(), c.retryable(), F.objectNode());
            try (Connection conn = dataSource.getConnection()) {
                if (ProductionStore.submission(conn, scope, submissionId).isEmpty()) {
                    return new ProductionResult.Conflict("plan-already-submitted", "This plan has already been sent to Production.",
                            false, F.objectNode());
                }
            }
            resumed = true;
        } else if (out instanceof Outcome.Refused r) {
            return new ProductionResult.Invalid(r.code(), r.message());
        } else {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
        Submission sub = new Submission(submissionId, in.planId(), digest, at);
        return send(scope, sub, at, !resumed, resumed);
    }

    private Instant now(RunContext scope, Instant fallback) {
        try {
            return clock.now(scope).map(Ids::ms).orElse(fallback);
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /** Sends every open line once, settles each, and answers from the stored rows. */
    private ProductionResult send(RunContext scope, Submission sub, Instant at, boolean fresh, boolean replayed)
            throws SQLException {
        List<RequestRow> rows;
        try (Connection c = dataSource.getConnection()) {
            rows = ProductionStore.requests(c, scope, sub.submissionId());
        }
        for (RequestRow row : rows) {
            if (!"intent".equals(row.state()) && !"uncertain".equals(row.state())) continue;
            Answer answer = call(ProductionStore.operation(scope, row), fresh && "intent".equals(row.state()));
            settle(scope, row, answer, at);
        }
        try (Connection c = dataSource.getConnection()) {
            rows = ProductionStore.requests(c, scope, sub.submissionId());
        }
        boolean pending = rows.stream().anyMatch(r -> "intent".equals(r.state()) || "uncertain".equals(r.state()));
        JsonNode value = view(sub, rows, pending);
        return pending ? new ProductionResult.Pending(value) : new ProductionResult.Ok(value, replayed);
    }

    /** A first attempt submits; a later one asks the provider first and submits only when it has no record. */
    private Answer call(ProductionProviderPort.Operation op, boolean firstAttempt) {
        try {
            if (firstAttempt) return provider.submit(op);
            Answer found = provider.reconcile(op);
            if (found != null && found.status() == Status.NOT_FOUND && op.operationId().equals(found.operationId())) {
                return provider.submit(op);
            }
            return found;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private Outcome settle(RunContext scope, RequestRow row, Answer answer, Instant at) {
        ObjectNode input = F.objectNode().put("requestId", row.requestId()).put("version", row.version());
        String id = "production:settle:" + row.requestId() + ":v" + row.version();
        return runner.execute(scope, new Command("production.settle", id, input), tx -> {
            ProductionStore.applyAnswer(tx, row, answer, provider.mode(), at, "intent", "uncertain");
            return WorkResult.ok(F.objectNode().put("requestId", row.requestId()));
        });
    }

    private static JsonNode view(Submission sub, List<RequestRow> rows, boolean pending) {
        ObjectNode out = F.objectNode();
        out.put("submissionId", sub.submissionId());
        out.put("planId", sub.planId());
        ArrayNode list = out.putArray("requests");
        boolean allRequested = !rows.isEmpty();
        boolean noneOpen = true;
        for (RequestRow r : rows) {
            ObjectNode n = list.addObject();
            n.put("requestId", r.requestId());
            n.put("lineId", r.lineId());
            n.put("model", r.model());
            n.put("derivative", r.derivative());
            n.put("quantity", r.quantity());
            n.put("state", r.state());
            n.put("providerReference", r.providerReference());
            n.put("code", r.refusalCode());
            n.put("reason", r.refusalReason() != null ? r.refusalReason() : r.delayReason());
            allRequested &= "requested".equals(r.state());
            noneOpen &= !"refused".equals(r.state()) && !"unsupported".equals(r.state());
        }
        out.put("message", pending ? "Production has not answered yet. Retry with the same request to continue without duplicates."
                : allRequested ? "Requested. Production has not confirmed any of this yet."
                : noneOpen ? "Production has answered. See each line for where it stands."
                : "Some requests were not accepted. See each line for the reason.");
        return out;
    }
}
