package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.PendingOperations;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.jboss.logging.Logger;

/** The return plan service: intent in one command, the provider call outside any transaction, then a CAS settle. */
public final class ReturnPlans implements AutoCloseable {

    public static final String SYSTEM_ACTOR = "returns-system";
    public static final int PAGE = 100;
    static final String INVALID = "invalid-return-command";
    private static final Logger LOG = Logger.getLogger(ReturnPlans.class);
    private static final String REASON = "Your account cannot use this action.";
    private static final long DAY_MS = 86_400_000L;

    /** The caller as the server authenticated it: role (employee, greg or presenter) and, for an employee, her id. */
    public record Caller(String role, String employeeId) {
        public static Caller employee(String employeeId) {
            return new Caller("employee", employeeId);
        }

        public static Caller greg() {
            return new Caller("greg", null);
        }

        public static Caller presenter() {
            return new Caller("presenter", null);
        }

        boolean isEmployee() {
            return "employee".equals(role);
        }

        boolean mayRead() {
            return isEmployee() || "greg".equals(role) || "presenter".equals(role);
        }
    }

    public record Failure(String orderUuid, String code) {}

    /** What one progress run did; failed lists at most 20 orders that were skipped. */
    public record Summary(int orders, int applied, int waiting, int blocked, int uncertain, int idle, List<Failure> failed) {}

    private enum Kind { GOOD, WAITING, REFUSED, UNKNOWN }

    private record Snapshot(Instant now, ReturnSource source, PlanRow row, ReturnPolicy policy, PlanView.Handover handover,
            OutcomeRow outcome) {}

    /** An early exit carrying the refusal to answer; never escapes the public methods. */
    private static final class Refusal extends RuntimeException {
        final transient PlanResult.Refused refused;

        Refusal(PlanResult.Refused refused) {
            super(refused.code(), null, false, false);
            this.refused = refused;
        }
    }

    @FunctionalInterface
    private interface Body {
        PlanResult run() throws Exception;
    }

    private final ReturnPolicyPort policy;
    private final ReturnSourcePort sources;
    private final HandoverPort handovers;
    private final ReturnClock clock;
    private final ReturnProviderPort provider;
    private final CurrentCarPort currentCar;
    private final TransactionRunner runner;
    private final DataSource dataSource;
    private final ExecutorService calls = Executors.newThreadPerTaskExecutor(Thread.ofVirtual().name("return-call-", 0).factory());

    public ReturnPlans(ReturnPolicyPort policy, ReturnSourcePort sources, HandoverPort handovers, ReturnClock clock,
            ReturnProviderPort provider, CurrentCarPort currentCar, TransactionRunner runner, DataSource dataSource) {
        this.policy = policy;
        this.sources = sources;
        this.handovers = handovers;
        this.clock = clock;
        this.provider = provider;
        this.currentCar = currentCar;
        this.runner = runner;
        this.dataSource = dataSource;
    }

    @Override
    public void close() {
        calls.close();
    }

    // ---------------------------------------------------------------- public operations

    public PlanResult read(RunContext ctx, Caller caller, String orderUuid) {
        return guard(() -> {
            if (!caller.mayRead()) throw roleRequired();
            requireText(orderUuid, 128, "orderUuid", "Choose an order to view.");
            Instant now = now(ctx);
            ReturnSource source = source(ctx, caller, orderUuid);
            if (!source.applicable()) {
                return new PlanResult.Ok(PlanView.notApplicable(ctx.runId(), source,
                        currentCar.read(ctx, orderUuid, source).toJson(), policy.currentVersion(ctx.runId())));
            }
            return new PlanResult.Ok(project(ctx, snapshot(ctx, now, source)));
        });
    }

    public PlanResult request(RunContext ctx, Caller caller, String commandId, String orderUuid, String choice,
            String slotId, long expectedVersion) {
        return guard(() -> {
            if (!caller.isEmployee()) throw roleRequired();
            requireText(commandId, 200, "commandId", "Supply a command id of up to 200 characters.");
            requireText(orderUuid, 128, "orderUuid", "Choose an order to return.");
            requireText(choice, 64, "choice", "Choose how you want to return the car.");
            requireText(slotId, 64, "slotId", "Choose the slot you want.");
            if (expectedVersion < 0) throw invalid("expectedVersion", "Supply the plan version you read, or 0.");
            ReturnSource source = source(ctx, caller, orderUuid);
            ObjectNode input = obj().put("orderUuid", orderUuid).put("choice", choice).put("slotId", slotId)
                    .put("expectedVersion", expectedVersion);
            Command cmd = new Command("return-request", commandId, input);
            if (receipted(ctx, commandId)) return replay(ctx, cmd, source, "request");
            if (!source.applicable()) throw refuse(409, "return-not-applicable", "A new order has no current car to return.");
            Snapshot s = snapshot(ctx, now(ctx), source);
            PlanRow row = s.row();
            if (row != null) {
                if (row.choice.equals(choice) && row.requestedSlot.slotId().equals(slotId)) return answer(ctx, source, "request");
                if (expectedVersion != row.version) throw stale(ctx, s, row.version);
                throw refuse(409, "appointment-already-requested", "A slot is already requested for this order.");
            }
            if (expectedVersion != 0) throw stale(ctx, s, 0);
            ReturnPolicy.Rule rule = s.policy().rules().get(choice);
            if (rule == null) throw invalid("choice", "Choose one of the return options.");
            if (!"synthetic".equals(provider.mode()) && !"live".equals(provider.mode())) {
                throw new Refusal(new PlanResult.Refused(503, UnconfiguredReturnProvider.CODE,
                        "No return provider is configured. Ask the scheme team to check the scheme setup.", true, null, null));
            }
            ChoiceOffer offer = choiceOffer(rule, s.handover(), s.now());
            if (!offer.available()) {
                throw new Refusal(new PlanResult.Refused(409, "handover-not-ready", offer.reason(), false,
                        List.of(new PlanResult.Reason("choice", offer.reason())), null));
            }
            AppointmentSlot slot = offer.slots().stream().filter(x -> x.slotId().equals(slotId)).findFirst()
                    .orElseThrow(() -> invalid("slotId", "Choose one of the offered slots."));
            return open(ctx, cmd, s, choice, slot);
        });
    }

