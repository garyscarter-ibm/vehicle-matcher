package gcsp.api.cases;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Whether available cars suit an employee, for the alternative-car remedy. Reads only; no recommendation logic here. */
public interface CaseCarSuitabilityPort {

    /** connected=false means suitability cannot be checked at all; items and needsConfirmation are option rows. */
    record Options(boolean connected, List<ObjectNode> items, List<ObjectNode> needsConfirmation) {}

    enum Verdict { SUITABLE, UNSUITABLE, UNAVAILABLE }

    /** remedy is the checked remedy to store when SUITABLE. */
    record Check(Verdict verdict, ObjectNode remedy) {}

    Options options(String environmentId, String runId, String employeeId);

    Check check(String environmentId, String runId, String employeeId, String orderUuid);
}
