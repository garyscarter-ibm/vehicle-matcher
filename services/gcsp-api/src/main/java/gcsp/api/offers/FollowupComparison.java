package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyClock;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** The ready follow-up: both offers as the web client validates them and the brief compared to each quote. Returns null, never a guess. */
final class FollowupComparison {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern ORDER_NUMBER = Pattern.compile("\\d{7}");
    private static final Set<String> PUBLIC_FACTS = Set.of("eligibilityModelKey", "body", "fuel", "seats", "doors", "boot",
            "zeroTo62", "mileage", "evRange", "mpg", "cc", "year", "sizeClass", "tags", "frontIsofix", "rearIsofix", "gearbox",
            "transmission", "colour", "interior", "co2", "power", "torque", "electricRange", "equipment", "options",
            "availableFrom");
    private static final List<String> EXPLAIN = List.of("code", "text", "key", "field", "keys", "facts", "attribute",
            "preference", "direction", "expected", "actual", "target", "desired", "observed", "unit", "allowance",
            "monthlyPoints", "score", "weight", "importance", "ruleIds", "requiredBy", "availableFrom");
    private static final List<String> PINS = List.of("brief", "facts", "policy", "stock", "snapshot", "terms", "clock",
            "availability", "feedback");
    private static final List<String> CURRENT_CAR = List.of("configuration", "body", "fuel", "seats", "boot", "mpg",
            "zeroTo62", "points");

    private FollowupComparison() {}

    /** One offer as the follow-up shows it, or null. Quotes are immutable rows, so their revision is 1. */
    static ObjectNode offer(OfferView v, String runId, String clockVersion, String decisionId, JsonNode quote,
            String orderNumber) {
        OfferView.Quote q = v.quote();
        long brief;
        try {
            brief = Long.parseLong(q.briefVersion());
        } catch (NumberFormatException | NullPointerException e) {
            return null;
        }
        if (brief <= 0 || clockVersion == null || q.validUntil() == null || q.quotedAt() == null || v.expiresAt() == null
                || quote == null || !quote.isObject()) return null;
        ObjectNode snapshot = snapshot(quote.path("snapshot"), q.orderUuid());
        ObjectNode terms = terms(quote.path("terms"));
        ObjectNode decision = decision(quote);
        if (snapshot == null || terms == null || decision == null) return null;
        ObjectNode o = F.objectNode();
        o.put("schemaVersion", 1).put("offerId", v.offerId()).put("runId", runId).put("state", v.state());
        o.put("reason", v.reason()).put("serverNow", PolicyClock.iso(v.serverNow())).put("clockVersion", clockVersion);
        o.put("expiresAt", PolicyClock.iso(v.expiresAt())).put("offerVersion", v.offerVersion());
        o.put("holdVersion", v.holdVersion()).put("offerState", v.offerState()).put("holdState", v.holdState());
        ArrayNode actions = o.putArray("availableActions");
        // Accept needs a handoff this view does not build, so only decline is listed.
        v.availableActions().stream().filter("decline"::equals).forEach(actions::add);
        if (decisionId == null) o.putNull("followup"); else o.putObject("followup").put("decisionId", decisionId);
        o.putNull("handoff");
        o.putNull("selection");
        ObjectNode out = o.putObject("quote");
        out.put("quoteId", q.quoteId()).put("configurationId", q.configurationId()).put("orderUuid", q.orderUuid());
        if (orderNumber != null && ORDER_NUMBER.matcher(orderNumber).matches()) out.put("orderNumber", orderNumber);
        else out.putNull("orderNumber");
        out.put("briefVersion", brief).put("policyVersion", q.policyVersion()).put("quotedAt", PolicyClock.iso(q.quotedAt()));
        out.put("validUntil", PolicyClock.iso(q.validUntil()));
        ObjectNode revisions = out.putObject("revisions");
        revisions.put("quote", 1);
        for (String pin : PINS) {
            JsonNode n = quote.path("versions").get(pin);
            if (n != null && (n.isTextual() && !n.textValue().isBlank() || n.isNumber() && Double.isFinite(n.doubleValue()))) {
                revisions.set(pin, n);
            }
        }
        out.set("facts", snapshot);
        out.set("decision", decision);
        out.set("terms", terms);
        out.set("allowance", terms.get("allowanceInputs").deepCopy());
        // A Java quote pins no current-car comparison, so the truthful answer is unavailable.
        ObjectNode cmp = o.putObject("comparison");
        cmp.put("status", "unavailable").put("reason", "pinned-current-car-comparison-unavailable");
        cmp.put("comparisonAvailable", false).putNull("currentCar");
        ArrayNode unknowns = cmp.putArray("unknowns");
        CURRENT_CAR.forEach(unknowns::add);
        return o;
    }