    public PlanResult acceptChange(RunContext ctx, Caller caller, String commandId, String orderUuid, String proposalId,
            long expectedVersion) {
        return guard(() -> {
            if (!caller.isEmployee()) throw roleRequired();
            requireText(commandId, 200, "commandId", "Supply a command id of up to 200 characters.");
            requireText(orderUuid, 128, "orderUuid", "Choose an order.");
            requireText(proposalId, 128, "proposalId", "Supply the proposed change to accept.");
            if (expectedVersion < 0) throw invalid("expectedVersion", "Supply the plan version you read.");
            ReturnSource source = source(ctx, caller, orderUuid);
            ObjectNode input = obj().put("orderUuid", orderUuid).put("proposalId", proposalId)
                    .put("expectedVersion", expectedVersion);
            Command cmd = new Command("return-accept", commandId, input);
            if (receipted(ctx, commandId)) return replay(ctx, cmd, source, "accept");
            if (!source.applicable()) throw refuse(409, "return-not-applicable", "A new order has no current car to return.");
            Snapshot s = snapshot(ctx, now(ctx), source);
            PlanRow row = s.row();
            if (row == null) throw refuse(404, "not-found", "No appointment was requested for this order.");
            if ("scheduled".equals(row.state) && proposalId.equals(row.acceptedProposalId)) return answer(ctx, source, "accept");
            if (!"change-proposed".equals(row.state)) throw refuse(409, "no-change-proposed", "There is no proposed change to accept.");
            if (!proposalId.equals(row.proposalId)) throw invalid("proposalId", "This is not the proposed change.");
            if (expectedVersion != row.version) throw stale(ctx, s, row.version);
            if (row.acceptOperationId != null) return answer(ctx, source, "accept");
            return openAccept(ctx, cmd, s, expectedVersion);
        });
    }

    /** The presenter tick (retry true) or startup (retry false: reconcile only, never a new provider write). */
    public Summary progress(RunContext ctx, Instant now, boolean retry) {
        RunContext sys = new RunContext(ctx.environmentId(), ctx.runId(), SYSTEM_ACTOR);
        int orders = 0;
        int applied = 0;
        int waiting = 0;
        int blocked = 0;
        int uncertain = 0;
        int idle = 0;
        List<Failure> failed = new ArrayList<>();
        String after = "";
        while (true) {
            List<PlanRow> page;
            try (Connection c = dataSource.getConnection()) {
                page = PlanRow.page(c, ctx, after, PAGE);
            } catch (SQLException e) {
                LOG.warn("Return progress page unreadable", e);
                if (failed.size() < 20) failed.add(new Failure(null, "return-plan-unavailable"));
                break;
            }
            for (PlanRow p : page) {
                orders++;
                try {
                    switch (progressOne(sys, p, now, retry)) {
                        case "applied" -> applied++;
                        case "waiting" -> waiting++;
                        case "blocked" -> blocked++;
                        case "uncertain" -> uncertain++;
                        default -> idle++;
                    }
                } catch (Refusal r) {
                    if (failed.size() < 20) failed.add(new Failure(p.orderUuid, r.refused.code()));
                } catch (Exception e) {
                    LOG.warnf(e, "Return progress failed for %s", p.orderUuid);
                    if (failed.size() < 20) failed.add(new Failure(p.orderUuid, "return-plan-unavailable"));
                }
            }
            if (page.size() < PAGE) break;
            after = page.get(page.size() - 1).orderUuid;
        }
        return new Summary(orders, applied, waiting, blocked, uncertain, idle, List.copyOf(failed));
    }

    // ---------------------------------------------------------------- command transactions

    /** Transaction 1 of a request: plan row, pending intent and exact payload; then the provider call and the settle. */
    private PlanResult open(RunContext ctx, Command cmd, Snapshot s, String choice, AppointmentSlot slot) throws Exception {
        ReturnSource source = s.source();
        String opId = opIds(ctx, source.orderUuid()).request();
        ObjectNode payload = obj().put("requestedAt", ReturnJson.format(s.now()));
        ObjectNode location = PlanView.location(source, s.policy().rules().get(choice));
        ObjectNode confirmation = obj().put("delaySeconds", s.policy().confirmDelaySeconds());
        confirmation.putObject("scenario").put("proposeChange", s.policy().scenario().proposeChange())
                .put("proposalReason", s.policy().scenario().proposalReason());
        confirmation.set("slotPolicy", s.policy().slotPolicy().toJson());
        PlanRow row = new PlanRow();
        row.orderUuid = source.orderUuid();
        row.employeeId = source.employeeId();
        row.oldContractId = source.oldContractId();
        row.entitlementSlotId = source.entitlementSlotId();
        row.sourceReference = source.sourceReference();
        row.choice = choice;
        row.location = location;
        row.policyVersion = s.policy().policyVersion();
        row.providerMode = provider.mode();
        row.requestedSlot = slot;
        row.confirmation = confirmation;
        row.requestOperationId = opId;
        Outcome o = runner.execute(ctx, cmd, tx -> {
            if (PlanRow.read(tx, source.orderUuid()) != null) throw new TxConflict("stale-version", "The return plan changed.");
            PlanRow.insert(tx, row, source);
            insertOperation(tx, opId, "request", source.orderUuid(), slot, payload);
            tx.emit(opId + ":requested", "return-requested", obj().put("orderUuid", source.orderUuid())
                    .put("employeeId", source.employeeId()).put("choice", choice).put("slotId", slot.slotId()));
            return WorkResult.ok(obj().put("orderUuid", source.orderUuid()).put("operationId", opId).put("step", "request"));
        });
        o = settleUncertain(ctx, cmd, o);
        if (!(o instanceof Outcome.Committed c)) throw mapOutcome(o);
        if (c.replayed()) return answer(ctx, source, "request");
        settleQuietly(ctx, opId, source.orderUuid(), "request", s.policy().providerTimeoutMs(), s.now());
        return answer(ctx, source, "request");
    }

