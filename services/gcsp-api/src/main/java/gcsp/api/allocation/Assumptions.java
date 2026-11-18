package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.List;

/** The allocation and hold assumptions read from the canonical policy at one version; recorded whole in the plan. */
record Assumptions(String tieBreakRule, String seed, long durationSeconds, long maxActive, ArrayNode recorded,
        JsonNode declineReentry) {

    static final String RULE_RENEWAL_FIRST = "renewalDueThenFitThenSeededLottery";
    static final String RULE_FIT_FIRST = "fitThenRenewalDueThenSeededLottery";
    private static final String EXPIRY_RULE = "lapsedHoldersSitOutAndNobodyGetsBackACarTheyLetLapse";
    private static final String DECLINE_RULE = "declinersSitOutAndTheDeclinedCarStaysExcluded";

    /** Either the assumptions or the typed refusal. */
    sealed interface Read permits Ok, Failed {}

    record Ok(Assumptions assumptions) implements Read {}

    record Failed(String code, String message) implements Read {}

    static Read read(PolicyService policy, AllocationScope scope, Trigger trigger) {
        List<String> keys = new ArrayList<>(List.of("allocation.tieBreak.rule", "allocation.tieBreak.seed",
                "offer.declinedCar.exclusion", "hold.buddy.durationSeconds", "hold.employee.maxActive",
                "hold.deadline.inclusive", "hold.pending.blocksReallocation", "hold.replacement.releaseFirst"));
        if ("buddy-expired".equals(trigger.type())) keys.add("offer.expiredHold.reallocation");
        if ("offer-declined".equals(trigger.type())) keys.add("offer.declinedHold.reallocation");
        PolicyRead read = new PolicyRead(scope.runId(), PolicyClock.iso(scope.now()), scope.policyVersion());
        ArrayNode recorded = Sql.JSON.createArrayNode();
        List<JsonNode> values = new ArrayList<>();
        try {
            for (String key : keys) {
                PolicyResult r = policy.getAssumption(key, read);
                if (!r.ok() || !scope.policyVersion().equals(r.policyVersion()) || r.value() == null) {
                    return new Failed("policy-unavailable", "Policy assumption " + key + " is unavailable.");
                }
                values.add(r.value().path("value"));
                recorded.add(r.value());
            }
        } catch (RuntimeException e) {
            return new Failed("policy-unavailable", "Policy could not be read.");
        }
        String rule = values.get(0).isTextual() ? values.get(0).textValue() : null;
        String seed = values.get(1).isTextual() ? values.get(1).textValue() : null;
        boolean valid = (RULE_RENEWAL_FIRST.equals(rule) || RULE_FIT_FIRST.equals(rule)) && seed != null && !seed.isEmpty()
                && "untilRelevantConfirmedBriefChange".equals(text(values.get(2)))
                && positive(values.get(3)) && positive(values.get(4))
                && values.subList(5, 8).stream().allMatch(v -> v.isBoolean() && v.booleanValue());
        if (valid && "buddy-expired".equals(trigger.type())) valid = EXPIRY_RULE.equals(text(values.get(8)));
        if (valid && "offer-declined".equals(trigger.type())) valid = DECLINE_RULE.equals(text(values.get(8)));
        if (!valid) return new Failed("policy-invalid", "The allocation policy assumptions are not usable.");
        JsonNode reentry = null;
        try {
            PolicyResult next = policy.getAssumption(DeclineReentry.KEY, read);
            if (next.ok() && scope.policyVersion().equals(next.policyVersion()) && next.value() != null) {
                reentry = next.value().path("value");
                if (!DeclineReentry.KEY.equals(next.value().path("key").asText()) || !DeclineReentry.valid(reentry)) {
                    return new Failed("policy-invalid", "The declined-car re-entry rule is invalid.");
                }
                recorded.add(next.value());
            } else if (!"invalid".equals(next.status()) || !"unknown-assumption".equals(next.code())
                    || !scope.policyVersion().equals(next.policyVersion())) {
                return new Failed("policy-unavailable", "The declined-car re-entry rule is unavailable.");
            }
        } catch (RuntimeException e) {
            return new Failed("policy-unavailable", "The declined-car re-entry rule could not be read.");
        }
        return new Ok(new Assumptions(rule, seed, values.get(3).longValue(), values.get(4).longValue(), recorded, reentry));
    }

    private static String text(JsonNode n) {
        return n.isTextual() ? n.textValue() : null;
    }

    private static boolean positive(JsonNode n) {
        return n.isIntegralNumber() && n.canConvertToLong() && n.longValue() > 0;
    }
}