    /** The comparison of the confirmed brief against both quotes, or null when the inputs do not support one. */
    static ObjectNode build(ObjectNode previous, ObjectNode next, JsonNode brief, JsonNode config) {
        JsonNode pq = previous.path("quote");
        JsonNode nq = next.path("quote");
        if (!config.path("preferences").isObject() || !config.path("essentials").isObject()
                || !"confirmed".equals(brief.path("status").asText()) || nq.path("briefVersion").asLong() != brief.path("briefVersion").asLong()
                || previous.path("offerId").equals(next.path("offerId")) || pq.path("quoteId").equals(nq.path("quoteId"))) return null;
        ObjectNode out = F.objectNode();
        out.put("schemaVersion", 1).put("currentBriefVersion", brief.path("briefVersion").asLong());
        ArrayNode requirements = out.putArray("requirements");
        Iterator<Map.Entry<String, JsonNode>> prefs = brief.path("preferences").fields();
        while (prefs.hasNext()) {
            Map.Entry<String, JsonNode> e = prefs.next();
            JsonNode definition = config.path("preferences").get(e.getKey());
            JsonNode p = e.getValue();
            if (definition == null || !"confirmed".equals(p.path("valueState").asText())
                    || !"confirmed".equals(p.path("importanceState").asText())) continue;
            if (!p.path("importance").isNumber() || !Double.isFinite(p.path("importance").doubleValue())) return null;
            ObjectNode r = requirements.addObject();
            r.put("kind", "preference").put("key", e.getKey());
            r.set("value", p.path("value").deepCopy());
            r.set("importance", p.get("importance"));
            List<String> fields = new java.util.ArrayList<>();
            definition.path("facts").forEach(f -> fields.add(f.asText()));
            r.set("previousFacts", factsFor(pq, fields));
            r.set("nextFacts", factsFor(nq, fields));
        }
        Iterator<Map.Entry<String, JsonNode>> essentials = brief.path("essentials").fields();
        while (essentials.hasNext()) {
            Map.Entry<String, JsonNode> e = essentials.next();
            JsonNode x = e.getValue();
            if (config.path("essentials").get(e.getKey()) == null || !"confirmed".equals(x.path("state").asText())
                    || x.path("value").isMissingNode() || x.path("value").isNull()) continue;
            if (!x.path("operator").isTextual()) return null;
            ObjectNode r = requirements.addObject();
            r.put("kind", "essential").put("key", e.getKey());
            r.set("value", x.get("value").deepCopy());
            r.set("operator", x.get("operator"));
            r.set("unit", x.path("unit").isTextual() ? x.get("unit") : F.nullNode());
            r.set("previousFacts", factsFor(pq, List.of(e.getKey())));
            r.set("nextFacts", factsFor(nq, List.of(e.getKey())));
        }
        out.set("previous", side(previous));
        out.set("next", side(next));
        return out;
    }

    private static ObjectNode side(ObjectNode offer) {
        JsonNode q = offer.path("quote");
        ObjectNode s = F.objectNode();
        s.set("offer", offer);
        ObjectNode basis = s.putObject("scoreBasis");
        basis.put("kind", "historical-quote").set("briefVersion", q.get("briefVersion"));
        basis.set("policyVersion", q.get("policyVersion"));
        basis.set("quotedAt", q.get("quotedAt"));
        return s;
    }

    private static ObjectNode factsFor(JsonNode quote, List<String> keys) {
        ObjectNode out = F.objectNode();
        for (String key : keys) {
            JsonNode fact = quote.path("facts").path("facts").get(key);
            if (fact != null && fact.isObject()) out.set(key, fact.deepCopy());
            else out.putObject(key).put("status", "unknown").putNull("value").putNull("unit").putNull("provenance");
        }
        return out;
    }