    private PlanResult openAccept(RunContext ctx, Command cmd, Snapshot s, long expected) throws Exception {
        ReturnSource source = s.source();
        String opId = opIds(ctx, source.orderUuid()).accept();
        PlanRow seen = s.row();
        ObjectNode payload = obj().put("acceptedAt", ReturnJson.format(s.now()));
        payload.set("proposedSlot", seen.proposedSlot.toJson());
        payload.put("proposalId", seen.proposalId);
        Outcome o = runner.execute(ctx, cmd, tx -> {
            PlanRow p = PlanRow.read(tx, source.orderUuid());
            if (p == null || p.version != expected || !"change-proposed".equals(p.state)) {
                throw new TxConflict("stale-version", "The return plan changed.");
            }
            p.acceptOperationId = opId;
            p.setPending("accept", opId, "requesting");
            p.clearBlocked();
            insertOperation(tx, opId, "accept", source.orderUuid(), p.requestedSlot, payload);
            p.update(tx, expected);
            tx.emit(opId + ":accepted", "return-change-accepted", obj().put("orderUuid", source.orderUuid())
                    .put("employeeId", source.employeeId()).put("proposalId", p.proposalId));
            return WorkResult.ok(obj().put("orderUuid", source.orderUuid()).put("operationId", opId).put("step", "accept"));
        });
        o = settleUncertain(ctx, cmd, o);
        if (!(o instanceof Outcome.Committed c)) throw mapOutcome(o);
        if (c.replayed()) return answer(ctx, source, "accept");
        settleQuietly(ctx, opId, source.orderUuid(), "accept", s.policy().providerTimeoutMs(), s.now());
        return answer(ctx, source, "accept");
    }

    /** An uncertain commit is inspected once: committed carries on to the provider call, absent is refused for a retry. */
    private Outcome settleUncertain(RunContext ctx, Command cmd, Outcome o) {
        if (o instanceof Outcome.Uncertain u && runner.inspect(ctx, cmd.commandId()) instanceof Inspection.Committed c) {
            return new Outcome.Committed(c.result(), c.runRevision(), false, true);
        }
        return o;
    }

    /** The intent is durable by now, so a failed call or settle leaves the operation pending for reconcile. */
    private void settleQuietly(RunContext ctx, String opId, String orderUuid, String step, int timeoutMs, Instant now) {
        try {
            callAndSettle(ctx, opId, orderUuid, step, timeoutMs, now);
        } catch (Refusal | SQLException e) {
            LOG.warnf(e, "Return %s left pending for reconcile", step);
        }
    }

    /** Reads the stored operation, calls the provider outside any transaction, then settles it. */
    private String callAndSettle(RunContext ctx, String opId, String orderUuid, String step, int timeoutMs, Instant now)
            throws SQLException {
        RunContext sys = new RunContext(ctx.environmentId(), ctx.runId(), SYSTEM_ACTOR);
        OpRow op;
        PlanRow plan;
        try (Connection c = dataSource.getConnection()) {
            op = OpRow.read(c, ctx, opId);
            plan = PlanRow.read(c, ctx, orderUuid);
        }
        if (op == null || plan == null) throw refuse(503, "return-plan-unavailable", "The return plan is unavailable.");
        Call operation = new Call(ctx, op, plan);
        ReturnProviderPort.Result r = call(timeoutMs, () -> invoke(step, operation.value(), now));
        return settle(sys, op, plan, r);
    }

    /** Opens the confirm operation for a requested plan (once; a repeat finds it already there). */
    private String openConfirm(RunContext sys, PlanRow p) throws SQLException {
        String opId = opIds(sys, p.orderUuid).confirm();
        Instant requestedAt = null;
        for (JsonNode h : p.history) if ("requested".equals(h.path("state").asText())) requestedAt = ReturnJson.parse(h.path("at").asText(null));
        if (requestedAt == null) throw refuse(503, "return-plan-unavailable", "The request time is unreadable.");
        ObjectNode payload = obj().put("confirmAfter",
                ReturnJson.format(requestedAt.plusSeconds(p.confirmation.path("delaySeconds").asLong())));
        payload.set("scenario", p.confirmation.path("scenario"));
        payload.set("slotPolicy", p.confirmation.path("slotPolicy"));
        Command cmd = new Command("return-confirm-open", opId + ":open", obj().put("orderUuid", p.orderUuid).put("operationId", opId));
        Outcome o = runner.execute(sys, cmd, tx -> {
            PlanRow cur = PlanRow.read(tx, p.orderUuid);
            if (cur == null || cur.confirmOperationId != null || !"requested".equals(cur.state)) return WorkResult.ok(obj().put("operationId", opId));
            insertOperation(tx, opId, "confirm", p.orderUuid, cur.requestedSlot, payload);
            cur.confirmOperationId = opId;
            cur.update(tx, cur.version);
            return WorkResult.ok(obj().put("operationId", opId));
        });
        if (!(o instanceof Outcome.Committed)) throw mapOutcome(o);
        return opId;
    }

    // ---------------------------------------------------------------- settle and progress

