package gcsp.api.appointments;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.persistence.Canonical;
import java.util.List;

/** Operation ids and types with Node parity: "appointment:" + 32 hex of digest([runId, orderUuid]) + ":" + step. */
public final class AppointmentIds {

    public static final List<String> STEPS = List.of("request", "confirm", "accept", "complete");
    private static final ObjectMapper JSON = new ObjectMapper();

    private AppointmentIds() {}

    public static boolean isStep(String step) {
        return step != null && STEPS.contains(step);
    }

    public static String operationId(String runId, String orderUuid, String step) {
        if (!isStep(step)) throw new IllegalArgumentException("Unknown appointment step: " + step);
        ArrayNode key = JSON.createArrayNode().add(runId).add(orderUuid);
        return "appointment:" + Canonical.digest(key).substring(0, 32) + ":" + step;
    }

    public static String operationType(String step) {
        if (!isStep(step)) throw new IllegalArgumentException("Unknown appointment step: " + step);
        return "lifecycle-appointment-" + step;
    }
}
