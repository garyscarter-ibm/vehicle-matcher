package gcsp.api.brief;

import static gcsp.api.brief.Json.flag;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;

/** Buddy engagement rules: the Account minimum gate, Same again, and the engaged-or-not view. */
final class Engagement {

    /** The minimum evaluated on one piece of content; remaining is what the employee still has to choose. */
    record Gate(boolean ok, int remaining, int considered, int minimumCategories) {}

    private Engagement() {}

    /** Search and hold share one Buddy switch, so a partial grant is not engaged. */
    static boolean engaged(JsonNode buddy) {
        return buddy != null && flag(buddy, "searchConsent") && flag(buddy, "holdConsent") && buddy.path("paused").isBoolean()
                && !buddy.get("paused").booleanValue();
    }

    /** One entry above the slider minimum that the employee chose or confirmed; policy defaults never count. */
    static boolean isConsidered(JsonNode p, PolicyRules rules) {
        if (p == null || !p.isObject() || !p.path("importance").isNumber() || p.get("importance").intValue() <= rules.minimum) return false;
        return "employee".equals(p.path("source").asText(null)) || "confirmed".equals(p.path("valueState").asText(null));
    }

    /** Categories that are considered, counted over the policy's registered Account order. */
    static int considered(JsonNode content, PolicyRules rules) {
        int count = 0;
        for (String key : rules.account.order()) if (isConsidered(content.path("preferences").get(key), rules)) count++;
        return count;
    }

    /** Same again counts only for the employee's current car, so it needs a known contract with a model. */
    static boolean sameAgainOn(JsonNode content, Optional<BriefAccountPort.AccountFacts> facts) {
        BriefAccountPort.CurrentContract car = facts.map(BriefAccountPort.AccountFacts::currentContract).orElse(null);
        return car != null && car.contractId() != null && !car.contractId().isBlank() && car.model() != null
                && !car.model().isBlank() && BriefContent.sameAgainOn(content, car.contractId());
    }

    static Gate gate(JsonNode content, PolicyRules rules, Optional<BriefAccountPort.AccountFacts> facts) {
        int considered = considered(content, rules);
        int min = rules.account.minimumCategories();
        int need = sameAgainOn(content, facts) ? 0 : Math.max(0, min - considered);
        return new Gate(need == 0, need, considered, min);
    }

    static BriefResult.Refusal refusal(Gate g) {
        ObjectNode extra = Json.obj();
        extra.put("remaining", g.remaining()).put("considered", g.considered()).put("minimumCategories", g.minimumCategories());
        extra.putArray("reasons").addObject().put("field", "categories").put("reason", "Choose " + g.remaining() + " more "
                + (g.remaining() == 1 ? "category" : "categories") + " or turn on Same again to engage Buddy.");
        return BriefResult.Refusal.invalid("engagement-minimum", "The Account minimum is not met.", extra);
    }

    /** The engagement state as the Account shows it: permissions from the current brief, the count from shown. */
    static ObjectNode view(JsonNode shown, JsonNode currentBuddy, PolicyRules rules, Optional<BriefAccountPort.AccountFacts> facts) {
        Gate g = gate(shown, rules, facts);
        boolean engaged = engaged(currentBuddy);
        boolean held = flag(currentBuddy, "searchConsent");
        ObjectNode v = Json.obj();
        v.put("state", engaged ? "engaged" : "disengaged");
        if (engaged) {
            v.putNull("reason");
        } else if (held && flag(currentBuddy, "paused")) {
            v.put("reason", "paused");
        } else if (currentBuddy != null && "minimum-lost".equals(currentBuddy.path("disengagedReason").asText(null))) {
            v.put("reason", "minimum-lost");
        } else {
            v.putNull("reason");
        }
        if (currentBuddy != null && currentBuddy.path("permissionVersion").isIntegralNumber()) {
            v.put("permissionVersion", currentBuddy.get("permissionVersion").longValue());
        } else {
            v.putNull("permissionVersion");
        }
        v.put("minimumCategories", g.minimumCategories()).put("considered", g.considered()).put("remaining", g.remaining());
        v.put("sameAgain", sameAgainOn(shown, facts)).put("canEngage", !engaged && g.remaining() == 0);
        return v;
    }
}
