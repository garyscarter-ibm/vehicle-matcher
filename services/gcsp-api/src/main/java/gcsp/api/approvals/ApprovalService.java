package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalStatusProvider.Request;
import gcsp.api.approvals.ApprovalStatusProvider.Response;
import gcsp.api.approvals.ApprovalStatusProvider.Status;
import gcsp.api.approvals.ApprovalStore.Decision;
import gcsp.api.approvals.ApprovalStore.Head;
import gcsp.api.auth.Role;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Order approval lifecycle (Node LifecycleApprovalService minus routes): short commands, provider calls outside them.
 * Elapsed time only makes a decision due; only a matching confirmation approves.
 */
public final class ApprovalService {

    public static final String ACTOR = "system:lifecycle-approvals";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final int MAX_FAILED = 20;
    private static final int PAGE = 100;
    private static final String DB_DOWN = "database-unavailable";

    /** The caller as the server resolved it; an employee reads only their own orders. */
    public record Reader(Role role, String employeeId) {}

    public record TickInput(String tickId, Instant now, long clockVersion) {}

    private enum Step { ADVANCED, WAITING, BLOCKED, UNCERTAIN, FINISHED }

    /** One order's refusal: policyWide stops the whole tick or list, otherwise it is listed in failed and skipped. */
    private record Failure(String status, String code, boolean policyWide, ApprovalResult result) {}

    private record Advance(Step step, Failure failure) {
        static Advance of(Step s) {
            return new Advance(s, null);
        }

        static Advance failed(Failure f) {
            return new Advance(null, f);
        }
    }

    private final DataSource dataSource;
    private final ApprovalPolicyPort policy;
    private final OrderSourcePort orders;
    private final ApprovalStatusProvider status;
    private final HandoverPort handover;
    private final ApprovalCommands commands;

