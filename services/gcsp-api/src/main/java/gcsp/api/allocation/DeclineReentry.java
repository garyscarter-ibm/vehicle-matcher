package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import com.fasterxml.jackson.databind.node.NullNode;

/** Applies an adopted reason rule to canonical candidate evidence; it never changes the underlying preference scorer. */
final class DeclineReentry {

    static final String KEY = "offer.declinedCar.reentry.v1";
    private static final Map<String, String> SUPPORTED = Map.of(
            "body-style", "preferences.body.value|body|known-value",
            "fuel", "preferences.fuel.value|fuel|known-value",
            "size", "preferences.size.value|size|closer-fit",
            "equipment", "essentials.equipment|equipment|essential-met");

    record Decline(String orderUuid, String decisionId, String offerId, long briefVersion, JsonNode reason,
            JsonNode quote, JsonNode previousBrief, JsonNode savedChange, String confirmedBy, Instant confirmedAt) {}

    private DeclineReentry() {}

    static boolean valid(JsonNode rule) {
        if (rule == null || !rule.isObject() || rule.size() != 3 || !rule.path("schemaVersion").isIntegralNumber()
                || rule.path("schemaVersion").asInt() != 1
                || !"confirmedDeclineAnswerMustFitCandidate".equals(rule.path("rule").asText())
                || !rule.path("reasons").isArray() || rule.path("reasons").size() != SUPPORTED.size()) return false;
        Set<String> found = new HashSet<>();
        for (JsonNode row : rule.path("reasons")) {
            String code = row.path("reasonCode").asText();
            String signature = row.path("path").asText() + "|" + row.path("field").asText() + "|" + row.path("match").asText();
            if (!row.isObject() || row.size() != 4 || !signature.equals(SUPPORTED.get(code)) || !found.add(code)) return false;
        }
        return found.size() == SUPPORTED.size();
    }

    /** null permits the candidate to continue through the ordinary gates, never bypassing any of them. */
    static String blocker(JsonNode rule, Decline latest, long currentVersion, JsonNode content, JsonNode change,
            String candidateId, JsonNode candidateQuote) {
        if (rule == null || latest == null) return null;
        JsonNode mapping = mapping(rule, latest);
        boolean confirmed = answered(rule, latest, currentVersion, content, change);
        if (!confirmed) return latest.orderUuid().equals(candidateId) ? "declined-unresolved" : null;
        String field = mapping.path("field").asText();
        boolean fits = switch (mapping.path("match").asText()) {
            case "known-value" -> knownValue(candidateQuote, field, change.path("after"));
            case "essential-met" -> essentialMet(candidateQuote, field, content.path("essentials").path(field));
            case "closer-fit" -> closer(latest, candidateId, candidateQuote, change);
            default -> false;
        };
        return fits ? null : "decline-answer-mismatch";
    }

    static boolean answered(JsonNode rule, Decline latest, long version, JsonNode content, JsonNode change) {
        JsonNode mapping = mapping(rule, latest);
        if (mapping == null || latest.reason() == null || !text(latest.reason().path("policyVersion"))) return false;
        if (change == null || !change.isObject() || !latest.decisionId().equals(change.path("decisionId").asText())
                || !latest.offerId().equals(change.path("offerId").asText()) || !text(change.path("confirmedBy"))
                || !instant(change.path("confirmedAt")) || !change.path("fromBriefVersion").isIntegralNumber()
                || change.path("fromBriefVersion").asLong() < latest.briefVersion()
                || change.path("fromBriefVersion").asLong() >= version
                || !mapping.path("path").asText().equals(change.path("path").asText())
                || !change.has("before") || !change.hasNonNull("after")
                || !sameChange(latest, change)
                || semanticSame(change.path("before"), change.path("after"), mapping)) return false;
        if (latest.previousBrief() == null
                || !semanticSame(valueAt(latest.previousBrief(), mapping.path("path").asText()), change.path("before"), mapping)) return false;
        String field = mapping.path("field").asText();
        if ("essential-met".equals(mapping.path("match").asText())) {
            JsonNode essential = content.path("essentials").path(field);
            return "employee".equals(essential.path("source").asText())
                    && "confirmed".equals(essential.path("state").asText())
                    && "confirmed".equals(change.path("after").path("state").asText())
                    && "employee".equals(change.path("after").path("source").asText())
                    && essentialSame(essential, change.path("after"));
        }
        JsonNode preference = content.path("preferences").path(field);
        return "employee".equals(preference.path("source").asText())
                && "confirmed".equals(preference.path("valueState").asText())
                && "confirmed".equals(preference.path("importanceState").asText())
                && same(preference.path("value"), change.path("after"));
    }