    private String progressOne(RunContext sys, PlanRow p, Instant now, boolean retry) throws SQLException {
        ReturnPolicyReading reading = policy.read(sys.runId(), now, p.policyVersion);
        if (!(reading instanceof ReturnPolicyReading.Ok ok)) {
            ReturnPolicyReading.Unavailable u = (ReturnPolicyReading.Unavailable) reading;
            throw refuse(503, u.code(), u.reason());
        }
        int timeout = ok.policy().providerTimeoutMs();
        String opId = p.pendingOperationId;
        if (opId == null) {
            if ("scheduled".equals(p.state)) return progressOutcome(sys, p, ok.policy(), now, retry);
            if (!retry || !"requested".equals(p.state)) return "idle";
            opId = p.confirmOperationId != null ? p.confirmOperationId : openConfirm(sys, p);
        }
        OpRow op;
        PlanRow plan;
        try (Connection c = dataSource.getConnection()) {
            op = OpRow.read(c, sys, opId);
            plan = PlanRow.read(c, sys, p.orderUuid);
        }
        if (op == null || plan == null) throw refuse(503, "return-plan-unavailable", "The return operation is missing.");
        if (!op.open()) return "idle";
        Call operation = new Call(sys, op, plan);
        ReturnProviderPort.Result r;
        if (p.pendingOperationId != null) {
            r = call(timeout, () -> provider.reconcile(operation.value()));
            if (r != null && r.status() == ReturnProviderPort.Status.NOT_FOUND && opId.equals(r.operationId())) {
                if (!retry) return "waiting";
                r = call(timeout, () -> invoke(op.step(), operation.value(), now));
            }
        } else {
            r = call(timeout, () -> invoke(op.step(), operation.value(), now));
        }
        return settle(sys, op, plan, r);
    }

    /** Transaction 2: classify the answer and apply it to the operation and the plan by version CAS. */
    private String settle(RunContext sys, OpRow op, PlanRow seen, ReturnProviderPort.Result r) throws SQLException {
        Kind kind = classify(op, seen, r);
        String code = r == null ? null : r.code();
        String label = kind == Kind.GOOD ? "done" : kind.name().toLowerCase() + "-" + op.attempts();
        ObjectNode input = obj().put("kind", kind.name());
        if (kind == Kind.GOOD) input.set("response", r.toJson());
        else if (code != null) input.put("code", code);
        Command cmd = new Command("return-settle", op.operationId() + ":settle:" + label, input);
        Outcome o = runner.execute(sys, cmd, tx -> {
            OpRow fresh = OpRow.read(tx, op.operationId());
            if (fresh == null || !fresh.open()) return WorkResult.ok(text("settled"));
            PlanRow p = PlanRow.read(tx, op.orderUuid());
            if (p == null || !from(op.step()).equals(p.state)) return WorkResult.ok(text("settled"));
            PlanRow next = p.copy();
            if (op.operationId().equals(p.pendingOperationId)) next.clearPending();
            String result;
            switch (kind) {
                case GOOD -> {
                    applyGood(next, op, r);
                    PendingOperations.finalize(tx, op.operationId(), fresh.version(), "acknowledged", r.providerReference(), r.toJson());
                    result = "applied";
                }
                case WAITING -> result = "waiting";
                case REFUSED -> {
                    String c = r.code() != null ? r.code() : "unsupported";
                    String why = r.reason() != null ? r.reason() : "This update is not supported.";
                    next.setBlocked(op.step(), c, why);
                    PendingOperations.finalize(tx, op.operationId(), fresh.version(), "refused", null,
                            obj().put("status", "unsupported").put("code", c).put("reason", why));
                    result = "blocked";
                }
                default -> {
                    next.clearBlocked();
                    next.setPending(op.step(), op.operationId(), "unknown");
                    PendingOperations.markPending(tx, op.operationId(), fresh.version(), obj().put("status", "unknown"));
                    result = "uncertain";
                }
            }
            if (next.differsFrom(p)) next.update(tx, p.version);
            return WorkResult.ok(text(result));
        });
        if (o instanceof Outcome.Committed c) return c.result().asText("idle");
        if (o instanceof Outcome.Uncertain) return "uncertain";
        if (o instanceof Outcome.Conflict c && "stale-version".equals(c.code())) return "idle";
        throw mapOutcome(o);
    }

    private static String from(String step) {
        return switch (step) {
            case "request" -> "not-requested";
            case "confirm" -> "requested";
            default -> "change-proposed";
        };
    }

    private static void applyGood(PlanRow next, OpRow op, ReturnProviderPort.Result r) {
        String reached;
        switch (op.step()) {
            case "request" -> reached = "requested";
            case "accept" -> {
                reached = "scheduled";
                next.slot = next.proposedSlot;
                next.acceptedProposalId = next.proposalId;
            }
            default -> {
                if (r.status() == ReturnProviderPort.Status.SCHEDULED) {
                    reached = "scheduled";
                    next.slot = r.slot();
                } else {
                    reached = "change-proposed";
                    next.proposedSlot = r.proposedSlot();
                    next.proposalId = r.proposalId();
                }
            }
        }
        next.state = reached;
        next.clearBlocked();
        next.history.addObject().put("state", reached).put("at", ReturnJson.format(r.at()))
                .put("providerReference", r.providerReference());
    }

    /** Whether a provider answer is the step's expected success; anything else is refused, waiting or unknown. */
    private static Kind classify(OpRow op, PlanRow plan, ReturnProviderPort.Result r) {
        if (r == null) return Kind.UNKNOWN;
        boolean mine = op.operationId().equals(r.operationId());
        if (mine && "confirm".equals(op.step()) && r.status() == ReturnProviderPort.Status.IN_PROGRESS) return Kind.WAITING;
        if (r.status() == ReturnProviderPort.Status.UNSUPPORTED) return Kind.REFUSED;
        if (!mine || !op.orderUuid().equals(r.orderUuid()) || !op.step().equals(r.step())
                || !ReturnJson.text(r.providerReference(), 128) || r.at() == null) {
            return Kind.UNKNOWN;
        }
        String requested = plan.requestedSlot.slotId();
        boolean good = switch (op.step()) {
            case "request" -> r.status() == ReturnProviderPort.Status.ACCEPTED && slotIs(r.slot(), requested);
            case "confirm" -> (r.status() == ReturnProviderPort.Status.SCHEDULED && slotIs(r.slot(), requested))
                    || (r.status() == ReturnProviderPort.Status.PROPOSED && r.proposedSlot() != null && r.proposedSlot().valid()
                            && !r.proposedSlot().slotId().equals(requested) && ReturnJson.text(r.proposalId(), 128));
            default -> r.status() == ReturnProviderPort.Status.SCHEDULED
                    && slotIs(r.slot(), op.payload().path("proposedSlot").path("slotId").asText(null));
        };
        return good ? Kind.GOOD : Kind.UNKNOWN;
    }

