package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** The lifecycle.appointments.v1 read model with Node #present's owner and next-step selection. */
final class ReadModel {

    static final String CONTRACT = "lifecycle.appointments.v1";
    static final String PENDING_REASON = "Waiting for the provider to confirm the last update.";
    private static final ObjectMapper JSON = new ObjectMapper();

    private ReadModel() {}

    record Eligibility(boolean eligible, String code, String reason) {
        static final Eligibility OPEN = new Eligibility(true, null, null);
    }

    /** offerBlocked is a {step, code, reason} note when the provider would not offer slots; row blocked wins. */
    static ObjectNode build(String runId, AppointmentStore.Row p, AppointmentConfig cfg, Eligibility eligibility,
            List<Slot> offered, JsonNode offerBlocked, AppointmentProvider provider) {
        JsonNode stuck = p.blocked() != null ? p.blocked() : offerBlocked;
        boolean unmet = "not-requested".equals(p.state()) && !eligibility.eligible();
        AppointmentConfig.Step step = p.pendingStep() != null ? cfg.ownership().pending()
                : stuck != null ? cfg.ownership().blocked() : unmet ? cfg.ownership().ineligible()
                : cfg.ownership().states().getOrDefault(p.state(), cfg.outcomes().states().get(p.state()));
        if (step == null) throw new IllegalStateException("No owner is keyed for state " + p.state());
        ObjectNode o = JSON.createObjectNode();
        o.put("contractVersion", CONTRACT).put("runId", runId).put("orderUuid", p.orderUuid())
                .put("employeeId", p.employeeId()).put("version", p.version()).put("state", p.state())
                .put("booked", "scheduled".equals(p.state()));
        slot(o, "slot", p.slot());
        slot(o, "requestedSlot", p.requestedSlot());
        slot(o, "proposedSlot", p.proposedSlot());
        if (p.proposalId() == null) o.putNull("proposalId"); else o.put("proposalId", p.proposalId());
        ArrayNode history = o.putArray("history");
        p.history().forEach(h -> history.add(h.toJson()));
        o.put("owner", step.owner()).put("nextStep", step.nextStep());
        if (p.pendingStep() == null) o.putNull("pending");
        else o.putObject("pending").put("step", p.pendingStep()).put("reason", PENDING_REASON);
        if (stuck == null) o.putNull("blocked");
        else o.putObject("blocked").put("code", stuck.path("code").asText()).put("reason", stuck.path("reason").asText());
        ArrayNode slots = o.putArray("offeredSlots");
        offered.forEach(s -> slots.add(s.toJson()));
        ObjectNode e = o.putObject("eligibility").put("eligible", eligibility.eligible());
        if (eligibility.code() == null) e.putNull("code"); else e.put("code", eligibility.code());
        if (eligibility.reason() == null) e.putNull("reason"); else e.put("reason", eligibility.reason());
        o.put("policyVersion", cfg.policyVersion());
        ArrayNode assumptions = o.putArray("assumptions");
        for (AppointmentConfig.Assumption a : cfg.assumptions()) {
            assumptions.addObject().put("key", a.key()).put("status", a.status()).put("unit", a.unit())
                    .put("basis", a.basis()).put("source", a.source()).put("sourceDate", a.sourceDate())
                    .put("policyVersion", a.policyVersion());
        }
        boolean synthetic = "synthetic".equals(provider.mode());
        o.putObject("provider").put("mode", provider.mode()).put("synthetic", synthetic);
        o.put("fictional", synthetic);
        if (p.outcome() == null) o.putNull("outcome"); else o.set("outcome", p.outcome());
        return o;
    }

    private static void slot(ObjectNode o, String name, Slot s) {
        if (s == null) o.putNull(name); else o.set(name, s.toJson());
    }
}