    private static JsonNode mapping(JsonNode rule, Decline latest) {
        if (rule == null || latest == null || latest.reason() == null) return null;
        for (JsonNode row : rule.path("reasons")) {
            if (row.path("reasonCode").asText().equals(latest.reason().path("code").asText())) return row;
        }
        return null;
    }

    private static boolean sameChange(Decline latest, JsonNode change) {
        return latest.savedChange() != null && latest.savedChange().equals(change)
                && change.path("confirmedBy").asText().equals(latest.confirmedBy())
                && latest.confirmedAt() != null && Instant.parse(change.path("confirmedAt").asText()).equals(latest.confirmedAt());
    }

    private static boolean knownValue(JsonNode quote, String field, JsonNode desired) {
        JsonNode fact = quote == null ? null : quote.path("snapshot").path("facts").path(field);
        if (fact == null || !"known".equals(fact.path("status").asText()) || !fact.path("value").isTextual()) return false;
        JsonNode chosen = unwrap(desired);
        if (chosen.isTextual()) return chosen.equals(fact.path("value"));
        if (chosen.isArray()) for (JsonNode value : chosen) if (value.isTextual() && value.equals(fact.path("value"))) return true;
        return false;
    }

    private static boolean essentialMet(JsonNode quote, String field, JsonNode requirement) {
        if (quote == null) return false;
        for (JsonNode row : quote.path("reasons")) {
            if ("essential-met".equals(row.path("code").asText()) && field.equals(row.path("field").asText())
                    && essentialSame(requirement, row.path("requirement"))) return true;
        }
        return false;
    }

    private static boolean closer(Decline latest, String candidateId, JsonNode quote, JsonNode change) {
        Double observed = observed(quote);
        Double rejected = observed(latest.quote());
        JsonNode before = change.path("before");
        JsonNode after = change.path("after");
        if (observed == null || rejected == null || !before.isNumber() || !Double.isFinite(before.doubleValue())
                || !after.isNumber() || !Double.isFinite(after.doubleValue())) return false;
        double distance = Math.abs(after.doubleValue() - observed);
        if (!latest.orderUuid().equals(candidateId)) return distance < Math.abs(after.doubleValue() - rejected);
        return distance < Math.abs(before.doubleValue() - rejected);
    }

    private static Double observed(JsonNode quote) {
        if (quote == null) return null;
        Double found = null;
        for (String section : new String[] {"reasons", "tradeOffs"}) for (JsonNode row : quote.path(section)) {
            JsonNode value = row.path("observed");
            if ("preference-fit".equals(row.path("code").asText()) && "size".equals(row.path("field").asText())
                    && !row.path("modelFactsIncomplete").asBoolean() && value.isNumber()
                    && Double.isFinite(value.doubleValue())) {
                if (found != null) return null;
                found = value.doubleValue();
            }
        }
        return found;
    }

    private static JsonNode valueAt(JsonNode content, String path) {
        JsonNode value = content.at("/" + path.replace('.', '/'));
        return value.isMissingNode() ? NullNode.instance : value;
    }

    private static boolean semanticSame(JsonNode a, JsonNode b, JsonNode mapping) {
        return "essential-met".equals(mapping.path("match").asText()) ? essentialSame(a, b) : same(a, b);
    }

    private static boolean essentialSame(JsonNode a, JsonNode b) {
        if (!a.isObject() || !b.isObject()) return a.equals(b);
        if (!a.path("operator").equals(b.path("operator")) || !a.path("unit").equals(b.path("unit"))) return false;
        JsonNode av = a.path("value");
        JsonNode bv = b.path("value");
        if (!av.isArray() || !bv.isArray()) return av.equals(bv);
        Set<JsonNode> aa = new HashSet<>();
        Set<JsonNode> bb = new HashSet<>();
        av.forEach(aa::add);
        bv.forEach(bb::add);
        return aa.equals(bb);
    }

    private static boolean same(JsonNode a, JsonNode b) {
        return unwrap(a).equals(unwrap(b));
    }

    private static JsonNode unwrap(JsonNode value) {
        return value.isArray() && value.size() == 1 ? value.get(0) : value;
    }

    private static boolean text(JsonNode value) {
        return value.isTextual() && !value.asText().isBlank();
    }

    private static boolean instant(JsonNode value) {
        if (!text(value)) return false;
        try {
            Instant.parse(value.asText());
            return true;
        } catch (DateTimeParseException ignored) {
            return false;
        }
    }
}