    private static boolean slotIs(AppointmentSlot slot, String slotId) {
        return slot != null && slotId != null && slotId.equals(slot.slotId());
    }

    // ---------------------------------------------------------------- outcomes

    /** A scheduled plan's outcome: open it on a presenter tick if the policy enables it, else reconcile what is open. */
    private String progressOutcome(RunContext sys, PlanRow p, ReturnPolicy pol, Instant now, boolean retry) throws SQLException {
        OutcomeRow rec;
        try (Connection c = dataSource.getConnection()) {
            rec = OutcomeRow.read(c, sys, p.orderUuid);
        }
        String opId;
        boolean fresh = rec == null;
        if (fresh) {
            if (!retry || !pol.outcome().enabled()) return "idle";
            opId = openOutcome(sys, p, pol.outcome());
        } else if (rec.awaiting()) {
            opId = rec.operationId;
        } else {
            return "idle";
        }
        OpRow op;
        PlanRow plan;
        try (Connection c = dataSource.getConnection()) {
            op = OpRow.read(c, sys, opId);
            plan = PlanRow.read(c, sys, p.orderUuid);
            rec = OutcomeRow.read(c, sys, p.orderUuid);
        }
        if (op == null || plan == null || rec == null) throw refuse(503, "return-plan-unavailable", "The return outcome is missing.");
        if (!op.open() || !rec.awaiting()) return "idle";
        Call operation = new Call(sys, op, plan);
        int timeout = pol.providerTimeoutMs();
        ReturnProviderPort.Result r;
        if (fresh) {
            r = call(timeout, () -> provider.confirmOutcome(operation.value(), now));
        } else {
            r = call(timeout, () -> provider.reconcile(operation.value()));
            if (r != null && r.status() == ReturnProviderPort.Status.NOT_FOUND && opId.equals(r.operationId())) {
                if (!retry) return "waiting";
                r = call(timeout, () -> provider.confirmOutcome(operation.value(), now));
            }
        }
        return settleOutcome(sys, op, rec, r);
    }

    /** One transaction records the awaiting outcome, its intent and its exact payload (once; a repeat finds it there). */
    private String openOutcome(RunContext sys, PlanRow p, ReturnPolicy.OutcomeConfig cfg) throws SQLException {
        String opId = outcomeOpId(sys.runId(), p.orderUuid);
        AppointmentSlot slot = p.slot;
        ObjectNode appointment = obj().put("purpose", "return").put("slotId", slot.slotId());
        appointment.set("slot", slot.toJson());
        appointment.put("providerReference", p.history.isEmpty() ? null
                : p.history.get(p.history.size() - 1).path("providerReference").asText(null));
        Instant confirmAfter = slot.end().plusSeconds(cfg.delaySecondsAfterSlotEnd());
        ObjectNode payload = obj().put("confirmAfter", ReturnJson.format(confirmAfter)).put("outcome", cfg.outcome());
        payload.set("appointment", appointment);
        OutcomeRow rec = new OutcomeRow();
        rec.orderUuid = p.orderUuid;
        rec.operationId = opId;
        rec.expectedOutcome = cfg.outcome();
        rec.confirmAfter = confirmAfter;
        rec.appointment = appointment;
        rec.location = p.location;
        rec.oldContractId = p.oldContractId;
        rec.entitlementSlotId = p.entitlementSlotId;
        rec.exceptionType = cfg.exceptionType();
        rec.policyVersion = p.policyVersion;
        Command cmd = new Command("return-outcome-open", opId + ":open", obj().put("orderUuid", p.orderUuid).put("operationId", opId));
        Outcome o = runner.execute(sys, cmd, tx -> {
            PlanRow cur = PlanRow.read(tx, p.orderUuid);
            if (cur == null || cur.pendingOperationId != null || !"scheduled".equals(cur.state)
                    || OutcomeRow.read(tx, p.orderUuid) != null) {
                return WorkResult.ok(obj().put("operationId", opId));
            }
            rec.insert(tx);
            insertOperation(tx, opId, "outcome", p.orderUuid, slot, payload);
            return WorkResult.ok(obj().put("operationId", opId));
        });
        if (!(o instanceof Outcome.Committed)) throw mapOutcome(o);
        return opId;
    }

