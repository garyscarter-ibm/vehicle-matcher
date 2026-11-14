package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

/** The port to the recommendation engine: gate and score each visible car for one employee, with its quote. */
public interface EligibleCandidates {

    Result evaluate(Request request);

    record Request(String environmentId, String runId, String policyVersion, Instant asOf, long clockVersion,
            Subject subject, List<Car> cars) {}

    /** accountRecord is a JSON null when the employee has no account record. */
    record Subject(String employeeId, String slotId, long employeeVersion, JsonNode employeeAttributes,
            JsonNode accountRecord, long briefVersion, JsonNode briefContent) {}

    record Car(String orderUuid, String configurationId, long version, JsonNode attributes) {}

    sealed interface Result permits Evaluated, Unavailable {}

    record Evaluated(JsonNode versions, List<Decision> decisions) implements Result {}

    record Unavailable(String code) implements Result {}

    /** quote carries snapshot, terms, employeeFacts, reasons, tradeOffs and versions. */
    record Decision(String orderUuid, String gateStatus, Double score, JsonNode reasons, JsonNode blockers,
            JsonNode unknowns, JsonNode versions, JsonNode quote) {}
}
