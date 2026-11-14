package gcsp.api.approvals;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalStore.Decision;
import gcsp.api.approvals.ApprovalStore.Head;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Optional;

/** The write commands of the approval lifecycle: each is one short TransactionRunner command with a stable id. */
final class ApprovalCommands {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    static final String CLOCK_CHANGED = "approval-clock-changed";

    private final TransactionRunner runner;

    ApprovalCommands(TransactionRunner runner) {
        this.runner = runner;
    }

    private static ObjectNode obj() {
        return F.objectNode();
    }

    // ---- tick ----

    /** Records a delivered tick; same id and digest replays, a changed input or a clock that does not follow conflicts. */
    Outcome recordTick(RunContext ctx, String tickId, Instant now, long clockVersion) {
        ObjectNode input = obj();
        input.put("tickId", tickId);
        input.put("now", Time.format(now));
        input.put("clockVersion", clockVersion);
        String digest = Canonical.digest(input);
        return runner.execute(ctx, new Command("approval.tick.record", "approval:tick:" + tickId, input), tx -> {
            Optional<long[]> top = tx.first("SELECT clock_version, now FROM approval_ticks WHERE environment_id = ? "
                    + "AND run_id = ? ORDER BY clock_version DESC, created_at DESC LIMIT 1",
                    rs -> new long[] {rs.getLong(1), rs.getObject(2, OffsetDateTime.class).toInstant().toEpochMilli()},
                    ctx.environmentId(), ctx.runId());
            if (top.isPresent()) {
                long version = top.get()[0];
                Instant at = Instant.ofEpochMilli(top.get()[1]);
                boolean bad = clockVersion < version || (clockVersion == version && !now.equals(at))
                        || (clockVersion > version && !now.isAfter(at));
                if (bad) throw new TxConflict(CLOCK_CHANGED, "The tick does not follow the run's clock.");
            }
            tx.write("INSERT INTO approval_ticks (environment_id, run_id, tick_id, now, clock_version, input_digest, "
                    + "state) VALUES (?, ?, ?, ?, ?, ?, 'pending')", ctx.environmentId(), ctx.runId(), tickId, now,
                    clockVersion, digest);
            return WorkResult.ok(obj().put("delivered", true));
        });
    }

    Outcome completeTick(RunContext ctx, String tickId, ObjectNode result) {
        ObjectNode input = obj().put("tickId", tickId);
        return runner.execute(ctx, new Command("approval.tick.complete", "approval:tick-complete:" + tickId, input), tx -> {
            tx.cas("UPDATE approval_ticks SET state = 'completed', result = ?, version = version + 1, updated_at = now() "
                    + "WHERE environment_id = ? AND run_id = ? AND tick_id = ? AND state = 'pending'", result,
                    ctx.environmentId(), ctx.runId(), tickId);
            return WorkResult.ok(result);
        });
    }

    // ---- order lifecycle ----

    /** Creates the head at revision 1 with the first approval stage pending and its decision (phase waiting). */
    Outcome start(RunContext ctx, String tickId, Instant now, OrderSourcePort.SelectionOrder order,
            ApprovalPolicy.Policy policy) {
        ObjectNode input = obj();
        input.put("orderUuid", order.orderUuid());
        input.put("operationId", order.operationId());
        input.put("policyVersion", policy.policyVersion());
        ArrayNode list = input.putArray("stageList");
        policy.stageList().forEach(list::add);
        return runner.execute(ctx, new Command("approval.start", "approval:start:" + order.orderUuid(), input), tx -> {
            if (ApprovalStore.head(tx.connection(), ctx, order.orderUuid()).isPresent()) {
                return WorkResult.ok(obj().put("started", false));
            }
            Head initial = ApprovalStore.initial(order, policy);
            String first = policy.stageList().get(1);
            String op = ApprovalStore.decisionId(ctx.runId(), order.orderUuid(), first);
            ArrayNode stages = initial.stages().deepCopy();
            for (int i = 0; i < stages.size(); i++) {
                if (first.equals(stages.get(i).path("stage").asText())) {
                    stages.set(i, ApprovalStore.stageRow(first, "pending", Time.format(now), null, op));
                }
            }
            ObjectNode transition = transition(order.orderUuid(), first, "pending", Time.format(now));
            Head head = new Head(order.orderUuid(), order.employeeId(), order.entitlementSlotId(), order.renewalId(),
                    order.route(), initial.source(), policy.policyVersion(), policy.stageList(), first, "in-progress",
                    stages, transition, 1, 1);
            insertHead(tx, ctx, head);
            insertDecision(tx, ctx, order.orderUuid(), first, policy, tickId);
            insertRevision(tx, ctx, head);
            return WorkResult.ok(obj().put("started", true));
        });
    }

