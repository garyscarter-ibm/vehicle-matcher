package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Evaluates saved briefs against visible released cars (the recommendation gates); one batched call per read. */
public interface UnmetEvaluationPort {

    Evaluation evaluate(DemandScope scope, List<BriefCandidate> candidates, Instant asOf, long clockVersion);

    record BriefCandidate(String employeeId, long briefVersion, JsonNode content, String companyId, String schemeId,
            List<CarCandidate> cars) {}

    /** availabilityState is "available" or "unavailable" (held, allocated, ended or not offered). */
    record CarCandidate(String orderUuid, String availabilityState) {}

    sealed interface Evaluation {
        Evaluation UNAVAILABLE = new Unavailable();

        /** Decisions by employeeId, one per candidate car. */
        record Ok(Map<String, List<CarDecision>> byEmployee) implements Evaluation {}

        record Unavailable() implements Evaluation {}
    }

    /** score is the recommendation score of an evaluated car, null when absent or not finite. */
    record CarDecision(String orderUuid, String gateStatus, List<Gate> blockers, List<Gate> unknowns, Double score) {

        public CarDecision(String orderUuid, String gateStatus, List<Gate> blockers, List<Gate> unknowns) {
            this(orderUuid, gateStatus, blockers, unknowns, null);
        }
    }

    record Gate(String code, String field) {}
}