    /** The provider's answer to the outcome write, applied by CAS; a returned car changes the current car in the same transaction. */
    private String settleOutcome(RunContext sys, OpRow op, OutcomeRow seen, ReturnProviderPort.Result r) throws SQLException {
        Kind kind = classifyOutcome(op, seen, r);
        ReturnSource source = null;
        if (kind == Kind.GOOD && "returned".equals(seen.expectedOutcome)) source = outcomeSource(sys, op.orderUuid());
        ReturnSource carSource = source;
        String code = r == null ? null : r.code();
        String label = kind == Kind.GOOD ? "done" : kind.name().toLowerCase() + "-" + op.attempts();
        ObjectNode input = obj().put("kind", kind.name());
        if (kind == Kind.GOOD) input.set("response", r.toJson());
        else if (code != null) input.put("code", code);
        Command cmd = new Command("return-outcome-settle", op.operationId() + ":settle:" + label, input);
        Outcome o = runner.execute(sys, cmd, tx -> {
            OpRow fresh = OpRow.read(tx, op.operationId());
            OutcomeRow out = OutcomeRow.read(tx, op.orderUuid());
            PlanRow plan = PlanRow.read(tx, op.orderUuid());
            if (fresh == null || !fresh.open() || out == null || !out.awaiting() || plan == null) return WorkResult.ok(text("settled"));
            long seenVersion = out.version;
            String result;
            switch (kind) {
                case GOOD -> {
                    out.state = out.expectedOutcome;
                    out.occurredAt = r.at();
                    out.providerReference = r.providerReference();
                    out.pendingLastKnown = null;
                    out.blockedCode = null;
                    out.blockedReason = null;
                    if ("returned".equals(out.state)) {
                        CurrentCarEvent e = new CurrentCarEvent(CurrentCarEvent.RETURN_CONFIRMED, op.orderUuid(), plan.employeeId,
                                r.at(), r.providerReference(), out.oldContractId, null, out.location,
                                out.appointment.path("slotId").asText(null), out.appointment.path("providerReference").asText(null));
                        CurrentCarResult applied = currentCar.apply(tx, e, carSource);
                        if (applied instanceof CurrentCarResult.Refused x) return WorkResult.refuse(x.code(), x.message());
                    } else {
                        tx.emit(op.operationId() + ":missed", out.exceptionType, missedEvent(out, plan, r));
                    }
                    PendingOperations.finalize(tx, op.operationId(), fresh.version(), "acknowledged", r.providerReference(), r.toJson());
                    closeOutcome(tx, op.orderUuid());
                    result = "applied";
                }
                case WAITING -> {
                    result = "waiting";
                    if (!"waiting".equals(out.pendingLastKnown) || out.blockedCode != null) {
                        out.pendingLastKnown = "waiting";
                        out.blockedCode = null;
                        out.blockedReason = null;
                    } else {
                        return WorkResult.ok(text(result));
                    }
                }
                case REFUSED -> {
                    String c = r.code() != null ? r.code() : "unsupported";
                    String why = r.reason() != null ? r.reason() : "This update is not supported.";
                    out.pendingLastKnown = null;
                    out.blockedCode = c;
                    out.blockedReason = why;
                    PendingOperations.finalize(tx, op.operationId(), fresh.version(), "refused", null,
                            obj().put("status", "unsupported").put("code", c).put("reason", why));
                    closeOutcome(tx, op.orderUuid());
                    result = "blocked";
                }
                default -> {
                    out.pendingLastKnown = "unknown";
                    out.blockedCode = null;
                    out.blockedReason = null;
                    PendingOperations.markPending(tx, op.operationId(), fresh.version(), obj().put("status", "unknown"));
                    result = "uncertain";
                }
            }
            out.update(tx, seenVersion);
            return WorkResult.ok(text(result));
        });
        if (o instanceof Outcome.Committed c) return c.result().asText("idle");
        if (o instanceof Outcome.Uncertain) return "uncertain";
        if (o instanceof Outcome.Conflict c && "stale-version".equals(c.code())) return "idle";
        throw mapOutcome(o);
    }

    /** The exception a missed return raises; the renewal authority is the approvals Story's, so it is not read here. */
    private static ObjectNode missedEvent(OutcomeRow out, PlanRow plan, ReturnProviderPort.Result r) {
        ObjectNode e = obj().put("employeeId", plan.employeeId).put("orderUuid", out.orderUuid)
                .put("occurredAt", ReturnJson.format(r.at())).put("exceptionType", out.exceptionType)
                .put("oldContractId", out.oldContractId).put("entitlementSlotId", out.entitlementSlotId)
                .put("renewalAuthority", "not-read");
        e.set("location", out.location);
        e.set("appointment", out.appointment.deepCopy());
        e.put("providerReference", r.providerReference()).put("policyVersion", out.policyVersion).put("fictional", true);
        return e;
    }

    /** Takes a settled or refused outcome out of the progress index; the plan's version is not a user-visible change. */
    private static void closeOutcome(Tx tx, String orderUuid) throws SQLException {
        RunContext c = tx.context();
        tx.write("UPDATE return_plans SET outcome_closed = true, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", c.environmentId(), c.runId(), orderUuid);
    }

    /** The order's selection as the current-car boundary needs it; an unreadable one leaves the outcome open for the next tick. */
    private ReturnSource outcomeSource(RunContext sys, String orderUuid) {
        if (sources.read(sys, orderUuid) instanceof ReturnSourceReading.Found f) return f.source();
        throw refuse(503, "return-plan-unavailable", "The order's selection could not be read.", true);
    }

    /** Whether a provider answer is the expected outcome; in-progress waits, unsupported blocks, anything else is unknown. */
    private static Kind classifyOutcome(OpRow op, OutcomeRow rec, ReturnProviderPort.Result r) {
        if (r == null) return Kind.UNKNOWN;
        boolean mine = op.operationId().equals(r.operationId());
        if (mine && r.status() == ReturnProviderPort.Status.IN_PROGRESS) return Kind.WAITING;
        if (r.status() == ReturnProviderPort.Status.UNSUPPORTED) return Kind.REFUSED;
        boolean good = mine && op.orderUuid().equals(r.orderUuid()) && ReturnProviderPort.STEP_OUTCOME.equals(r.step())
                && r.status().wire().equals(rec.expectedOutcome) && ReturnJson.text(r.providerReference(), 128) && r.at() != null;
        return good ? Kind.GOOD : Kind.UNKNOWN;
    }

    // ---------------------------------------------------------------- provider calls

    private record Call(RunContext ctx, OpRow op, PlanRow plan) {
        ReturnProviderPort.Operation value() {
            AppointmentSlot slot = ReturnProviderPort.STEP_OUTCOME.equals(op.step()) ? plan.slot : plan.requestedSlot;
            return new ReturnProviderPort.Operation(ctx.environmentId(), ctx.runId(), op.operationId(), op.orderUuid(), op.step(),
                    slot, op.payload().deepCopy(), op.inputDigest());
        }
    }