    /** Counts one tick on a waiting decision, once per tick id; due makes it requested with its time durable. */
    Outcome count(RunContext ctx, String tickId, Instant now, String operationId) {
        ObjectNode input = obj().put("tickId", tickId).put("operationId", operationId);
        return runner.execute(ctx, new Command("approval.count", "approval:count:" + tickId + ":" + operationId, input),
                tx -> {
                    Decision d = ApprovalStore.decisionById(tx.connection(), ctx, operationId).orElse(null);
                    if (d == null) throw new TxConflict("decision-missing", "The decision does not exist.");
                    if (!"waiting".equals(d.phase()) || tickId.equals(d.lastTickId())) return WorkResult.ok(snapshot(d));
                    int elapsed = d.ticksElapsed() + 1;
                    boolean due = elapsed >= d.ticksRequired();
                    tx.cas("UPDATE approval_decisions SET ticks_elapsed = ?, phase = ?, occurred_at = ?, last_tick_id = ?, "
                            + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                            + "AND operation_id = ? AND version = ?", elapsed, due ? "requested" : "waiting",
                            due ? now : null, tickId, ctx.environmentId(), ctx.runId(), operationId, d.version());
                    return WorkResult.ok(obj().put("phase", due ? "requested" : "waiting").put("ticksElapsed", elapsed));
                });
    }

    /** A response that is not a matching confirmation: the decision stays open as unsupported or uncertain. */
    Outcome unsettled(RunContext ctx, String key, String operationId, ApprovalStatusProvider.Response response) {
        boolean refused = response != null && response.status() == ApprovalStatusProvider.Status.UNSUPPORTED;
        ObjectNode summary = obj();
        summary.put("status", response == null || response.status() == null ? "unknown"
                : response.status().name().toLowerCase().replace('_', '-'));
        if (refused) {
            summary.put("code", response.code() == null ? "unsupported" : response.code());
            summary.put("reason", response.reason());
        }
        return runner.execute(ctx, new Command("approval.unsettled", "approval:unsettled:" + key + ":" + operationId,
                summary), tx -> {
            Decision d = ApprovalStore.decisionById(tx.connection(), ctx, operationId).orElse(null);
            if (d == null || "confirmed".equals(d.phase())) return WorkResult.ok(obj().put("phase", "confirmed"));
            ObjectNode stored = refused ? summary.deepCopy() : obj().put("status", "unknown");
            tx.cas("UPDATE approval_decisions SET phase = ?, attempts = attempts + 1, outcome = ?, version = version + 1, "
                    + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ?",
                    refused ? "unsupported" : "uncertain", stored, ctx.environmentId(), ctx.runId(), operationId,
                    d.version());
            return WorkResult.ok(obj().put("phase", refused ? "unsupported" : "uncertain"));
        });
    }

