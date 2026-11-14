package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.LinkedHashMap;
import java.util.Map;

/** The lifecycle.return-plan.v1 projection (ports #plan of return-plan/index.js); pure, no I/O. */
final class PlanView {

    static final String CONTRACT = "lifecycle.return-plan.v1";
    static final String APPOINTMENT_CONTRACT = "lifecycle.appointments.v1";
    static final String WAITING = "Waiting for the provider to confirm the last update.";
    private static final Map<String, String> PLAN_STATE = Map.of("not-requested", "not-planned", "requested",
            "return-requested", "change-proposed", "return-requested", "scheduled", "return-scheduled");
    /** Outcome states s3 will record, shown over the appointment state once present. */
    private static final Map<String, String> OUTCOME_STATE = Map.of("returned", "returned", "missed", "return-missed");

    /** The new car's handover as the plan shows it. */
    record Handover(String state, AppointmentSlot slot, String providerReference) {
        boolean booked() {
            return "scheduled".equals(state);
        }
    }

    private PlanView() {}

    static String planState(String appointmentState, String outcomeState) {
        String done = outcomeState == null ? null : OUTCOME_STATE.get(outcomeState);
        return done != null ? done : PLAN_STATE.get(appointmentState);
    }

    static JsonNode slot(AppointmentSlot s) {
        return s == null ? NullNode.instance : s.toJson();
    }

    private static ObjectNode obj() {
        return ReturnJson.JSON.createObjectNode();
    }

    /** A new order has no current car to return: the all-null shape. */
    static ObjectNode notApplicable(String runId, ReturnSource s, JsonNode relationship, String policyVersion) {
        ObjectNode o = obj();
        o.put("contractVersion", CONTRACT).put("runId", runId).put("orderUuid", s.orderUuid())
                .put("employeeId", s.employeeId()).put("applicable", false).putNull("state");
        o.put("scheduled", false);
        for (String f : new String[] {"oldContractId", "vehicleSlotId", "currentCar", "returnMileage", "choice", "location",
            "appointment", "handover", "slot", "requestedSlot", "proposedSlot", "proposalId", "providerReference"}) {
            o.putNull(f);
        }
        o.putArray("history");
        for (String f : new String[] {"owner", "nextStep", "pending", "blocked"}) o.putNull(f);
        o.putArray("choices");
        o.putObject("offeredSlots");
        o.putNull("outcome");
        o.set("relationship", relationship);
        o.put("version", 0).put("policyVersion", policyVersion);
        o.putArray("assumptions");
        o.put("fictional", true);
        return o;
    }

