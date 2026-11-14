package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;

/** The current-car relationship for one order as presented (lifecycle.current-car.v1). */
public record CurrentCarView(String runId, String orderUuid, String employeeId, Old oldCar, New newCar,
        List<Change> changes) {

    public static final String CONTRACT = "lifecycle.current-car.v1";

    /** The car being replaced; absent (null on the view) for a new order. */
    public record Old(String contractId, String slotId, String status, Instant returnedAt, String providerReference,
            JsonNode location) {}

    public record New(String orderUuid, String configurationId, String status, Instant collectedAt, String vin,
            String providerReference) {}

    /** One confirmed event, as the person sees it: type, time, provider reference and the appointment it came from. */
    public record Change(String type, Instant at, String providerReference, JsonNode appointment) {}

    public CurrentCarView {
        changes = List.copyOf(changes);
    }

    public boolean newCarCollected() {
        return "collected".equals(newCar.status());
    }

    public boolean oldCarReturned() {
        return oldCar != null && "returned".equals(oldCar.status());
    }

    /** The car she drives: the new one once collected, else the old one until it is returned; otherwise none. */
    public ObjectNode currentCar() {
        if (newCarCollected()) {
            return ReturnJson.JSON.createObjectNode().put("kind", "order").put("orderUuid", newCar.orderUuid())
                    .put("vin", newCar.vin());
        }
        if (oldCar != null && "held".equals(oldCar.status())) {
            return ReturnJson.JSON.createObjectNode().put("kind", "contract").put("contractId", oldCar.contractId())
                    .put("slotId", oldCar.slotId());
        }
        return null;
    }

    public ObjectNode toJson() {
        ObjectNode o = ReturnJson.JSON.createObjectNode();
        o.put("contractVersion", CONTRACT).put("runId", runId).put("orderUuid", orderUuid).put("employeeId", employeeId);
        ObjectNode current = currentCar();
        o.set("currentCar", current == null ? ReturnJson.JSON.nullNode() : current);
        if (oldCar == null) {
            o.putNull("oldCar");
        } else {
            ObjectNode old = o.putObject("oldCar");
            old.put("contractId", oldCar.contractId()).put("slotId", oldCar.slotId()).put("status", oldCar.status())
                    .put("returnedAt", ReturnJson.format(oldCar.returnedAt()))
                    .put("providerReference", oldCar.providerReference());
            old.set("location", oldCar.location() == null ? ReturnJson.JSON.nullNode() : oldCar.location());
        }
        ObjectNode n = o.putObject("newCar");
        n.put("orderUuid", newCar.orderUuid()).put("configurationId", newCar.configurationId())
                .put("status", newCar.status()).put("collectedAt", ReturnJson.format(newCar.collectedAt()))
                .put("vin", newCar.vin()).put("providerReference", newCar.providerReference());
        ArrayNode list = o.putArray("changes");
        for (Change c : changes) {
            list.addObject().put("type", c.type()).put("at", ReturnJson.format(c.at()))
                    .put("providerReference", c.providerReference()).set("appointment", c.appointment());
        }
        o.put("fictional", true);
        return o;
    }
}