    /** Applies a matching confirmation: stage state, next stage or outcome, revision, and the decline event. */
    Outcome settle(RunContext ctx, String tickId, OrderSourcePort.SelectionOrder source, Head seen,
            Decision decision, ApprovalStatusProvider.Response response, ApprovalPolicy.Policy policy) {
        Instant at = response.decidedAt() != null ? response.decidedAt() : decision.occurredAt();
        ObjectNode input = obj();
        input.put("operationId", decision.operationId());
        input.put("state", response.state());
        input.put("providerReference", response.providerReference());
        input.put("decidedAt", Time.format(at));
        String atText = Time.format(at);
        return runner.execute(ctx, new Command("approval.settle", "approval:settle:" + decision.operationId(), input), tx -> {
            Decision d = ApprovalStore.decisionById(tx.connection(), ctx, decision.operationId()).orElse(null);
            if (d == null) throw new TxConflict("decision-missing", "The decision does not exist.");
            if ("confirmed".equals(d.phase())) return WorkResult.ok(obj().put("settled", false));
            Head head = ApprovalStore.head(tx.connection(), ctx, source.orderUuid()).orElse(null);
            if (head == null || head.revision() != seen.revision()) {
                throw new TxConflict("stale-version", "lifecycle-revision-changed");
            }
            tx.cas("UPDATE approval_decisions SET phase = 'confirmed', provider_reference = ?, outcome = ?, "
                    + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                    + "AND operation_id = ? AND version = ?", response.providerReference(), confirmation(response, atText),
                    ctx.environmentId(), ctx.runId(), d.operationId(), d.version());
            String stage = d.stage();
            int index = head.stageList().indexOf(stage);
            String next = "approved".equals(response.state()) && index + 1 < head.stageList().size()
                    ? head.stageList().get(index + 1) : null;
            ArrayNode stages = head.stages().deepCopy();
            for (int i = 0; i < stages.size(); i++) {
                ObjectNode row = (ObjectNode) stages.get(i);
                String name = row.path("stage").asText();
                if (name.equals(stage)) {
                    row.put("state", response.state());
                    row.put("at", atText);
                    row.put("providerReference", response.providerReference());
                } else if (name.equals(next)) {
                    insertDecision(tx, ctx, source.orderUuid(), next, policy, tickId);
                    row.put("state", "pending");
                    row.put("at", atText);
                    row.put("operationId", ApprovalStore.decisionId(ctx.runId(), source.orderUuid(), next));
                }
            }
            String outcome = "declined".equals(response.state()) ? "declined" : next != null ? "in-progress" : "sent-to-ordering";
            ObjectNode transition = transition(source.orderUuid(), stage, response.state(), atText);
            Head updated = new Head(head.orderUuid(), head.employeeId(), head.slotId(), head.renewalId(), head.route(),
                    head.source(), head.policyVersion(), head.stageList(), next != null ? next : stage, outcome, stages,
                    transition, head.revision() + 1, head.version() + 1);
            tx.cas("UPDATE approval_orders SET current_stage = ?, outcome = ?, stages = ?, transition = ?, "
                    + "lifecycle_revision = ?, version = version + 1, updated_at = now() WHERE environment_id = ? "
                    + "AND run_id = ? AND order_uuid = ? AND version = ?", updated.currentStage(), outcome, stages,
                    transition, updated.revision(), ctx.environmentId(), ctx.runId(), head.orderUuid(), head.version());
            insertRevision(tx, ctx, updated);
            if ("declined".equals(response.state())) emitDecline(tx, source, d, updated, policy, response, atText);
            return WorkResult.ok(obj().put("settled", true).put("outcome", outcome));
        });
    }

    // ---- row writes ----

    private static void insertHead(Tx tx, RunContext ctx, Head h) throws SQLException {
        ArrayNode list = F.arrayNode();
        h.stageList().forEach(list::add);
        tx.write("INSERT INTO approval_orders (environment_id, run_id, order_uuid, employee_id, entitlement_slot_id, "
                + "renewal_id, route, source, policy_version, stage_list, current_stage, outcome, stages, transition, "
                + "lifecycle_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ctx.environmentId(),
                ctx.runId(), h.orderUuid(), h.employeeId(), h.slotId(), h.renewalId(), h.route(), h.source(),
                h.policyVersion(), list, h.currentStage(), h.outcome(), h.stages(), h.transition(), h.revision());
    }