    static ObjectNode build(String runId, ReturnSource s, PlanRow row, ReturnPolicy policy, Handover handover,
            Map<String, ChoiceOffer> offers, String providerMode, JsonNode relationship) {
        String apState = row == null ? "not-requested" : row.state;
        String state = planState(apState, null);
        boolean planning = "not-planned".equals(state);
        boolean pending = row != null && row.pendingOperationId != null;
        boolean blocked = row != null && row.blockedCode != null;
        boolean idle = planning && offers.values().stream().noneMatch(ChoiceOffer::available);
        ReturnPolicy.OwnerStep step = pending ? policy.ownership().pending() : blocked ? policy.ownership().blocked()
                : idle ? policy.ownership().ineligible() : policy.ownership().states().get(apState);

        ObjectNode pendingJson = null;
        if (pending) pendingJson = obj().put("step", row.pendingStep).put("reason", WAITING);
        ObjectNode blockedJson = null;
        if (blocked) blockedJson = obj().put("code", row.blockedCode).put("reason", row.blockedReason);
        boolean synthetic = "synthetic".equals(providerMode);
        String lastReference = row == null || row.history.isEmpty() ? null
                : row.history.get(row.history.size() - 1).path("providerReference").asText(null);

        ObjectNode o = obj();
        o.put("contractVersion", CONTRACT).put("runId", runId).put("orderUuid", s.orderUuid())
                .put("employeeId", s.employeeId()).put("applicable", true).put("state", state)
                .put("scheduled", "return-scheduled".equals(state));
        o.put("oldContractId", s.oldContractId()).put("vehicleSlotId", s.entitlementSlotId());
        o.set("currentCar", obj().put("contractId", s.oldContractId())
                .put("slotId", s.oldSlotId() != null ? s.oldSlotId() : s.entitlementSlotId()).putNull("status")
                .putNull("model").putNull("vehicle").put("source", "selection"));
        o.set("returnMileage", obj().put("value", s.mileage()).put("unit", s.mileageUnit() != null ? s.mileageUnit() : "mi")
                .put("recordedAt", ReturnJson.format(s.receivedAt())).put("source", "selection"));
        o.put("choice", row == null ? null : row.choice);
        o.set("location", row == null ? location(s, null) : row.location);
        o.set("appointment", appointment(runId, s, row, apState, pendingJson, blockedJson, providerMode, synthetic, policy));
        ObjectNode hv = obj().put("state", handover.state()).put("booked", handover.booked());
        hv.set("slot", slot(handover.slot()));
        hv.put("providerReference", handover.providerReference());
        o.set("handover", hv);
        o.set("slot", slot(row == null ? null : row.slot));
        o.set("requestedSlot", slot(row == null ? null : row.requestedSlot));
        o.set("proposedSlot", slot(row == null ? null : row.proposedSlot));
        o.put("proposalId", row == null ? null : row.proposalId);
        o.put("providerReference", lastReference);
        ArrayNode history = o.putArray("history");
        if (row != null) {
            for (JsonNode h : row.history) {
                String hs = h.path("state").asText();
                history.addObject().put("state", planState(hs, null)).put("appointmentState", hs)
                        .put("at", h.path("at").asText(null)).put("providerReference", h.path("providerReference").asText(null));
            }
        }
        o.put("owner", step.owner()).put("nextStep", step.nextStep());
        o.set("pending", pendingJson == null ? NullNode.instance : pendingJson);
        o.set("blocked", blockedJson == null ? NullNode.instance : blockedJson);
        ArrayNode choices = o.putArray("choices");
        ObjectNode offered = o.putObject("offeredSlots");
        for (ReturnPolicy.Choice c : policy.choices()) {
            ChoiceOffer offer = offers.get(c.id());
            choices.addObject().put("id", c.id()).put("label", c.label()).put("available", offer.available())
                    .put("reason", offer.reason()).put("selected", row != null && c.id().equals(row.choice));
            ArrayNode slots = offered.putArray(c.id());
            offer.slots().forEach(sl -> slots.add(sl.toJson()));
        }
        o.putNull("outcome");
        o.set("relationship", relationship);
        o.put("version", row == null ? 0 : row.version).put("policyVersion", policy.policyVersion());
        ArrayNode assumptions = o.putArray("assumptions");
        for (ReturnPolicy.Assumption a : policy.assumptions()) {
            assumptions.addObject().put("key", a.key()).put("status", a.status()).put("unit", a.unit())
                    .put("basis", a.basis()).put("source", a.source()).put("sourceDate", a.sourceDate())
                    .put("policyVersion", a.policyVersion());
        }
        o.set("source", obj().put("reference", s.sourceReference()).put("receivedAt", ReturnJson.format(s.receivedAt())));
        o.set("provider", obj().put("mode", providerMode).put("synthetic", synthetic));
        o.put("fictional", true);
        return o;
    }

    /** The planned collection place; the label stays null until a location source exists, never invented. */
    static ObjectNode location(ReturnSource s, ReturnPolicy.Rule rule) {
        if (s.buddy()) return obj().putNull("locationId").put("kind", "home-address").putNull("label").put("rule", "home-address");
        return obj().put("locationId", s.locationId()).put("kind", "collection-location").putNull("label")
                .put("rule", rule == null ? null : rule.location());
    }

    /** The nested return appointment (lifecycle.appointments.v1); its owner follows pending, blocked, then its state. */
    private static ObjectNode appointment(String runId, ReturnSource s, PlanRow row, String apState, JsonNode pending,
            JsonNode blocked, String providerMode, boolean synthetic, ReturnPolicy policy) {
        ReturnPolicy.OwnerStep own = pending != null ? policy.ownership().pending() : blocked != null
                ? policy.ownership().blocked() : policy.ownership().states().get(apState);
        ObjectNode a = obj();
        a.put("contractVersion", APPOINTMENT_CONTRACT).put("purpose", "return").put("runId", runId)
                .put("orderUuid", s.orderUuid()).put("employeeId", s.employeeId()).put("state", apState)
                .put("booked", "scheduled".equals(apState));
        a.set("slot", slot(row == null ? null : row.slot));
        a.set("requestedSlot", slot(row == null ? null : row.requestedSlot));
        a.set("proposedSlot", slot(row == null ? null : row.proposedSlot));
        a.put("proposalId", row == null ? null : row.proposalId);
        a.set("history", row == null ? ReturnJson.JSON.createArrayNode() : row.history);
        a.put("owner", own.owner()).put("nextStep", own.nextStep());
        a.set("pending", pending == null ? NullNode.instance : pending);
        a.set("blocked", blocked == null ? NullNode.instance : blocked);
        a.set("eligibility", obj().put("eligible", true).putNull("code").putNull("reason"));
        a.set("plan", row == null ? NullNode.instance : obj().put("choice", row.choice));
        a.set("provider", obj().put("mode", providerMode).put("synthetic", synthetic));
        a.put("fictional", true);
        return a;
    }

    static Map<String, ChoiceOffer> closedOffers(ReturnPolicy policy, String reason) {
        Map<String, ChoiceOffer> m = new LinkedHashMap<>();
        for (ReturnPolicy.Choice c : policy.choices()) m.put(c.id(), ChoiceOffer.closed(reason, null));
        return m;
    }
}