    private static ObjectNode snapshot(JsonNode s, String orderUuid) {
        if (!s.isObject() || !"vehicle-snapshot-v1".equals(s.path("contractVersion").asText())
                || !"exact-stock".equals(s.path("identityKind").asText())
                || !orderUuid.equals(s.path("sourceKeys").path("stockId").asText(null))) return null;
        ObjectNode out = F.objectNode();
        for (String key : List.of("contractVersion", "candidateKey", "sourceNamespace", "identityKind", "snapshotVersion",
                "observedAt")) {
            if (!s.path(key).isTextual()) return null;
            out.set(key, s.get(key));
        }
        out.putObject("sourceKeys").put("stockId", orderUuid);
        JsonNode display = s.path("display");
        ObjectNode d = out.putObject("display");
        for (String key : List.of("name", "manufacturer", "model", "derivative", "colour")) {
            if (display.path(key).isTextual()) d.set(key, display.get(key));
        }
        d.set("photo", display.path("photo").isTextual() ? display.get("photo") : F.nullNode());
        ArrayNode images = d.putArray("images");
        for (JsonNode image : display.path("images")) {
            ObjectNode i = F.objectNode();
            if (image.isTextual()) i.set("src", image);
            else for (String key : List.of("src", "alt", "caption", "fidelity", "sourceRef", "viewpoint", "label")) {
                if (image.path(key).isTextual()) i.set(key, image.get(key));
            }
            if (i.path("src").isTextual()) images.add(i);
        }
        ObjectNode facts = out.putObject("facts");
        Iterator<Map.Entry<String, JsonNode>> it = s.path("facts").fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!PUBLIC_FACTS.contains(e.getKey())) continue;
            ObjectNode fact = fact(e.getValue());
            if (fact == null) return null;
            facts.set(e.getKey(), fact);
        }
        return out;
    }

    private static ObjectNode fact(JsonNode f) {
        String status = f.path("status").asText("");
        if (!f.isObject() || !(status.equals("known") || status.equals("unknown")) || !simple(f.path("value"))) return null;
        ObjectNode out = F.objectNode();
        out.put("status", status);
        out.set("value", f.path("value").isMissingNode() ? F.nullNode() : f.get("value").deepCopy());
        out.set("unit", f.path("unit").isTextual() ? f.get("unit") : F.nullNode());
        ObjectNode p = out.putObject("provenance");
        for (String key : List.of("sourceRef", "observedAt", "version", "assurance")) {
            if (f.path("provenance").path(key).isTextual()) p.set(key, f.path("provenance").get(key));
        }
        return out;
    }

    private static ObjectNode terms(JsonNode t) {
        if (!t.isObject() || !"employee-scheme".equals(t.path("kind").asText()) || !t.path("points").isObject()
                || !t.path("allowanceInputs").path("allowance").isObject()) return null;
        ObjectNode out = F.objectNode();
        for (String key : List.of("kind", "termsVersion", "validFrom", "validUntil", "points", "provenance")) {
            if (t.path(key).isMissingNode()) return null;
            out.set(key, t.get(key).deepCopy());
        }
        out.putObject("allowanceInputs").set("allowance", t.get("allowanceInputs").get("allowance").deepCopy());
        out.set("contribution", t.path("contribution").isMissingNode() ? F.nullNode() : t.get("contribution").deepCopy());
        return out;
    }

    private static ObjectNode decision(JsonNode quote) {
        String gate = quote.path("gateStatus").asText("");
        if (!List.of("eligible", "ineligible", "needs-confirmation").contains(gate)) return null;
        JsonNode stored = quote.path("decision");
        ObjectNode out = F.objectNode();
        out.put("gateStatus", gate);
        JsonNode score = stored.path("score");
        if (score.isNumber() && Double.isFinite(score.doubleValue())) out.set("score", score); else out.putNull("score");
        out.set("reasons", explanation(quote.path("reasons")));
        out.set("tradeOffs", explanation(quote.path("tradeOffs")));
        out.set("blockers", explanation(stored.path("blockers")));
        out.set("unknowns", explanation(stored.path("unknowns")));
        return out;
    }

    private static ArrayNode explanation(JsonNode rows) {
        ArrayNode out = F.arrayNode();
        if (!rows.isArray()) return out;
        for (JsonNode row : rows) {
            if (row.isTextual()) {
                out.add(row);
                continue;
            }
            ObjectNode p = F.objectNode();
            for (String key : EXPLAIN) if (simple(row.path(key)) && row.has(key)) p.set(key, row.get(key));
            JsonNode facts = row.path("facts");
            if (facts.isObject()) {
                ObjectNode kept = p.putObject("facts");
                facts.fields().forEachRemaining(e -> {
                    ObjectNode f = PUBLIC_FACTS.contains(e.getKey()) && e.getValue().isObject() ? fact(e.getValue()) : null;
                    if (f != null) kept.set(e.getKey(), f);
                });
            }
            if (PUBLIC_FACTS.contains(row.path("field").asText())) {
                JsonNode req = row.path("requirement");
                if (req.isObject()) {
                    ObjectNode r = p.putObject("requirement");
                    for (String key : List.of("value", "operator", "unit")) if (simple(req.path(key)) && req.has(key)) r.set(key, req.get(key));
                }
                if (row.path("fact").isObject()) {
                    ObjectNode f = fact(row.get("fact"));
                    if (f != null) p.set("fact", f);
                }
            }
            out.add(p);
        }
        return out;
    }

    private static boolean simple(JsonNode n) {
        if (n.isMissingNode() || scalar(n)) return true;
        if (!n.isArray()) return false;
        for (JsonNode item : n) if (!scalar(item)) return false;
        return true;
    }

    private static boolean scalar(JsonNode n) {
        return n.isNull() || n.isTextual() || n.isBoolean() || n.isNumber() && Double.isFinite(n.doubleValue());
    }
}
