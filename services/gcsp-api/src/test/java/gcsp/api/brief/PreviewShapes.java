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
}