    private ReturnProviderPort.Result invoke(String step, ReturnProviderPort.Operation operation, Instant now) {
        return switch (step) {
            case "request" -> provider.requestSlot(operation);
            case "confirm" -> provider.confirm(operation, now);
            case "outcome" -> provider.confirmOutcome(operation, now);
            default -> provider.acceptProposal(operation);
        };
    }

    /** Runs the provider call with the policy timeout; a timeout, exception or null answer is unknown (null). */
    private ReturnProviderPort.Result call(int timeoutMs, Supplier<ReturnProviderPort.Result> work) {
        Future<ReturnProviderPort.Result> f = calls.submit(work::get);
        try {
            return f.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (TimeoutException | ExecutionException e) {
            f.cancel(true);
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            f.cancel(true);
            return null;
        }
    }

    // ---------------------------------------------------------------- reads and projection

    private Instant now(RunContext ctx) {
        try {
            return clock.now(ctx).orElseThrow(() -> new Refusal(new PlanResult.Refused(503, "return-plan-unavailable",
                    "The demo clock has not been set. Try again shortly.", true, null, null)));
        } catch (IllegalStateException e) {
            throw refuse(503, "return-plan-unavailable", "The return plan is unavailable. Try again shortly.", true);
        }
    }

    /** The order's selection, with an employee limited to her own order. */
    private ReturnSource source(RunContext ctx, Caller caller, String orderUuid) {
        ReturnSourceReading reading = sources.read(ctx, orderUuid);
        ReturnSource source;
        if (reading instanceof ReturnSourceReading.Found f) {
            source = f.source();
        } else if (reading instanceof ReturnSourceReading.NotFound) {
            throw refuse(404, "not-found", "No order was found.");
        } else if (reading instanceof ReturnSourceReading.Invalid i) {
            throw new Refusal(new PlanResult.Refused(503, i.code(), i.reason(), i.retryable(), null, null));
        } else {
            ReturnSourceReading.Unavailable u = (ReturnSourceReading.Unavailable) reading;
            throw new Refusal(new PlanResult.Refused(503, u.code(), u.reason(), u.retryable(), null, null));
        }
        if (caller.isEmployee() && (caller.employeeId() == null || !caller.employeeId().equals(source.employeeId()))) {
            throw new Refusal(new PlanResult.Refused(403, "not-resource-owner", REASON, false, null, null));
        }
        return source;
    }

    private Snapshot snapshot(RunContext ctx, Instant now, ReturnSource source) throws SQLException {
        PlanRow row;
        OutcomeRow outcome = null;
        try (Connection c = dataSource.getConnection()) {
            row = PlanRow.read(c, ctx, source.orderUuid());
            if (row != null && "scheduled".equals(row.state)) outcome = OutcomeRow.read(c, ctx, source.orderUuid());
        }
        String version = row != null ? row.policyVersion : policy.currentVersion(ctx.runId());
        ReturnPolicyReading reading = version == null ? ReturnPolicyReading.unavailable()
                : policy.read(ctx.runId(), now, version);
        if (!(reading instanceof ReturnPolicyReading.Ok ok)) {
            ReturnPolicyReading.Unavailable u = (ReturnPolicyReading.Unavailable) reading;
            throw new Refusal(new PlanResult.Refused(503, u.code(), u.reason(), u.retryable(), null, null));
        }
        PlanView.Handover handover;
        HandoverReading h = handovers.read(ctx, source.orderUuid());
        if (h instanceof HandoverReading.Found f) {
            handover = new PlanView.Handover(f.state(), f.slot(), f.providerReference());
        } else if (h instanceof HandoverReading.NotFound) {
            handover = new PlanView.Handover("not-requested", null, null);
        } else {
            HandoverReading.Unavailable u = (HandoverReading.Unavailable) h;
            throw new Refusal(new PlanResult.Refused(503, u.code(), u.reason(), u.retryable(), null, null));
        }
        return new Snapshot(now, source, row, ok.policy(), handover, outcome);
    }

    private ObjectNode project(RunContext ctx, Snapshot s) throws SQLException {
        PlanRow row = s.row();
        boolean planning = row == null || "not-requested".equals(row.state);
        Map<String, ChoiceOffer> offers = new java.util.LinkedHashMap<>();
        for (ReturnPolicy.Choice c : s.policy().choices()) {
            offers.put(c.id(), planning ? choiceOffer(s.policy().rules().get(c.id()), s.handover(), s.now())
                    : ChoiceOffer.closed("Your return is already planned.", null));
        }
        JsonNode relationship = currentCar.read(ctx, s.source().orderUuid(), s.source()).toJson();
        return PlanView.build(ctx.runId(), s.source(), row, s.policy(), s.handover(), offers,
                row != null ? row.providerMode : provider.mode(), s.outcome(), relationship);
    }

    /** Slots for one choice from the keyed rules; the handover must already be in a state the rule names. */
    private ChoiceOffer choiceOffer(ReturnPolicy.Rule rule, PlanView.Handover handover, Instant now) {
        if (!rule.requiresHandoverStates().contains(handover.state())) {
            return ChoiceOffer.closed("completed".equals(handover.state()) ? "Your new car has already been handed over."
                    : "Confirm your new car's handover first.", null);
        }
        AppointmentSlot slot = handover.slot();
        if (slot == null) return ChoiceOffer.closed("Your new car's handover has no confirmed time yet.", null);
        if ("handover-slot".equals(rule.slot())) return new ChoiceOffer(true, List.of(slot), null, null);
        ReturnProviderPort.Offer offer = provider.offerSlots(rule.slots(), now);
        if (offer.status() == ReturnProviderPort.Status.UNSUPPORTED) {
            return ChoiceOffer.closed(offer.reason() != null ? offer.reason() : "Slots are not available in this mode.",
                    offer.code() != null ? offer.code() : "unsupported");
        }
        if (offer.status() != ReturnProviderPort.Status.OK || offer.slots() == null) {
            return ChoiceOffer.closed("Slots are unavailable. Try again shortly.", "offer-unavailable");
        }
        Instant from = rule.notBeforeHandoverEnd() ? slot.end() : Instant.MIN;
        Instant to = slot.end().plusMillis(rule.maxDaysAfterHandover() * DAY_MS);
        List<AppointmentSlot> slots = offer.slots().stream()
                .filter(x -> !x.start().isBefore(from) && !x.start().isAfter(to)).toList();
        return slots.isEmpty() ? ChoiceOffer.closed("No return slots are free after your handover.", "no-return-slots")
                : new ChoiceOffer(true, slots, null, null);
    }

    /** The plan as it stands now, as the answer to a command: pending is 202, a blocked step is unsupported. */
    private PlanResult answer(RunContext ctx, ReturnSource source, String step) throws SQLException {
        Snapshot s = snapshot(ctx, now(ctx), source);
        ObjectNode json = project(ctx, s);
        PlanRow row = s.row();
        if (row != null && row.pendingOperationId != null) return new PlanResult.Pending(json, row.pendingOperationId);
        if (row != null && row.blockedCode != null && step.equals(row.blockedStep)) {
            return new PlanResult.Refused(422, row.blockedCode, row.blockedReason, false, null, json);
        }
        return new PlanResult.Ok(json);
    }

    private PlanResult replay(RunContext ctx, Command cmd, ReturnSource source, String step) throws SQLException {
        Outcome o = runner.execute(ctx, cmd, tx -> WorkResult.refuse("receipt-missing", "The command receipt was not found."));
        if (o instanceof Outcome.Committed c && c.replayed()) return answer(ctx, source, step);
        throw mapOutcome(o);
    }

    private boolean receipted(RunContext ctx, String commandId) {
        return runner.inspect(ctx, commandId) instanceof Inspection.Committed;
    }

    private Refusal stale(RunContext ctx, Snapshot s, long current) throws SQLException {
        return new Refusal(new PlanResult.Refused(409, "stale-version",
                "The return plan changed since you read it. Its version is now " + current + ".", true, null, project(ctx, s)));
    }

    // ---------------------------------------------------------------- small helpers

    private PlanResult guard(Body body) {
        try {
            return body.run();
        } catch (Refusal r) {
            return r.refused;
        } catch (Exception e) {
            LOG.warn("Return plan operation failed", e);
            return new PlanResult.Refused(503, "return-plan-unavailable", "The return plan is unavailable. Try again shortly.",
                    true, null, null);
        }
    }

    private static Refusal mapOutcome(Outcome o) {
        if (o instanceof Outcome.Conflict c) return new Refusal(new PlanResult.Refused(409, c.code(), c.message(), c.retryable(), null, null));
        if (o instanceof Outcome.Refused r) return new Refusal(new PlanResult.Refused(422, r.code(), r.message(), false, null, null));
        if (o instanceof Outcome.Uncertain) {
            return refuse(503, "outcome-uncertain", "The update may not have completed. Check the plan before trying again.", true);
        }
        return refuse(503, "return-plan-unavailable", "The return plan is unavailable. Try again shortly.", true);
    }

    private static Refusal roleRequired() {
        return new Refusal(new PlanResult.Refused(403, "role-required", REASON, false, null, null));
    }

    private static Refusal refuse(int http, String code, String reason) {
        return refuse(http, code, reason, false);
    }

    private static Refusal refuse(int http, String code, String reason, boolean retryable) {
        return new Refusal(new PlanResult.Refused(http, code, reason, retryable, null, null));
    }

    private static Refusal invalid(String field, String reason) {
        return new Refusal(new PlanResult.Refused(400, INVALID, reason, false, List.of(new PlanResult.Reason(field, reason)), null));
    }

    private static void requireText(String v, int max, String field, String reason) {
        if (!ReturnJson.text(v, max)) throw invalid(field, reason);
    }

    private static JsonNode text(String v) {
        return com.fasterxml.jackson.databind.node.TextNode.valueOf(v);
    }

    private static ObjectNode obj() {
        return ReturnJson.JSON.createObjectNode();
    }

    private record Ids(String request, String confirm, String accept) {}

    static String outcomeOpId(String runId, String orderUuid) {
        ArrayNode key = ReturnJson.JSON.createArrayNode().add(runId).add(orderUuid);
        return "return-outcome:" + Canonical.digest(key).substring(0, 32) + ":outcome";
    }

    private static Ids opIds(RunContext ctx, String orderUuid) {
        return opIds(ctx.runId(), orderUuid);
    }

    private static Ids opIds(String runId, String orderUuid) {
        ArrayNode key = ReturnJson.JSON.createArrayNode().add(runId).add(orderUuid);
        String base = "return-appointment:" + Canonical.digest(key).substring(0, 32);
        return new Ids(base + ":request", base + ":confirm", base + ":accept");
    }

    /** The intent and the exact provider payload, so a retry or reconcile resends identical input. */
    private static void insertOperation(Tx tx, String opId, String step, String orderUuid, AppointmentSlot slot,
            ObjectNode payload) throws SQLException {
        ObjectNode stable = obj().put("orderUuid", orderUuid).put("step", step);
        stable.set("slot", slot.toJson());
        stable.set("payload", payload);
        PendingOperations.recordIntent(tx, opId, "outcome".equals(step) ? "return-outcome" : "return-appointment-" + step, opId, stable);
        RunContext c = tx.context();
        tx.write("INSERT INTO return_operations (environment_id, run_id, operation_id, order_uuid, step, payload, input_digest) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)", c.environmentId(), c.runId(), opId, orderUuid, step, payload,
                Canonical.digest(stable));
    }
}
