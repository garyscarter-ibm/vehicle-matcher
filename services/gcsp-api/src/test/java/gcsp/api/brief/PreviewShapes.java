package gcsp.api.brief;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Test helpers mirroring Angular's brief.client validPreview and brief.validation previewShape. */
final class PreviewShapes {

    private PreviewShapes() {}

    /** The request Angular's validPreview accepts: exactly kind, the two versions and an editable brief. */
    static ObjectNode request(long brief, long draft, JsonNode editable) {
        ObjectNode r = Json.obj();
        r.put("kind", "unsaved-draft").put("baseBriefVersion", brief).put("draftVersion", draft);
        r.set("brief", editable.deepCopy());
        return r;
    }

    /** A recommendation-preview value of the given state, as previewShape requires (no cars when no-stock). */
    static ObjectNode value(String state) {
        ObjectNode v = Json.obj();
        v.put("state", state).put("eligibleCount", 0);
        v.putObject("versions");
        v.putArray("decisions");
        v.putArray("recommendations");
        return v;
    }

    /** Angular's previewShape over the value, with its state, count and decision cross-checks. */
    static boolean previewShape(JsonNode v) {
        if (v == null || !v.isObject() || !java.util.List.of("recommendations", "no-stock", "no-viable-stock").contains(v.path("state").asText())
                || !v.path("eligibleCount").canConvertToInt() || !v.path("versions").isObject() || !v.path("decisions").isArray()
                || !v.path("recommendations").isArray()) return false;
        long eligible = 0;
        for (JsonNode d : v.get("decisions")) {
            if (!d.isObject() || !text(d.get("orderUuid")) || !java.util.List.of("eligible", "ineligible", "needs-confirmation")
                    .contains(d.path("gateStatus").asText()) || !d.path("versions").isObject()) return false;
            for (String k : new String[] {"unknowns", "reasons", "tradeOffs", "blockers"}) {
                if (!d.path(k).isArray()) return false;
                for (JsonNode i : d.get(k)) if (!i.isObject()) return false;
            }
            if ("eligible".equals(d.get("gateStatus").asText())) eligible++;
        }
        for (JsonNode r : v.get("recommendations")) {
            boolean listed = false;
            for (JsonNode d : v.get("decisions")) {
                listed |= d.path("orderUuid").equals(r.path("orderUuid")) && "eligible".equals(d.path("gateStatus").asText());
            }
            if (!r.isObject() || !text(r.get("orderUuid")) || !r.path("reasons").isArray() || !r.path("tradeOffs").isArray()
                    || !r.path("versions").isObject() || !"eligible".equals(r.path("gateStatus").asText()) || !listed) return false;
        }
        return v.get("eligibleCount").longValue() == eligible
                && "recommendations".equals(v.get("state").asText()) == (v.get("recommendations").size() > 0)
                && "no-stock".equals(v.get("state").asText()) == (v.get("decisions").size() == 0);
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.asText().isBlank();
    }

    /** Angular's validDeclineChange: exactly commandId, expectedBriefVersion, decisionId and a {path, value} change. */
    static boolean declineRequest(JsonNode v) {
        JsonNode c = v.get("change");
        return only(v, "commandId", "expectedBriefVersion", "decisionId", "change") && text(v.get("commandId"))
                && v.get("commandId").asText().length() <= 128 && v.path("expectedBriefVersion").canConvertToLong()
                && v.get("expectedBriefVersion").longValue() >= 0 && text(v.get("decisionId"))
                && only(c, "path", "value") && text(c.get("path")) && c.has("value");
    }

    /** Angular's currentValue: a versioned brief (briefShape), the activity flags, and the validation lists. */
    static boolean currentValue(JsonNode v) {
        JsonNode b = v.get("brief");
        JsonNode a = v.get("activity");
        JsonNode val = v.get("validation");
        return b != null && b.isObject() && b.path("schemaVersion").intValue() == 1 && b.path("briefVersion").canConvertToLong()
                && text(b.get("status")) && briefShape(b) && a != null && a.isObject()
                && a.path("canSearch").isBoolean() && a.path("canHold").isBoolean() && a.path("existingOffersUnaffected").isBoolean()
                && a.path("existingOffers").isArray() && val != null && val.isObject() && text(val.get("policyVersion"))
                && val.path("unknownEssentials").isArray() && val.path("assumptions").isArray();
    }

    /** Angular's briefShape (brief.validation.ts). */
    static boolean briefShape(JsonNode v) {
        if (v.path("schemaVersion").intValue() != 1 || !v.path("preferences").isObject() || !v.path("essentials").isObject()) return false;
        java.util.List<String> states = java.util.List.of("draft", "inferred", "confirmed");
        for (JsonNode p : v.get("preferences")) {
            JsonNode x = p.get("value");
            boolean value = x != null && (x.isTextual() || x.isBoolean() || x.isNumber() || x.isArray());
            if (!p.isObject() || !value || !p.path("importance").isNumber() || !states.contains(p.path("valueState").asText())
                    || !states.contains(p.path("importanceState").asText()) || !text(p.get("source"))) return false;
        }
        for (JsonNode e : v.get("essentials")) {
            if (!e.isObject() || !e.has("value") || !text(e.get("operator")) || !(e.path("unit").isNull() || text(e.get("unit")))
                    || !(states.contains(e.path("state").asText()) || "needs-confirmation".equals(e.path("state").asText()))
                    || !text(e.get("source"))) return false;
        }
        return true;
    }

    private static boolean only(JsonNode n, String... keys) {
        if (n == null || !n.isObject()) return false;
        java.util.Set<String> allowed = java.util.Set.of(keys);
        for (var it = n.fieldNames(); it.hasNext();) if (!allowed.contains(it.next())) return false;
        return true;
    }
}
