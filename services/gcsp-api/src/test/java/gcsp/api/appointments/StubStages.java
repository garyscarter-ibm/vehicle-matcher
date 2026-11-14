package gcsp.api.appointments;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** The injected lifecycle.stages.v1 reader: proves the consumer's mechanics only, never the stage producer. */
final class StubStages implements OrderStagePort {

    static final List<String> STAGES = List.of("selection received", "HR approval", "sales-manager approval", "sent to ordering");

    record Order(String employeeId, int approved, long revision) {}

    final Map<String, Order> orders = new ConcurrentHashMap<>();

    void order(String orderUuid, String employeeId, int approved) {
        orders.put(orderUuid, new Order(employeeId, approved, 4));
    }

    @Override
    public StageRead read(RunContext context, String orderUuid) {
        Order order = orders.get(orderUuid);
        if (order == null) return new StageRead.NotFound();
        ObjectNode v = ApptFixture.JSON.createObjectNode();
        v.put("contractVersion", "lifecycle.stages.v1").put("runId", context.runId()).put("orderUuid", orderUuid)
                .put("employeeId", order.employeeId()).put("policyVersion", "gcsp-policy-v1")
                .put("lifecycleRevision", order.revision()).put("entitlementSlotId", "slot-paula")
                .put("renewalId", "renewal:" + order.employeeId()).put("renewalAuthority", "validated");
        ArrayNode stages = v.putArray("stages");
        for (int i = 0; i < STAGES.size(); i++) {
            ObjectNode s = stages.addObject().put("stage", STAGES.get(i));
            s.put("state", i < order.approved() ? "approved" : i == order.approved() ? "pending" : "not-started");
            if (i < order.approved()) s.put("at", "2026-11-05T09:00:00.000Z"); else s.putNull("at");
            if (i <= order.approved()) s.put("providerReference", "SYN-STAGE-" + i); else s.putNull("providerReference");
        }
        return new StageRead.Ok(v);
    }
}
