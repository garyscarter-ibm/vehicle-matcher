package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The typed current-car feedback state of one evaluation and judgeFeedback from server/gcsp/recommendation/index.js. */
final class Feedback {

    /** The resolved feedback context; baseline is null when the provider supplied no usable one. */
    record Fb(JsonNode policy, String policyVersion, JsonNode baseline, JsonNode rating, boolean usableRating,
            boolean usableSameAgain, String inertCode, boolean sameOn, String identity) {}

    /** record is the stored feedback evidence; omit is a blocker that removes the car, reasons the kept evidence. */
    record Judged(ObjectNode record, ArrayNode reasons, ObjectNode omit) {}

    private Feedback() {}

    private static ObjectNode copy(ObjectNode base, String key, JsonNode value) {
        ObjectNode out = base.deepCopy();
        out.set(key, value);
        return out;
    }

    private static ObjectNode copy(ObjectNode base, String key, String value) {
        return copy(base, key, Js.F.textNode(value));
    }

    private static ArrayNode one(String code, JsonNode keys) {
        ArrayNode list = Js.arr();
        list.add(new Js.B().s("code", code).s("keys", keys).build());
        return list;
    }

    private static ObjectNode blocker(String code, JsonNode keys) {
        return new Js.B().s("code", code).s("keys", keys).build();
    }

    static Judged judge(Fb fb, boolean gated, JsonNode snapshot, JsonNode configurationId, JsonNode scored, JsonNode brief,
            JsonNode employeeFacts, RecommendationConfig config, Slider slider) {
        JsonNode rules = fb.policy();
        JsonNode facts = Js.get(snapshot, "facts");
        JsonNode ratingValue = Js.orNull(Js.opt(fb.rating(), "value"));
        String ratingClass = fb.usableRating() ? CurrentCar.ratingClass(ratingValue, Js.get(rules, "rating")) : "neutral";
        JsonNode baseline = fb.baseline();
        ObjectNode base = new Js.B().s("policyKey", CurrentCar.FEEDBACK_KEY).s("policyVersion", fb.policyVersion()).s("applied", true)
                .s("rating", new Js.B().s("value", ratingValue).s("class", ratingClass).build())
                .s("sameAgain", fb.sameOn())
                .s("baseline", baseline == null ? Js.F.nullNode()
                        : new Js.B().s("contractId", Js.get(baseline, "contractId"))
                                .s("sourceVersion", Js.at(baseline, "source", "sourceVersion")).build())
                .s("similarity", Js.F.nullNode()).s("improvement", Js.F.nullNode()).s("continuity", Js.F.nullNode())
                .s("effect", "none").s("reasonCode", fb.inertCode()).build();
        if (gated) return new Judged(copy(base, "reasonCode", "gate-not-passed"), Js.arr(), null);
        if (baseline == null || !(fb.sameOn() || fb.usableRating())) return new Judged(base, Js.arr(), null);
        JsonNode dims = Js.at(rules, "similarity", "dimensions");
        JsonNode baselineFacts = Js.get(baseline, "facts");
        if (fb.sameOn()) {
            JsonNode sameDims = Js.at(rules, "sameAgain", "dimensions");
            String continuity = CurrentCar.matchDimensions(baselineFacts, facts, sameDims, config, "same", configurationId);
            ObjectNode record = copy(copy(base, "continuity", continuity), "similarity",
                    CurrentCar.matchDimensions(baselineFacts, facts, dims, config, "similar", null));
            if (continuity.equals("same")) {
                return new Judged(copy(copy(record, "effect", "kept"), "reasonCode", "same-again-match"),
                        one("same-again-match", sameDims), null);
            }
            return new Judged(copy(copy(record, "effect", "omitted"), "reasonCode", "same-again-different"), Js.arr(),
                    blocker("same-again-different", sameDims));
        }
        String similarity = CurrentCar.matchDimensions(baselineFacts, facts, dims, config, "similar", null);
        ObjectNode record = copy(base, "similarity", similarity);
        if (ratingClass.equals("negative")) {
            if (similarity.equals("similar")) {
                return new Judged(copy(copy(record, "effect", "omitted"), "reasonCode", "feedback-similar-omitted"), Js.arr(),
                        blocker("feedback-similar-omitted", dims));
            }
            String code = similarity.equals("unknown") ? "feedback-similarity-unknown" : "feedback-different";
            return new Judged(copy(copy(record, "effect", "kept"), "reasonCode", code),
                    similarity.equals("different") ? one("feedback-different", dims) : Js.arr(), null);
        }
        if (!ratingClass.equals("positive")) return new Judged(record, Js.arr(), null);
        if (similarity.equals("similar")) {
            return new Judged(copy(copy(record, "effect", "kept"), "reasonCode", "feedback-similar"), one("feedback-similar", dims), null);
        }
        ObjectNode better = CurrentCar.compareImprovement(snapshot, scored, baseline, brief, employeeFacts, config, slider,
                Js.get(rules, "improvement"));
        String result = better.get("result").textValue();
        if (result.equals("proven")) {
            return new Judged(copy(copy(copy(record, "improvement", "proven"), "effect", "kept"), "reasonCode", "feedback-improvement"),
                    one("feedback-improvement", better.get("keys")), null);
        }
        return new Judged(copy(copy(copy(record, "improvement", result), "effect", "omitted"), "reasonCode",
                "feedback-not-similar-or-better"), Js.arr(), blocker("feedback-not-similar-or-better", dims));
    }
}