    public ApprovalService(DataSource dataSource, ApprovalPolicyPort policy, OrderSourcePort orders,
            ApprovalStatusProvider status, HandoverPort handover) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.orders = orders == null ? new UnconfiguredOrderSource() : orders;
        this.status = status == null ? new UnconfiguredApprovalStatus() : status;
        this.handover = handover == null ? new NoHandover() : handover;
        this.commands = new ApprovalCommands(new TransactionRunner(dataSource));
    }

    private static RunContext system(RunContext scope) {
        return new RunContext(scope.environmentId(), scope.runId(), ACTOR);
    }

    // ---- reads ----

    public ApprovalResult read(RunContext ctx, Reader reader, String orderUuid) {
        ApprovalResult denied = authorise(reader);
        if (denied != null) return denied;
        if (orderUuid == null || orderUuid.isBlank() || orderUuid.length() > 128) {
            return new ApprovalResult.Invalid("invalid-order", "Choose an order to view.");
        }
        try {
            OrderSourcePort.Found found = orders.find(ctx, orderUuid);
            ApprovalResult refused = sourceRefusal(found, reader);
            if (refused != null) return refused;
            OrderSourcePort.SelectionOrder order = ((OrderSourcePort.Ready) found).order();
            ApprovalPolicy.Loaded loaded = ApprovalPolicy.load(policy, order.policyVersion(), order.approvalStages());
            if (loaded instanceof ApprovalPolicy.PolicyWide w) return policyRefusal(w.code(), true);
            if (loaded instanceof ApprovalPolicy.OrderScoped sc) return policyRefusal(sc.code(), false);
            ApprovalPolicy.Policy p = ((ApprovalPolicy.Ok) loaded).policy();
            try (Connection c = dataSource.getConnection()) {
                Instant asOf = ApprovalStore.asOf(c, ctx);
                Head head = ApprovalStore.head(c, ctx, order.orderUuid()).orElseGet(() -> ApprovalStore.initial(order, p));
                Decision d = "in-progress".equals(head.outcome()) && head.revision() > 0
                        ? ApprovalStore.openDecisions(c, ctx, List.of(order.orderUuid()))
                                .get(order.orderUuid() + "\u0000" + head.currentStage()) : null;
                return new ApprovalResult.Ok(ApprovalView.project(ctx, head, p, order.renewalId(), d, asOf,
                        handoverOf(ctx, head, asOf), status), false);
            }
        } catch (SQLException e) {
            return unavailableDb();
        } catch (RuntimeException e) {
            return new ApprovalResult.Unavailable("order-progress-unavailable", "Order progress is unavailable. Try again shortly.",
                    true, false, null);
        }
    }

    public ApprovalResult list(RunContext ctx, Reader reader, String after, int limit) {
        ApprovalResult denied = authorise(reader);
        if (denied != null) return denied;
        if (limit < 1 || limit > PAGE) {
            return new ApprovalResult.Invalid("invalid-query", "Choose between 1 and 100 orders per page.");
        }
        try {
            OrderSourcePort.Listing listing = orders.list(ctx, after, limit);
            if (listing instanceof OrderSourcePort.Unavailable u) return sourceUnavailable(u.code());
            OrderSourcePort.Page page = (OrderSourcePort.Page) listing;
            boolean all = reader.role() != Role.EMPLOYEE;
            List<OrderSourcePort.SelectionOrder> mine = new ArrayList<>();
            for (OrderSourcePort.SelectionOrder o : page.orders()) {
                if (all || reader.employeeId() != null && reader.employeeId().equals(o.employeeId())) mine.add(o);
            }
            ArrayNode views = F.arrayNode();
            List<ObjectNode> failed = new ArrayList<>();
            for (OrderSourcePort.InvalidRow row : page.invalid()) {
                if (all || reader.employeeId() != null && reader.employeeId().equals(row.employeeId())) {
                    failed.add(failure(row.orderUuid(), "unavailable", "selection-source-invalid"));
                }
            }
            try (Connection c = dataSource.getConnection()) {
                Instant asOf = ApprovalStore.asOf(c, ctx);
                List<String> ids = mine.stream().map(OrderSourcePort.SelectionOrder::orderUuid).toList();
                Map<String, Head> heads = ApprovalStore.heads(c, ctx, ids);
                Map<String, Decision> open = ApprovalStore.openDecisions(c, ctx, ids);
                Map<String, ApprovalPolicy.Loaded> cache = new HashMap<>();
                for (OrderSourcePort.SelectionOrder order : mine) {
                    ApprovalPolicy.Loaded loaded = loadCached(cache, order);
                    if (loaded instanceof ApprovalPolicy.PolicyWide w) return policyRefusal(w.code(), true);
                    if (loaded instanceof ApprovalPolicy.OrderScoped s) {
                        failed.add(failure(order.orderUuid(), "unavailable", s.code()));
                        continue;
                    }
                    ApprovalPolicy.Policy p = ((ApprovalPolicy.Ok) loaded).policy();
                    Head head = heads.getOrDefault(order.orderUuid(), ApprovalStore.initial(order, p));
                    Decision d = "in-progress".equals(head.outcome())
                            ? open.get(order.orderUuid() + "\u0000" + head.currentStage()) : null;
                    views.add(ApprovalView.project(ctx, head, p, order.renewalId(), d, asOf, handoverOf(ctx, head, asOf),
                            status));
                }
                ObjectNode out = F.objectNode();
                out.put("contractVersion", ApprovalView.CONTRACT);
                out.put("asOf", Time.format(asOf));
                out.set("orders", views);
                ArrayNode shown = out.putArray("failed");
                failed.stream().limit(MAX_FAILED).forEach(shown::add);
                out.put("failedCount", failed.size());
                out.put("nextAfter", page.nextAfter());
                return new ApprovalResult.Ok(out, false);
            }
        } catch (SQLException e) {
            return unavailableDb();
        } catch (RuntimeException e) {
            return new ApprovalResult.Unavailable("order-progress-unavailable", "Order progress is unavailable. Try again shortly.",
                    true, false, null);
        }
    }

    private ApprovalPolicy.Loaded loadCached(Map<String, ApprovalPolicy.Loaded> cache, OrderSourcePort.SelectionOrder o) {
        String key = o.policyVersion() + "\u0000" + o.approvalStages();
        return cache.computeIfAbsent(key, k -> ApprovalPolicy.load(policy, o.policyVersion(), o.approvalStages()));
    }

    /** Only a sent order can be handed over; a failing port keeps today's view rather than hiding the order. */
    private HandoverPort.Handover handoverOf(RunContext ctx, Head head, Instant asOf) {
        if (!"sent-to-ordering".equals(head.outcome())) return null;
        try {
            Optional<HandoverPort.Handover> found = handover.completed(ctx, head.orderUuid(), asOf);
            if (found == null || found.isEmpty()) return null;
            HandoverPort.Handover h = found.get();
            boolean whole = h.stage() != null && !h.stage().isBlank() && h.at() != null && h.owner() != null
                    && h.nextStep() != null;
            return whole ? h : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static ApprovalResult authorise(Reader reader) {
        if (reader == null || reader.role() == null) {
            return new ApprovalResult.Forbidden("role-required", "Order progress needs an employee, Greg or presenter session.");
        }
        if (reader.role() == Role.EMPLOYEE && (reader.employeeId() == null || reader.employeeId().isBlank())) {
            return new ApprovalResult.Forbidden("role-required", "Order progress needs an employee, Greg or presenter session.");
        }
        return null;
    }

    /** Null when the order is ready to read; otherwise the refusal. Another employee's order is refused first. */
    private static ApprovalResult sourceRefusal(OrderSourcePort.Found found, Reader reader) {
        if (found instanceof OrderSourcePort.Unavailable u) return sourceUnavailable(u.code());
        if (found instanceof OrderSourcePort.NotFound) {
            return new ApprovalResult.NotFound("No selection has been sent on for this order.");
        }
        String owner = found instanceof OrderSourcePort.Ready r ? r.order().employeeId()
                : found instanceof OrderSourcePort.NotReady n ? n.employeeId()
                : found instanceof OrderSourcePort.Invalid i ? i.employeeId() : ((OrderSourcePort.Duplicate) found).employeeId();
        if (reader.role() == Role.EMPLOYEE && !reader.employeeId().equals(owner)) {
            return new ApprovalResult.Forbidden("not-resource-owner", "This order belongs to another employee.");
        }
        if (found instanceof OrderSourcePort.NotReady n) {
            return new ApprovalResult.Unavailable(n.code(), n.reason(), true, false, "not-ready");
        }
        if (found instanceof OrderSourcePort.Invalid) {
            return new ApprovalResult.Unavailable("selection-source-invalid", "The selection record could not be read.",
                    false, false, null);
        }
        if (found instanceof OrderSourcePort.Duplicate) {
            return new ApprovalResult.Conflict("duplicate-order-source", "More than one selection exists for this order.", false);
        }
        return null;
    }

    private static ApprovalResult sourceUnavailable(String code) {
        return new ApprovalResult.Unavailable(code, "Order progress is unavailable. Ask the scheme team to check the service.",
                true, false, null);
    }

    private static ApprovalResult policyRefusal(Failure f) {
        return policyRefusal(f.code(), f.policyWide());
    }

    private static ApprovalResult policyRefusal(String code, boolean wide) {
        return new ApprovalResult.Unavailable(code, ApprovalPolicy.REASON, true, wide, null);
    }

    private static ApprovalResult unavailableDb() {
        return new ApprovalResult.Unavailable(DB_DOWN, "Order progress is unavailable. Try again shortly.", true, false, null);
    }

    private static ObjectNode failure(String orderUuid, String status, String code) {
        ObjectNode o = F.objectNode();
        o.put("orderUuid", orderUuid);
        o.put("status", status);
        o.put("code", code);
        return o;
    }

    // ---- tick ----

    /** Delivers a tick: records it (replaying the same id), then advances every order, then completes it. */
    public ApprovalResult tick(RunContext scope, TickInput tick) {
        if (tick == null || tick.tickId() == null || tick.tickId().isBlank() || tick.tickId().length() > 200
                || tick.now() == null || tick.clockVersion() < 1) {
            return new ApprovalResult.Invalid("invalid-tick", "The tick is malformed.");
        }
        RunContext ctx = system(scope);
        Outcome recorded = commands.recordTick(ctx, tick.tickId(), tick.now(), tick.clockVersion());
        ApprovalResult failed = tickFailure(recorded, tick.tickId());
        if (failed != null) return failed;
        try {
            TickRow row = readTick(ctx, tick.tickId());
            if (row == null) return new ApprovalResult.Unavailable("tick-missing", "The tick is not stored.", true, false, null);
            if ("completed".equals(row.state)) return new ApprovalResult.Ok(row.result, true);
            return process(ctx, tick, row);
        } catch (SQLException e) {
            return unavailableDb();
        }
    }

    private static ApprovalResult tickFailure(Outcome o, String tickId) {
        if (o instanceof Outcome.Committed) return null;
        if (o instanceof Outcome.Uncertain) return new ApprovalResult.Uncertain(tickId);
        if (o instanceof Outcome.Conflict c) {
            String code = "command-input-changed".equals(c.code()) ? "tick-input-changed" : c.code();
            return new ApprovalResult.Conflict(code, c.message(), c.retryable());
        }
        if (o instanceof Outcome.Refused r) return new ApprovalResult.Invalid(r.code(), r.message());
        return unavailableDb();
    }

    private ApprovalResult process(RunContext ctx, TickInput tick, TickRow row) throws SQLException {
        int total = 0;
        int[] counts = new int[Step.values().length];
        List<ObjectNode> failed = new ArrayList<>();
        String after = null;
        while (true) {
            OrderSourcePort.Listing listing = orders.list(ctx, after, PAGE);
            if (listing instanceof OrderSourcePort.Unavailable u) return sourceUnavailable(u.code());
            OrderSourcePort.Page page = (OrderSourcePort.Page) listing;
            for (OrderSourcePort.SelectionOrder order : page.orders()) {
                total++;
                Advance a = advanceSafely(ctx, tick, order);
                if (a.failure() == null) {
                    counts[a.step().ordinal()]++;
                } else if (a.failure().policyWide()) {
                    return a.failure().result() != null ? a.failure().result() : policyRefusal(a.failure());
                } else {
                    failed.add(failure(order.orderUuid(), a.failure().status(), a.failure().code()));
                }
            }
            if (page.nextAfter() == null || page.orders().isEmpty() && page.invalid().isEmpty()) break;
            after = page.nextAfter();
        }
        ObjectNode result = F.objectNode();
        result.put("handlerId", "lifecycle-approvals");
        result.put("orders", total);
        result.put("advanced", counts[Step.ADVANCED.ordinal()]);
        result.put("waiting", counts[Step.WAITING.ordinal()]);
        result.put("blocked", counts[Step.BLOCKED.ordinal()]);
        result.put("uncertain", counts[Step.UNCERTAIN.ordinal()]);
        result.put("finished", counts[Step.FINISHED.ordinal()]);
        result.putArray("failed").addAll(failed);
        Outcome done = commands.completeTick(ctx, tick.tickId(), result);
        if (done instanceof Outcome.Uncertain) return new ApprovalResult.Uncertain(tick.tickId());
        if (done instanceof Outcome.Unavailable) return unavailableDb();
        TickRow stored = readTick(ctx, tick.tickId());
        return new ApprovalResult.Ok(stored != null && stored.result != null ? stored.result : result, false);
    }

    private Advance advanceSafely(RunContext ctx, TickInput tick, OrderSourcePort.SelectionOrder order) {
        try {
            return advance(ctx, tick, order);
        } catch (SQLException | RuntimeException e) {
            return Advance.failed(new Failure("unavailable", DB_DOWN, false, null));
        }
    }

    private Advance advance(RunContext ctx, TickInput tick, OrderSourcePort.SelectionOrder order) throws SQLException {
        ApprovalPolicy.Loaded loaded = ApprovalPolicy.load(policy, order.policyVersion(), order.approvalStages());
        if (loaded instanceof ApprovalPolicy.PolicyWide w) return Advance.failed(new Failure("unavailable", w.code(), true, null));
        if (loaded instanceof ApprovalPolicy.OrderScoped s) return Advance.failed(new Failure("unavailable", s.code(), false, null));
        ApprovalPolicy.Policy p = ((ApprovalPolicy.Ok) loaded).policy();
        Optional<Head> found;
        try (Connection c = dataSource.getConnection()) {
            found = ApprovalStore.head(c, ctx, order.orderUuid());
        }
        if (found.isEmpty()) {
            Outcome started = commands.start(ctx, tick.tickId(), tick.now(), order, p);
            return started instanceof Outcome.Committed ? Advance.of(Step.ADVANCED) : outcomeFailure(started);
        }
        Head head = found.get();
        if (!"in-progress".equals(head.outcome())) return Advance.of(Step.FINISHED);
        Decision decision;
        try (Connection c = dataSource.getConnection()) {
            decision = ApprovalStore.decisionFor(c, ctx, order.orderUuid(), head.currentStage()).orElse(null);
        }
        if (decision == null || "confirmed".equals(decision.phase())) {
            return Advance.failed(new Failure("unavailable", "decision-unavailable", false, null));
        }
        boolean fresh = false;
        if ("waiting".equals(decision.phase())) {
            Outcome counted = commands.count(ctx, tick.tickId(), tick.now(), decision.operationId());
            if (!(counted instanceof Outcome.Committed cc)) return outcomeFailure(counted);
            try (Connection c = dataSource.getConnection()) {
                decision = ApprovalStore.decisionById(c, ctx, decision.operationId()).orElse(decision);
            }
            if ("waiting".equals(decision.phase())) return Advance.of(Step.WAITING);
            fresh = !cc.replayed() && "requested".equals(decision.phase());
        }
        return resolve(ctx, tick.tickId(), order, head, decision, p, fresh);
    }

    /** Calls the provider outside any transaction (reconcile first unless this tick just made it due), then settles. */
    private Advance resolve(RunContext ctx, String key, OrderSourcePort.SelectionOrder order, Head head,
            Decision decision, ApprovalPolicy.Policy p, boolean fresh) {
        Request request = new Request(decision.operationId(), ctx.runId(), order.orderUuid(), decision.stage(),
                decision.intended(), decision.inputDigest(), decision.occurredAt());
        Response response;
        if (fresh) {
            response = call(ctx, request, true);
        } else {
            response = call(ctx, request, false);
            if (response != null && response.status() == Status.NOT_FOUND
                    && decision.operationId().equals(response.operationId())) {
                response = call(ctx, request, true);
            }
        }
        boolean matches = response != null && decision.operationId().equals(response.operationId())
                && order.orderUuid().equals(response.orderUuid()) && decision.stage().equals(response.stage());
        boolean confirmed = response != null && response.status() == Status.CONFIRMED && matches
                && decision.intended().equals(response.state()) && response.providerReference() != null
                && !response.providerReference().isBlank();
        if (!confirmed) {
            Outcome marked = commands.unsettled(ctx, key, decision.operationId(), response);
            if (!(marked instanceof Outcome.Committed)) return outcomeFailure(marked);
            boolean refused = response != null && response.status() == Status.UNSUPPORTED;
            return Advance.of(refused ? Step.BLOCKED : Step.UNCERTAIN);
        }
        Outcome settled = commands.settle(ctx, key, order, head, decision, response, p);
        return settled instanceof Outcome.Committed ? Advance.of(Step.ADVANCED) : outcomeFailure(settled);
    }

    private Response call(RunContext ctx, Request request, boolean decide) {
        try {
            Response r = decide ? status.requestDecision(ctx, request) : status.reconcile(ctx, request);
            return r == null ? Response.of(Status.UNKNOWN, request, null, null) : r;
        } catch (RuntimeException e) {
            return Response.of(Status.UNKNOWN, request, null, null);
        }
    }

    private static Advance outcomeFailure(Outcome o) {
        if (o instanceof Outcome.Uncertain) return Advance.failed(new Failure("uncertain", "outcome-uncertain", false, null));
        if (o instanceof Outcome.Conflict c) return Advance.failed(new Failure("conflict", c.code(), false, null));
        if (o instanceof Outcome.Refused r) return Advance.failed(new Failure("invalid", r.code(), false, null));
        return Advance.failed(new Failure("unavailable", DB_DOWN, false, null));
    }

    // ---- startup reconcile ----

    /** Finishes up to limit open requested/uncertain/unsupported decisions. Never counts ticks or starts an order. */
    public ApprovalResult reconcile(RunContext scope, int limit) {
        if (limit < 1) return new ApprovalResult.Invalid("invalid-reconcile", "The limit must be positive.");
        RunContext ctx = system(scope);
        int examined = 0;
        int settled = 0;
        int open = 0;
        List<ObjectNode> failed = new ArrayList<>();
        String afterOrder = "";
        String afterStage = "";
        try {
            while (examined < limit) {
                List<Decision> page;
                try (Connection c = dataSource.getConnection()) {
                    page = ApprovalStore.openAfter(c, ctx, afterOrder, afterStage, Math.min(limit - examined, PAGE));
                }
                if (page.isEmpty()) break;
                for (Decision d : page) {
                    afterOrder = d.orderUuid();
                    afterStage = d.stage();
                    examined++;
                    Advance a = reconcileOne(ctx, d);
                    if (a == null) continue;
                    if (a.failure() != null) {
                        if (a.failure().policyWide()) return policyRefusal(a.failure());
                        failed.add(failure(d.orderUuid(), a.failure().status(), a.failure().code()));
                    } else if (a.step() == Step.ADVANCED) {
                        settled++;
                    } else {
                        open++;
                    }
                }
            }
        } catch (SQLException e) {
            return unavailableDb();
        }
        ObjectNode out = F.objectNode();
        out.put("examined", examined);
        out.put("settled", settled);
        out.put("open", open);
        out.putArray("failed").addAll(failed);
        return new ApprovalResult.Ok(out, false);
    }

    private Advance reconcileOne(RunContext ctx, Decision d) {
        try {
            OrderSourcePort.Found found = orders.find(ctx, d.orderUuid());
            if (!(found instanceof OrderSourcePort.Ready ready)) return Advance.failed(new Failure("unavailable", "order-not-ready", false, null));
            OrderSourcePort.SelectionOrder order = ready.order();
            ApprovalPolicy.Loaded loaded = ApprovalPolicy.load(policy, order.policyVersion(), order.approvalStages());
            if (loaded instanceof ApprovalPolicy.PolicyWide w) return Advance.failed(new Failure("unavailable", w.code(), true, null));
            if (loaded instanceof ApprovalPolicy.OrderScoped s) return Advance.failed(new Failure("unavailable", s.code(), false, null));
            Head head;
            try (Connection c = dataSource.getConnection()) {
                head = ApprovalStore.head(c, ctx, d.orderUuid()).orElse(null);
            }
            if (head == null || !"in-progress".equals(head.outcome()) || !head.currentStage().equals(d.stage())) return null;
            return resolve(ctx, "startup-" + d.attempts(), order, head, d, ((ApprovalPolicy.Ok) loaded).policy(), false);
        } catch (SQLException | RuntimeException e) {
            return Advance.failed(new Failure("unavailable", DB_DOWN, false, null));
        }
    }

    // ---- tick rows ----

    private record TickRow(String state, JsonNode result) {}

    private TickRow readTick(RunContext ctx, String tickId) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT state, result::text FROM approval_ticks WHERE environment_id = ? AND run_id = ? AND tick_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, tickId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String result = rs.getString(2);
                return new TickRow(rs.getString(1), result == null ? null : ApprovalStore.json(result));
            }
        }
    }
}
