package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import java.util.List;
import java.util.Map;

/**
 * The employee recommendation service of server/gcsp/recommendation/index.js: stored recommendations and the in-process
 * preview of an unsaved brief. Plain Java; the source adapter and route wire it up. Outcomes are the Node JSON.
 */
public final class RecommendationService {

    private final RecommendationSource source;
    private final PolicyService policy;
    private final RecommendationClock clock;

    public RecommendationService(RecommendationSource source, PolicyService policy, RecommendationClock clock) {
        this.source = source;
        this.policy = policy;
        this.clock = clock;
    }

    /** Recommendations for a saved brief request (briefVersion, preferences, essentials and optional typed feedback). */
    public ObjectNode recommend(RecommendationContext context, JsonNode request) {
        return evaluate(context, request, null);
    }

    /** Evaluates an unsaved draft: {brief, baseBriefVersion, baseDraftVersion}. Never reachable from the public route. */
    public ObjectNode previewUnsaved(RecommendationContext context, JsonNode input) {
        JsonNode in = input == null ? Js.obj() : input;
        if (!Js.only(in, List.of("brief", "baseBriefVersion", "baseDraftVersion"))) return invalidPreview(
                "Supply only the editable brief and current saved base versions.");
        JsonNode brief = in.get("brief");
        JsonNode baseBrief = in.get("baseBriefVersion");
        JsonNode baseDraft = in.get("baseDraftVersion");
        if (!Js.safeInt(baseBrief) || baseBrief.doubleValue() < 0 || !Js.safeInt(baseDraft) || baseDraft.doubleValue() < 0
                || !Js.only(brief, List.of("schemaVersion", "preferences", "essentials", "currentCarFeedback", "currentCarRating", "sameAgain"))
                || !Js.strictEq(brief.get("schemaVersion"), Js.F.numberNode(1))
                || brief.get("currentCarRating") != null && !CurrentCar.ratingValid(brief.get("currentCarRating"))
                || brief.get("sameAgain") != null && !CurrentCar.sameAgainValid(brief.get("sameAgain"))) {
            return invalidPreview("Supply current saved base versions.");
        }
        JsonNode supplied = brief.get("essentials");
        ObjectNode essentials = Js.obj();
        JsonNode charging = null;
        if (!Js.nullish(supplied)) {
            charging = supplied.isObject() ? supplied.get("charging") : null;
            for (Map.Entry<String, JsonNode> e : Js.entries(supplied)) if (!e.getKey().equals("charging")) essentials.set(e.getKey(), e.getValue());
        }
        ObjectNode content = Js.obj();
        for (Map.Entry<String, JsonNode> e : Js.entries(brief)) {
            if (!List.of("currentCarFeedback", "currentCarRating", "sameAgain").contains(e.getKey())) content.set(e.getKey(), e.getValue());
        }
        content.set("essentials", essentials);
        ObjectNode metadata = new Js.B().s("kind", "unsaved-draft").s("approved", false).s("baseBriefVersion", baseBrief)
                .s("baseDraftVersion", baseDraft).build();
        Evaluation.Preview preview = new Evaluation.Preview(charging, baseBrief, baseDraft, metadata, brief.deepCopy());
        return evaluate(context, content, preview);
    }

    private static ObjectNode invalidPreview(String reason) {
        return Outcomes.invalid("invalid-preview", Outcomes.one("preview", reason));
    }

    private ObjectNode evaluate(RecommendationContext context, JsonNode request, Evaluation.Preview preview) {
        if (source == null || policy == null || clock == null) return Outcomes.unavailable("provider-not-configured");
        if (context == null || !context.roles().contains("employee")) return Outcomes.forbidden();
        return Evaluation.run(source, policy, clock, context, request, preview);
    }
}
