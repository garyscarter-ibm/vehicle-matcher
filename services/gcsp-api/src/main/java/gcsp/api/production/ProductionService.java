package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import gcsp.api.production.PlanSnapshotPort.Line;
import gcsp.api.production.PlanSnapshotPort.Reading;
import gcsp.api.production.PlanSnapshotPort.Snapshot;
import gcsp.api.production.ProductionProviderPort.Answer;
import gcsp.api.production.ProductionProviderPort.Status;
import gcsp.api.production.ProductionStore.ConfirmationRow;
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
 * The reconcile pass only asks the provider (never submits), applies real answers, and queues confirmations into supply.
 */
public final class ProductionService {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String DB_CODE = "database-unavailable";
    static final String MODE_CHANGED = "provider-mode-changed";
    private static final String DB_REASON = "The database could not be reached. Try again shortly.";

    /** What Greg submitted: the plan he previewed, its input versions and any draft changes it was previewed under (null = none). */
    public record SubmitInput(String commandId, String planId, Map<String, String> versions, JsonNode changes) {
        public SubmitInput(String commandId, String planId, Map<String, String> versions) {
            this(commandId, planId, versions, null);
        }
    }

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final ProductionProviderPort provider;
    private final PlanSnapshotPort plans;
    private final ProductionClock clock;
    private final SupplyQueuePort supply;
    private final ProductionReads reads;

    public ProductionService(DataSource dataSource, ProductionProviderPort provider, PlanSnapshotPort plans,
            ProductionClock clock) {
        this(dataSource, provider, plans, clock, new UnconfiguredSupplyQueue());
    }

