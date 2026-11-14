package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The validated, sorted planning input in typed form, plus the sorted JSON that the plan digest covers. */
final class Plan {

    record Derivative(String id, String modelId, long cost, long lead) {
    }

    record Bound(String id, long min, long max) {
    }

    /** deadlineMs is requiredBy when present, else renewal; renewalDeadline is Node's deadline === renewalAt. */
    record Entitlement(String id, String renewalAt, String requiredBy, long deadlineMs, boolean renewalDeadline,
            Set<String> acceptable, boolean hasAcceptable, Set<String> excluded, List<String> gates) {
    }

    record Stock(String stockId, String derivativeId, String availableAt, long ms, String held, Set<String> permitted) {
    }

    record Inbound(String supplyId, String derivativeId, long quantity, String expectedAt, long ms) {
    }

    ObjectNode json;
    String runId;
    String asOf;
    long asOfMs;
    long horizonMs;
    JsonNode versions;
    List<String> limitations;
    List<Derivative> catalog;
    List<Entitlement> entitlements;
    List<Stock> stock;
    List<Inbound> inbound;
    String currency;
    long budget;
    long coverageWeight;
    long unallocatedWeight;
    long costWeight;
    JsonNode weights;
    List<Bound> derivativeBounds;
    List<Bound> modelBounds;
    Map<String, Bound> boundByDerivative;
    JsonNode currentDraft;
    boolean hasCurrentDraft;
}
