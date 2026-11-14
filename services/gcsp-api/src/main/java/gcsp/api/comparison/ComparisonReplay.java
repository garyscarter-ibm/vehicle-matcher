package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyService;

/** Replays one route of one arm for one seed and returns its outcome record; a later story supplies the real one. */
public interface ComparisonReplay {

    /** One step; pointsMultiplier is the arm's allowance multiplier (1 when not scaled). */
    record Request(ComparisonExperiments.Arm arm, String route, JsonNode seed, ComparisonInputs inputs,
            ComparisonPolicy snapshot, PolicyService policy, double pointsMultiplier, String codeRevision) {}

    /** The route's outcome record, or a thrown typed refusal. */
    JsonNode replay(Request request);
}
