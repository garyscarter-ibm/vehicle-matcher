package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import java.util.List;

/**
 * In-process calculation for a stored subject, as createStoredSubjectRecommendationEvaluator in Node. The caller owns
 * persisted-intent authority, consent and transactional source checks; the subject is data, never a session.
 */
public final class StoredSubjectEvaluator {

    private static final List<String> KEYS = List.of("runId", "environmentId", "employeeId", "companyId", "schemeId",
            "gradeId", "policyVersion");

    private final RecommendationSource source;
    private final PolicyService policy;
    private final RecommendationClock clock;

    public StoredSubjectEvaluator(RecommendationSource source, PolicyService policy, RecommendationClock clock) {
        this.source = source;
        this.policy = policy;
        this.clock = clock;
    }

    /** The subject holds exactly the seven server-owned text keys; the stored policy version must stay the evaluated one. */
    public ObjectNode evaluate(JsonNode subject, JsonNode confirmedBrief) {
        try {
            if (!Js.only(subject, KEYS)) return invalidSubject();
            for (String key : KEYS) if (!Js.text(subject.get(key))) return invalidSubject();
            RecommendationContext bound = new RecommendationContext(subject.get("runId").textValue(),
                    subject.get("environmentId").textValue(), subject.get("employeeId").textValue(),
                    subject.get("companyId").textValue(), subject.get("schemeId").textValue(),
                    subject.get("gradeId").textValue(), subject.get("policyVersion").textValue(), List.of());
            JsonNode saved = confirmedBrief == null ? null : confirmedBrief.deepCopy();
            ObjectNode outcome = Evaluation.run(source, policy, clock, bound, saved, null);
            if (Js.eqStr(outcome.get("status"), "ok")
                    && !Js.eqStr(outcome.get("value").get("versions").get("policy"), bound.policyVersion())) {
                return Outcomes.unavailable("stored-subject-policy-mismatch");
            }
            return outcome;
        } catch (RuntimeException e) {
            return Outcomes.unavailable("employee-source-invalid");
        }
    }

    private static ObjectNode invalidSubject() {
        return Outcomes.invalid("invalid-stored-subject",
                Outcomes.one("subject", "Supply only the complete server-owned calculation subject."));
    }
}