    private static void insertRevision(Tx tx, RunContext ctx, Head h) throws SQLException {
        tx.write("INSERT INTO approval_revisions (environment_id, run_id, order_uuid, lifecycle_revision, record) "
                + "VALUES (?, ?, ?, ?, ?)", ctx.environmentId(), ctx.runId(), h.orderUuid(), h.revision(), h.record(ctx));
    }

    private static void insertDecision(Tx tx, RunContext ctx, String orderUuid, String stage, ApprovalPolicy.Policy p,
            String tickId) throws SQLException {
        boolean declines = p.decline().enabled() && p.decline().stage().equals(stage);
        String decision = declines ? "declined" : "approved";
        ObjectNode key = obj();
        key.put("orderUuid", orderUuid);
        key.put("stage", stage);
        key.put("decision", decision);
        key.put("policyVersion", p.policyVersion());
        tx.write("INSERT INTO approval_decisions (environment_id, run_id, operation_id, order_uuid, stage, "
                + "intended_decision, ticks_required, reason_code, reason, input_digest, last_tick_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ctx.environmentId(), ctx.runId(),
                ApprovalStore.decisionId(ctx.runId(), orderUuid, stage), orderUuid, stage, decision, p.ticks().get(stage),
                declines ? p.decline().reasonCode() : null, declines ? p.decline().reason() : null,
                Canonical.digest(key), tickId);
    }

    private static void emitDecline(Tx tx, OrderSourcePort.SelectionOrder source, Decision d, Head updated,
            ApprovalPolicy.Policy p, ApprovalStatusProvider.Response response, String atText) {
        boolean validated = source.entitlementSlotId() != null && !source.entitlementSlotId().isBlank()
                && source.renewalId() != null && !source.renewalId().isBlank();
        ObjectNode e = obj();
        e.put("type", p.decline().eventType());
        e.put("employeeId", source.employeeId());
        e.put("renewalId", validated ? source.renewalId() : null);
        e.put("orderUuid", source.orderUuid());
        e.put("occurredAt", atText);
        e.put("stage", d.stage());
        e.put("reasonCode", d.reasonCode() != null ? d.reasonCode() : p.decline().reasonCode());
        e.put("reason", d.reason() != null ? d.reason() : p.decline().reason());
        e.put("lifecycleRevision", updated.revision());
        e.put("transitionId", updated.transition().path("transitionId").asText());
        e.put("policyVersion", p.policyVersion());
        e.put("providerReference", response.providerReference());
        e.put("fictional", response.fictional());
        tx.emit(p.decline().eventType() + ":" + source.orderUuid() + ":" + d.stage(), p.decline().eventType(), e);
    }

    private static ObjectNode transition(String orderUuid, String stage, String state, String at) {
        ObjectNode t = obj();
        t.put("transitionId", orderUuid + ":" + stage + ":" + state);
        t.put("stage", stage);
        t.put("state", state);
        t.put("occurredAt", at);
        return t;
    }

    private static ObjectNode confirmation(ApprovalStatusProvider.Response r, String at) {
        ObjectNode o = obj();
        o.put("status", "confirmed");
        o.put("operationId", r.operationId());
        o.put("orderUuid", r.orderUuid());
        o.put("stage", r.stage());
        o.put("state", r.state());
        o.put("providerReference", r.providerReference());
        o.put("decidedAt", at);
        o.put("fictional", r.fictional());
        return o;
    }

    private static ObjectNode snapshot(Decision d) {
        return obj().put("phase", d.phase()).put("ticksElapsed", d.ticksElapsed());
    }
}