    public ProductionService(DataSource dataSource, ProductionProviderPort provider, PlanSnapshotPort plans,
            ProductionClock clock, SupplyQueuePort supply) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.provider = provider;
        this.plans = plans;
        this.clock = clock;
        this.supply = supply;
        this.reads = new ProductionReads(dataSource, provider, clock);
    }

    public ProductionResult submit(RunContext scope, Principal principal, SubmitInput in) {
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
            Reading reading = in.changes() == null ? plans.current(scope, principal) : plans.current(scope, principal, in.changes());
            if (reading instanceof PlanSnapshotPort.Unavailable u) {
                return new ProductionResult.Unavailable(u.code(), u.reason(), false);
            }
            if (reading instanceof PlanSnapshotPort.Invalid i) return new ProductionResult.Invalid(i.code(), i.reason());
            Snapshot plan = (Snapshot) reading;
            ProductionResult refused = checkPlan(in, plan);
            if (refused != null) return refused;
            return create(scope, "submit", in.commandId(), input, digest, submissionId, in.planId(), input.get("versions"),
                    wanted(plan), at, null, plan.changes());
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    /** Greg's explicit single-line request: the observed policy and stock versions, and an optional plan reference. */
    public record ManualInput(String commandId, String model, String derivative, int quantity,
            String expectedPolicyVersion, String expectedStockVersion, JsonNode plan) {}

    /** One line through the plan's durable path (intent first, one operation); its "manual:" plan id keeps replan history off it. */
    public ProductionResult submitManual(RunContext scope, Principal principal, ManualInput in) {
        ProductionResult invalid = validate(in);
        if (invalid != null) return invalid;
        if ("none".equals(provider.mode())) {
            return new ProductionResult.Unavailable(UnconfiguredProductionProvider.CODE,
                    UnconfiguredProductionProvider.REASON, false);
        }
        ObjectNode input = F.objectNode();
        input.put("commandId", in.commandId());
        input.put("model", in.model());
        input.put("derivative", in.derivative());
        input.put("quantity", in.quantity());
        input.put("expectedPolicyVersion", in.expectedPolicyVersion());
        input.put("expectedStockVersion", in.expectedStockVersion());
        if (in.plan() != null) input.set("plan", in.plan());
        String digest = Canonical.digest(input);
        String submissionId = "submission-" + Ids.hex32(scope.runId(), scope.actorId(), in.commandId(), "manual");
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
            if (!in.expectedPolicyVersion().equals(principal.policyVersion())) {
                return stale("policy", in.expectedPolicyVersion(), principal.policyVersion());
            }
            String stock;
            try (Connection c = dataSource.getConnection()) {
                stock = ProductionStore.stockVersion(c, scope);
            }
            if (!in.expectedStockVersion().equals(stock)) return stale("stock", in.expectedStockVersion(), stock);
            ObjectNode versions = F.objectNode();
            versions.put("policy", in.expectedPolicyVersion());
            versions.put("stock", in.expectedStockVersion());
            if (in.plan() != null) versions.set("plan", in.plan());
            List<Line> lines = List.of(new Line("l1", in.model(), in.derivative(), in.quantity()));
            return create(scope, "manual", in.commandId(), input, digest, submissionId,
                    ProductionReads.MANUAL_PREFIX + submissionId, versions, lines, Ids.ms(now.get()), in.expectedStockVersion(), F.arrayNode());
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    private static ProductionResult validate(ManualInput in) {
        if (in == null || in.commandId() == null || in.commandId().isBlank() || in.commandId().length() > 200) {
            return new ProductionResult.Invalid("invalid-command-id", "Supply a command ID of 1 to 200 characters.");
        }
        if (in.model() == null || in.model().isBlank() || in.model().length() > 200 || in.derivative() == null
                || in.derivative().isBlank() || in.derivative().length() > 200) {
            return new ProductionResult.Invalid("invalid-choice", "Supply the model and derivative to request.");
        }
        if (in.quantity() < 1 || in.quantity() > 1000) {
            return new ProductionResult.Invalid("invalid-quantity", "Request from 1 to 1000 vehicles.");
        }
        if (in.expectedPolicyVersion() == null || in.expectedPolicyVersion().isBlank() || in.expectedStockVersion() == null
                || in.expectedStockVersion().isBlank()) {
            return new ProductionResult.Invalid("invalid-versions", "Supply the policy and stock versions you saw.");
        }
        return null;
    }

    private static ProductionResult stale(String resource, String expected, String current) {
        ObjectNode details = F.objectNode();
        details.put("resource", resource);
        details.put("expectedVersion", expected);
        details.put("currentVersion", current);
        return new ProductionResult.Conflict("stale-version", "This changed since you looked. Refresh and try again.", false, details);
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
        if (in.changes() != null) o.set("changes", in.changes());
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

    /** One command transaction stores the submission and every intent row first; a stock fence re-checks stock inside it. */
    private ProductionResult create(RunContext scope, String kind, String clientCommandId, ObjectNode input, String digest,
            String submissionId, String planId, JsonNode planVersions, List<Line> lines, Instant at, String stockFence,
            JsonNode changes) throws SQLException {
        String commandId = "production:" + kind + ":" + scope.actorId() + ":" + clientCommandId;
        Outcome out = runner.execute(scope, new Command("production." + kind, commandId, input), tx -> {
            if (stockFence != null && !stockFence.equals(ProductionStore.stockVersion(tx.connection(), scope))) {
                throw new TxConflict("stale-version", "Stock changed since you looked.");
            }
            tx.write("INSERT INTO production_submissions (environment_id, run_id, submission_id, command_id, requested_by, "
                    + "plan_id, plan_versions, input_digest, requested_at, constraint_changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    scope.environmentId(), scope.runId(), submissionId, clientCommandId, scope.actorId(), planId,
                    planVersions, digest, at, changes);
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
                        + "derivative, quantity, state, provider_mode, input_digest, requested_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?, ?)",
                        scope.environmentId(), scope.runId(), requestId, submissionId, l.lineId(), l.model(), l.derivative(),
                        l.quantity(), provider.mode(), Canonical.digest(op), at);
            }
            return WorkResult.ok(F.objectNode().put("submissionId", submissionId));
        });
        if (out instanceof Outcome.Uncertain u) return new ProductionResult.Uncertain(u.operationId());
        boolean resumed = false;
        if (out instanceof Outcome.Committed c) {
            resumed = c.replayed();
        } else if (out instanceof Outcome.Conflict c) {
            if ("command-input-changed".equals(c.code())) return changedInput();
            if ("stale-version".equals(c.code()) && stockFence != null) {
                try (Connection conn = dataSource.getConnection()) {
                    return stale("stock", stockFence, ProductionStore.stockVersion(conn, scope));
                }
            }
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
        Submission sub = new Submission(submissionId, planId, digest, at);
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
        boolean switched = false;
        for (RequestRow row : rows) {
            if (!"intent".equals(row.state()) && !"uncertain".equals(row.state())) continue;
            if (!sameMode(row)) {
                switched = true;
                continue;
            }
            Answer answer = call(ProductionStore.operation(scope, row), fresh && "intent".equals(row.state()));
            settle(scope, row, answer, at);
            queueConfirmations(scope, row.requestId(), at);
        }
        try (Connection c = dataSource.getConnection()) {
            rows = ProductionStore.requests(c, scope, sub.submissionId());
        }
        boolean pending = rows.stream().anyMatch(r -> "intent".equals(r.state()) || "uncertain".equals(r.state()));
        JsonNode value = view(sub, rows, pending);
        if (switched) {
            return new ProductionResult.Conflict(MODE_CHANGED, modeChangedReason(), false, value);
        }
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
        return apply(scope, "production:settle:", "production.settle", row, answer, at, "intent", "uncertain");
    }

    /** One command transaction applies an answer by version CAS; the result names how it landed. */
    private Outcome apply(RunContext scope, String idPrefix, String type, RequestRow row, Answer answer, Instant at,
            String... from) {
        ObjectNode input = F.objectNode().put("requestId", row.requestId()).put("version", row.version());
        String id = idPrefix + row.requestId() + ":v" + row.version();
        return runner.execute(scope, new Command(type, id, input), tx -> {
            ProductionStore.Applied applied = ProductionStore.applyAnswer(tx, row, answer, provider.mode(), at, from);
            return WorkResult.ok(F.objectNode().put("requestId", row.requestId()).put("applied", applied.name()));
        });
    }

    /** Hands a request's unqueued confirmations to supply, outside any transaction, then marks each by version CAS. */
    private int queueConfirmations(RunContext scope, String requestId, Instant fallback) {
        try {
            List<ConfirmationRow> waiting;
            try (Connection c = dataSource.getConnection()) {
                waiting = ProductionStore.unqueuedFor(c, scope, requestId);
            }
            int queued = 0;
            for (ConfirmationRow cr : waiting) if (queueOne(scope, cr, fallback)) queued++;
            return queued;
        } catch (SQLException | RuntimeException e) {
            return 0;
        }
    }

    private boolean queueOne(RunContext scope, ConfirmationRow cr, Instant fallback) {
        return queueEligible(scope, cr, fallback) != null;
    }

    /** Queues one confirmation into supply and marks it; the date it becomes eligible, or null when it stays unqueued. */
    private Instant queueEligible(RunContext scope, ConfirmationRow cr, Instant fallback) {
        Instant when = Ids.ms(now(scope, fallback));
        SupplyQueuePort.Result r;
        try {
            r = supply.queue(scope, "production:" + cr.supplyId(), when, cr.supplyId(), cr.confirmedAt(),
                    cr.sourceVersion());
        } catch (RuntimeException e) {
            return null;
        }
        if (!(r instanceof SupplyQueuePort.Queued q)) return null;
        ObjectNode input = F.objectNode().put("supplyId", cr.supplyId()).put("version", cr.version());
        Outcome o = runner.execute(scope, new Command("production.queue", "production:queue:" + cr.supplyId() + ":v" + cr.version(), input),
                tx -> {
                    tx.cas("UPDATE production_confirmations SET queued_at = ?, eligible_from = ?, version = version + 1, "
                            + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND supply_id = ? AND version = ? "
                            + "AND queued_at IS NULL", when, q.eligibleFrom(), scope.environmentId(),
                            scope.runId(), cr.supplyId(), cr.version());
                    return WorkResult.ok(F.objectNode().put("supplyId", cr.supplyId()));
                });
        return o instanceof Outcome.Committed ? q.eligibleFrom() : null;
    }

    // ---- queueing and the presenter step ----

    /** Queues a request's unqueued confirmations (never asks the provider); a repeat answers an empty list, a refusal a retryable 503. */
    public ProductionResult queueRequest(RunContext scope, String requestId) {
        if (requestId == null || requestId.isBlank() || requestId.length() > 200) {
            return new ProductionResult.Invalid("request-not-found", "No such Production request.");
        }
        try {
            Optional<Instant> now = clock.now(scope);
            if (now.isEmpty()) return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
            List<ConfirmationRow> waiting;
            try (Connection c = dataSource.getConnection()) {
                if (ProductionStore.request(c, scope, requestId).isEmpty()) {
                    return new ProductionResult.Invalid("request-not-found", "No such Production request.");
                }
                waiting = ProductionStore.unqueuedFor(c, scope, requestId);
            }
            ObjectNode out = F.objectNode();
            out.put("requestId", requestId);
            ArrayNode queued = out.putArray("queued");
            for (ConfirmationRow cr : waiting) {
                Instant eligible = queueEligible(scope, cr, Ids.ms(now.get()));
                if (eligible == null) {
                    return new ProductionResult.Unavailable("supply-queue-unavailable",
                            "Confirmed supply is saved; the release queue could not take it. Retry queueing.", true);
                }
                queued.addObject().put("supplyId", cr.supplyId()).put("eligibleFrom", Ids.ms(eligible).toString());
            }
            return new ProductionResult.Ok(out, false);
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    /** The presenter's scenario step: what to script, against which version of the request. */
    public record StepInput(String commandId, String requestId, long expectedVersion, String action, Integer quantity,
            Instant delayUntil, String reason) {}

    /** Scripts one answer, then reconciles; the version check, bump and receipt share one transaction, so a repeat replays. */
    public ProductionResult stepProduction(RunContext scope, StepInput in) {
        if (!(provider instanceof SyntheticProductionProvider synthetic)) {
            return new ProductionResult.Conflict("production-scenario-unsupported",
                    "Production responses can only be scripted for the synthetic provider.", false, F.objectNode());
        }
        ObjectNode input = F.objectNode();
        input.put("commandId", in.commandId());
        input.put("requestId", in.requestId());
        input.put("expectedVersion", in.expectedVersion());
        input.put("action", in.action());
        if (in.quantity() != null) input.put("quantity", in.quantity());
        if (in.delayUntil() != null) input.put("delayUntil", Ids.ms(in.delayUntil()).toString());
        if (in.reason() != null) input.put("reason", in.reason());
        try {
            Optional<Instant> now = clock.now(scope);
            if (now.isEmpty()) return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
            java.util.concurrent.atomic.AtomicReference<ProductionResult> refusal = new java.util.concurrent.atomic.AtomicReference<>();
            Outcome out = runner.execute(scope, new Command("production.step", "production:step:" + in.commandId(), input), tx -> {
                Optional<RequestRow> row = ProductionStore.lockedRequest(tx, in.requestId());
                if (row.isEmpty()) {
                    refusal.set(new ProductionResult.Invalid("request-not-found", "No such Production request."));
                    throw new TxConflict("request-not-found", "No such Production request.");
                }
                if (row.get().version() != in.expectedVersion()) {
                    refusal.set(stale("request", Long.toString(in.expectedVersion()), Long.toString(row.get().version())));
                    throw new TxConflict("stale-version", "The request changed since you looked.");
                }
                tx.cas("UPDATE production_requests SET version = version + 1, updated_at = now() WHERE environment_id = ? "
                        + "AND run_id = ? AND request_id = ? AND version = ?", scope.environmentId(), scope.runId(),
                        in.requestId(), in.expectedVersion());
                SyntheticProductionProvider.ScriptResult r = synthetic.script(scope, in.requestId(), in.action(), in.quantity(),
                        in.delayUntil(), in.reason(), Ids.ms(now.get()), in.commandId());
                if (!r.ok()) {
                    refusal.set(scriptRefusal(r));
                    throw new TxConflict(r.code(), r.reason());
                }
                return WorkResult.ok(F.objectNode().put("seq", r.seq()));
            });
            boolean replayed;
            int seq;
            if (out instanceof Outcome.Committed c) {
                replayed = c.replayed();
                seq = c.result().path("seq").asInt();
            } else if (out instanceof Outcome.Uncertain u) {
                return new ProductionResult.Uncertain(u.operationId());
            } else if (out instanceof Outcome.Conflict c) {
                if (refusal.get() != null) return refusal.get();
                if ("command-input-changed".equals(c.code())) return changedInput();
                return new ProductionResult.Conflict(c.code(), c.message(), c.retryable(), F.objectNode());
            } else if (out instanceof Outcome.Refused r) {
                return new ProductionResult.Invalid(r.code(), r.message());
            } else {
                return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
            }
            ProductionResult settled = reconcileRequest(scope, in.requestId());
            if (settled instanceof ProductionResult.Ok ok && ok.value() instanceof ObjectNode o) {
                ObjectNode copy = o.deepCopy();
                copy.putObject("scripted").put("requestId", in.requestId()).put("action", in.action()).put("seq", seq);
                return new ProductionResult.Ok(copy, replayed);
            }
            return settled;
        } catch (RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    private static ProductionResult scriptRefusal(SyntheticProductionProvider.ScriptResult r) {
        return switch (r.code()) {
            case "operation-not-found" -> new ProductionResult.Invalid("request-not-found", r.reason());
            case "production-store-unavailable" -> new ProductionResult.Unavailable(r.code(), r.reason(), true);
            default -> new ProductionResult.Conflict(r.code(), r.reason(), false, F.objectNode());
        };
    }

    // ---- reconcile and reads ----

    /** Reconciles up to limit open requests, then retries unqueued confirmations; never submits a new request. */
    public ProductionResult reconcile(RunContext scope, int limit) {
        return reconcile(scope, limit, null);
    }

    /** As {@link #reconcile(RunContext, int)}, continuing after the given request id (the value's next cursor). */
    public ProductionResult reconcile(RunContext scope, int limit, String afterRequestId) {
        if (limit < 1 || limit > 100) return new ProductionResult.Invalid("invalid-limit", "Choose a limit from 1 to 100.");
        ProductionResult gate = reconcileGate();
        if (gate != null) return gate;
        try {
            Optional<Instant> now = clock.now(scope);
            if (now.isEmpty()) return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
            Instant at = Ids.ms(now.get());
            List<RequestRow> rows;
            try (Connection c = dataSource.getConnection()) {
                rows = ProductionStore.openRequests(c, scope, limit, afterRequestId == null ? "" : afterRequestId);
            }
            Pass pass = new Pass();
            for (RequestRow row : rows) pass.add(reconcileRow(scope, row, at));
            List<ConfirmationRow> waiting;
            try (Connection c = dataSource.getConnection()) {
                waiting = ProductionStore.unqueuedOfRun(c, scope, provider.mode(), limit);
            }
            for (ConfirmationRow cr : waiting) if (!pass.tried.contains(cr.supplyId()) && queueOne(scope, cr, at)) pass.queued++;
            ObjectNode out = pass.json();
            out.put("next", rows.size() == limit ? rows.get(rows.size() - 1).requestId() : null);
            return new ProductionResult.Ok(out, false);
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    /** Reconciles one request (the presenter scenario step), then retries its unqueued confirmations. */
    public ProductionResult reconcileRequest(RunContext scope, String requestId) {
        if (requestId == null || requestId.isBlank() || requestId.length() > 200) {
            return new ProductionResult.Invalid("request-not-found", "No such Production request.");
        }
        ProductionResult gate = reconcileGate();
        if (gate != null) return gate;
        try {
            Optional<Instant> now = clock.now(scope);
            if (now.isEmpty()) return new ProductionResult.Unavailable("clock-not-set", "The demo clock has not been set. Try again shortly.", true);
            Optional<RequestRow> row;
            try (Connection c = dataSource.getConnection()) {
                row = ProductionStore.request(c, scope, requestId);
            }
            if (row.isEmpty()) return new ProductionResult.Invalid("request-not-found", "No such Production request.");
            Pass pass = new Pass();
            pass.add(reconcileRow(scope, row.get(), Ids.ms(now.get())));
            return new ProductionResult.Ok(pass.json(), false);
        } catch (SQLException | RuntimeException e) {
            return new ProductionResult.Unavailable(DB_CODE, DB_REASON, true);
        }
    }

    private ProductionResult reconcileGate() {
        if ("none".equals(provider.mode())) {
            return new ProductionResult.Unavailable(UnconfiguredProductionProvider.CODE, UnconfiguredProductionProvider.REASON, false);
        }
        return null;
    }

    private record RowOutcome(String requestId, String outcome, int queued, List<String> supplyIds) {}

    private static final class Pass {
        final List<RowOutcome> rows = new ArrayList<>();
        final Set<String> tried = new HashSet<>();
        int queued;

        void add(RowOutcome r) {
            rows.add(r);
            queued += r.queued();
            tried.addAll(r.supplyIds());
        }

        ObjectNode json() {
            ObjectNode out = F.objectNode();
            out.put("reconciled", rows.size());
            out.put("applied", rows.stream().filter(r -> "applied".equals(r.outcome())).count());
            out.put("skipped", rows.stream().filter(r -> MODE_CHANGED.equals(r.outcome())).count());
            out.put("queued", queued);
            ArrayNode list = out.putArray("requests");
            rows.forEach(r -> list.addObject().put("requestId", r.requestId()).put("outcome", r.outcome()));
            return out;
        }
    }

    /** Whether the row was created for the provider selected now; a switched provider never acts on it. */
    private boolean sameMode(RequestRow row) {
        return provider.mode().equals(row.providerMode());
    }

    private String modeChangedReason() {
        return "This request was made through a different Production provider than the one selected now ("
                + provider.mode() + "). It is left as it is.";
    }

    private RowOutcome reconcileRow(RunContext scope, RequestRow row, Instant at) {
        if (!sameMode(row)) return new RowOutcome(row.requestId(), MODE_CHANGED, 0, List.of());
        String result = "closed";
        if (ProductionStore.open(row.state())) {
            Answer answer;
            try {
                answer = provider.reconcile(ProductionStore.operation(scope, row));
            } catch (RuntimeException e) {
                answer = null;
            }
            Outcome o = apply(scope, "production:reconcile:", "production.reconcile", row, answer, at, ProductionStore.OPEN_STATES);
            result = o instanceof Outcome.Committed c ? c.result().path("applied").asText("unknown").toLowerCase(java.util.Locale.ROOT)
                    : o instanceof Outcome.Uncertain ? "uncertain" : o instanceof Outcome.Conflict ? "conflict" : "unavailable";
        }
        List<String> tried = new ArrayList<>();
        int queued = 0;
        try {
            List<ConfirmationRow> waiting;
            try (Connection c = dataSource.getConnection()) {
                waiting = ProductionStore.unqueuedFor(c, scope, row.requestId());
            }
            for (ConfirmationRow cr : waiting) {
                tried.add(cr.supplyId());
                if (queueOne(scope, cr, at)) queued++;
            }
        } catch (SQLException | RuntimeException e) {
            // the confirmations stay unqueued and the next pass retries them
        }
        return new RowOutcome(row.requestId(), result, queued, tried);
    }

    /** Greg's tracking read: requests, confirmations, queue and release kept as separate numbers per request. */
    public ProductionResult status(RunContext scope) {
        return reads.status(scope);
    }

    /** The tracking read plus the policy, stock and clock versions a manual request must quote. */
    public ProductionResult orders(RunContext scope, String policyVersion) {
        return reads.orders(scope, policyVersion);
    }

    /** What the planner binds for its supply input and replan display; supplyVersion changes with every applied response. */
    public ProductionResult supplyActivity(RunContext scope) {
        return reads.supplyActivity(scope);
    }

    /** Greg's order-plan replan value: the latest submission's responses since it was sent, against the plan he now sees. */
    public ProductionResult replanFor(RunContext scope, String currentPlanId) {
        return reads.replanFor(scope, currentPlanId);
    }

    private JsonNode view(Submission sub, List<RequestRow> rows, boolean pending) {
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
            n.put("providerMode", r.providerMode());
            boolean stranded = ProductionStore.open(r.state()) && !sameMode(r);
            n.put("code", stranded ? MODE_CHANGED : r.refusalCode());
            n.put("reason", stranded ? modeChangedReason() : r.refusalReason() != null ? r.refusalReason() : r.delayReason());
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
