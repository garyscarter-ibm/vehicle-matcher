package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalStore.Decision;
import gcsp.api.approvals.ApprovalStore.Head;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** The order progress projection (Node #project, field for field): contract lifecycle.stages.v1, schema 1. */
final class ApprovalView {

    static final String CONTRACT = "lifecycle.stages.v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private ApprovalView() {}

    static ObjectNode project(RunContext ctx, Head stored, ApprovalPolicy.Policy policy, String renewalId,
            Decision open, Instant asOf, HandoverPort.Handover handover, ApprovalStatusProvider status) {
        Head head = stored;
        ApprovalPolicy.Step step;
        if (handover != null && !stored.stageList().contains(handover.stage())) {
            head = handedOver(stored, handover);
            step = new ApprovalPolicy.Step(handover.owner(), handover.nextStep());
        } else if ("in-progress".equals(head.outcome())) {
            step = policy.stageOwners().get(head.currentStage());
        } else {
            step = policy.outcomeOwners().get(head.outcome());
        }
        boolean validated = head.slotId() != null && !head.slotId().isBlank() && renewalId != null && !renewalId.isBlank();
        ObjectNode o = F.objectNode();
        o.put("contractVersion", CONTRACT);
        o.put("schemaVersion", 1);
        o.put("runId", ctx.runId());
        o.put("orderUuid", head.orderUuid());
        o.put("employeeId", head.employeeId());
        o.put("entitlementSlotId", head.slotId());
        o.put("renewalId", validated ? renewalId : null);
        o.put("renewalAuthority", validated ? "validated" : "missing");
        o.put("route", head.route());
        ObjectNode source = F.objectNode();
        source.putNull("orderReference");
        for (Iterator<Map.Entry<String, JsonNode>> it = head.source().fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> e = it.next();
            source.set(e.getKey(), e.getValue());
        }
        o.set("source", source);
        o.put("policyVersion", policy.policyVersion());
        ObjectNode pol = o.putObject("policy");
        pol.put("policyVersion", policy.policyVersion());
        ArrayNode provenance = pol.putArray("provenance");
        policy.provenance().forEach(provenance::add);
        o.put("lifecycleRevision", head.revision());
        o.put("asOf", Time.format(asOf));
        ArrayNode list = o.putArray("stageList");
        head.stageList().forEach(list::add);
        o.put("currentStage", head.currentStage());
        o.set("stages", head.stages());
        o.put("owner", step == null ? null : step.owner());
        o.put("nextStep", step == null ? null : step.nextStep());
        o.put("outcome", head.outcome());
        o.set("blocked", blocked(head, open));
        ObjectNode provider = o.putObject("provider");
        provider.put("mode", status == null ? null : status.mode());
        provider.put("provider", status == null ? null : status.provider());
        provider.put("synthetic", status != null && "synthetic".equals(status.mode()));
        return o;
    }

    /** Only a sent order gets the extra final stage; the stored rows are untouched. */
    private static Head handedOver(Head h, HandoverPort.Handover handover) {
        List<String> list = new ArrayList<>(h.stageList());
        list.add(handover.stage());
        ArrayNode stages = h.stages().deepCopy();
        stages.add(ApprovalStore.stageRow(handover.stage(), "approved", Time.format(handover.at()),
                handover.providerReference(), null));
        return new Head(h.orderUuid(), h.employeeId(), h.slotId(), h.renewalId(), h.route(), h.source(),
                h.policyVersion(), list, handover.stage(), "handed-over", stages, h.transition(), h.revision(), h.version());
    }

    private static JsonNode blocked(Head head, Decision open) {
        if (open == null || !"in-progress".equals(head.outcome()) || !open.stage().equals(head.currentStage())) {
            return F.nullNode();
        }
        ObjectNode b = F.objectNode();
        if ("unsupported".equals(open.phase())) {
            b.put("code", open.outcome().path("code").asText("unsupported"));
            b.put("reason", open.outcome().path("reason").asText("This approval update is not supported."));
            return b;
        }
        if ("uncertain".equals(open.phase()) || "requested".equals(open.phase())) {
            b.put("code", "provider-uncertain");
            b.put("reason", "Waiting for the approval system to confirm the last update.");
            return b;
        }
        return F.nullNode();
    }
}
