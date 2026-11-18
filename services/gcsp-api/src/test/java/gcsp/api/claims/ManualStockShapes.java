package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Canonical;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Java mirror of the Angular stock contract: account.client.ts stock() and scoped, and stock.projection.ts
 * validateStockPayload with decision(), snapshot(), terms() and fact(). Never weaker than the originals.
 */
public final class ManualStockShapes {

    private static final List<String> ASSURANCES = List.of("unknown", "confirmed-listing", "confirmed-build",
            "model-reference", "derived", "synthetic-scenario");
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u001f\\u007f]");
    private static final Pattern INSTANT = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z");
    private static final Pattern ORDER_NUMBER = Pattern.compile("\\d{7}");
    private static final Pattern CURRENCY = Pattern.compile("[A-Z]{3}");

    private ManualStockShapes() {}

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank() && !CONTROL.matcher(n.textValue()).find();
    }

    private static boolean count(JsonNode n) {
        return n != null && n.isIntegralNumber() && n.longValue() >= 0;
    }

    private static boolean positive(JsonNode n) {
        return count(n) && n.longValue() > 0;
    }

    private static boolean amount(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.doubleValue()) && n.doubleValue() >= 0;
    }

    private static boolean instant(JsonNode n) {
        if (!text(n) || !INSTANT.matcher(n.textValue()).matches()) return false;
        try {
            return Instant.parse(n.textValue()).toString().substring(0, 19).equals(n.textValue().substring(0, 19));
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    private static boolean optionalText(JsonNode n) {
        return n == null || n.isNull() || text(n);
    }

    private static boolean same(JsonNode a, JsonNode b) {
        return Canonical.json(a).equals(Canonical.json(b));
    }

    private static boolean provenance(JsonNode v) {
        return v != null && v.isObject() && text(v.get("sourceRef")) && text(v.get("version")) && instant(v.get("observedAt"))
                && v.get("assurance") != null && ASSURANCES.contains(v.get("assurance").asText());
    }

    private static boolean fact(JsonNode v) {
        if (v == null || !v.isObject() || !v.has("value") || !v.has("status")
                || !List.of("known", "unknown").contains(v.get("status").asText())) return false;
        boolean unknown = "unknown".equals(v.get("status").asText());
        if (unknown != v.get("value").isNull()) return false;
        JsonNode unit = v.get("unit");
        if (!(unit != null && unit.isNull() || text(unit))) return false;
        if (v.get("value").isNumber() && !text(unit)) return false;
        JsonNode origin = v.get("provenance");
        return origin == null || provenance(origin) && unknown == "unknown".equals(origin.get("assurance").asText());
    }

    private static boolean points(JsonNode v) {
        return v != null && v.isObject() && amount(v.get("value")) && "points".equals(v.path("unit").asText());
    }

    private static boolean terms(JsonNode v) {
        if (v == null || !v.isObject() || !"employee-scheme".equals(v.path("kind").asText()) || !text(v.get("termsVersion"))
                || !points(v.get("points")) || v.get("allowanceInputs") == null || !v.get("allowanceInputs").isObject()) return false;
        for (JsonNode p : v.get("allowanceInputs")) if (!points(p)) return false;
        JsonNode cash = v.get("contribution");
        if (cash != null && !cash.isNull() && !(cash.isObject() && amount(cash.get("amount")) && text(cash.get("currency"))
                && CURRENCY.matcher(cash.get("currency").textValue()).matches()
                && List.of("month", "year", "one-off").contains(cash.path("period").asText()))) return false;
        if (v.has("provenance") && !provenance(v.get("provenance"))) return false;
        boolean noDates = !v.has("validFrom") && !v.has("validUntil");
        return noDates || instant(v.get("validFrom")) && instant(v.get("validUntil"))
                && Instant.parse(v.get("validUntil").textValue()).isAfter(Instant.parse(v.get("validFrom").textValue()));
    }

    private static boolean snapshot(JsonNode v, String id, String key) {
        if (v == null || !v.isObject() || !"exact-stock".equals(v.path("identityKind").asText()) || !v.path("sourceKeys").isObject()
                || !id.equals(v.path("sourceKeys").path("stockId").asText(null)) || !text(v.get("sourceNamespace"))
                || !key.equals(v.path("candidateKey").asText(null)) || !text(v.get("snapshotVersion"))
                || !v.path("facts").isObject() || !v.path("display").isObject()) return false;
        String expectedKey = java.net.URLEncoder.encode(v.get("sourceNamespace").textValue(), java.nio.charset.StandardCharsets.UTF_8)
                + ":exact-stock:" + java.net.URLEncoder.encode(id, java.nio.charset.StandardCharsets.UTF_8);
        if (!key.equals(expectedKey)) return false;
        for (JsonNode f : v.get("facts")) if (!fact(f)) return false;
        if (v.has("contractVersion") && !"vehicle-snapshot-v1".equals(v.get("contractVersion").asText())) return false;
        if (v.has("observedAt") && !instant(v.get("observedAt"))) return false;
        JsonNode display = v.get("display");
        for (String k : List.of("name", "manufacturer", "model", "derivative", "photo", "link", "colour")) {
            if (!optionalText(display.get(k))) return false;
        }
        JsonNode images = display.get("images");
        if (images == null) return true;
        if (!images.isArray()) return false;
        for (JsonNode image : images) {
            if (!image.isObject() || !text(image.get("src")) || !optionalText(image.get("alt"))
                    || !optionalText(image.get("caption"))) return false;
        }
        return true;
    }

    private static boolean decision(JsonNode v, JsonNode versions) {
        if (v == null || !v.isObject() || !text(v.get("orderUuid")) || !text(v.get("configurationId"))
                || !text(v.get("candidateKey")) || !v.path("orderNumber").isTextual()
                || !ORDER_NUMBER.matcher(v.get("orderNumber").textValue()).matches()
                || !same(v.get("draftVersion"), versions.get("draft"))
                || !List.of("eligible", "ineligible", "needs-confirmation").contains(v.path("gateStatus").asText())
                || !snapshot(v.get("snapshot"), v.get("orderUuid").textValue(), v.get("candidateKey").textValue())
                || !v.path("versions").isObject()) return false;
        JsonNode pin = v.get("versions");
        JsonNode snap = v.get("snapshot");
        JsonNode quote = v.get("terms");
        if (!text(pin.get("availability"))) return false;
        JsonNode avail = v.path("evidence").path("availability");
        if (avail.isObject() && !same(avail.get("version"), pin.get("availability"))) return false;
        if (!same(pin.get("snapshot"), snap.get("snapshotVersion")) || quote != null && !quote.isNull() && !terms(quote)) return false;
        JsonNode expectedTerms = quote != null && quote.isObject() ? quote.get("termsVersion") : null;
        if (!(expectedTerms == null ? pin.get("terms") != null && pin.get("terms").isNull() : same(pin.get("terms"), expectedTerms))) return false;
        for (var it = versions.fields(); it.hasNext();) {
            var e = it.next();
            if (!List.of("draft", "context").contains(e.getKey()) && (!pin.has(e.getKey()) || !same(pin.get(e.getKey()), e.getValue()))) return false;
        }
        if (pin.has("context") && !same(pin.get("context"), versions.get("context"))) return false;
        for (var it = pin.fields(); it.hasNext();) {
            var e = it.next();
            boolean ok = e.getKey().equals("brief") ? same(e.getValue(), versions.get("draft"))
                    : e.getKey().equals("terms") ? e.getValue().isNull() || text(e.getValue()) : text(e.getValue());
            if (!ok) return false;
        }
        JsonNode score = v.get("score");
        if (score != null && !score.isNull()) return false;
        JsonNode suitable = v.get("suitable");
        if (suitable != null && suitable.asBoolean() != "eligible".equals(v.get("gateStatus").asText())) return false;
        for (String k : List.of("blockers", "unknowns")) {
            if (!v.path(k).isArray()) return false;
            for (JsonNode e : v.get(k)) if (!text(e) && !e.isObject()) return false;
        }
        JsonNode claim = v.get("claimInput");
        return claim == null || claim.isNull() || claim.isObject() && "eligible".equals(v.get("gateStatus").asText())
                && quote != null && quote.isObject() && same(claim.get("orderUuid"), v.get("orderUuid"))
                && positive(claim.get("expectedStockVersion")) && same(claim.get("expectedDraftVersion"), versions.get("draft"))
                && same(claim.get("expectedContextVersion"), versions.get("context")) && text(claim.get("expectedTermsDigest"));
    }

    /** validateStockPayload: the expanded decisions and cars when the payload is valid, else null. */
    public static List<JsonNode> validate(JsonNode input) {
        if (input == null || !input.isObject() || !input.path("versions").isObject() || !positive(input.path("versions").get("draft"))
                || !text(input.path("versions").get("context")) || !count(input.get("total")) || !input.path("decisions").isArray()
                || input.path("ranked").isMissingNode() || input.path("ranked").asBoolean(true)
                || input.path("browsingReservesStock").isMissingNode() || input.path("browsingReservesStock").asBoolean(true)) return null;
        JsonNode versions = input.get("versions");
        for (String k : List.of("brief", "facts", "policy", "stock", "clock")) if (!versions.has(k)) return null;
        if (!same(versions.get("brief"), versions.get("draft"))) return null;
        for (var it = versions.fields(); it.hasNext();) {
            var e = it.next();
            if (List.of("draft", "brief").contains(e.getKey()) ? !positive(e.getValue()) : !text(e.getValue())) return null;
        }
        List<JsonNode> rows = new ArrayList<>();
        List<JsonNode> cars = new ArrayList<>();
        if (input.has("payloadShape")) {
            JsonNode shared = input.get("sharedVersionKeys");
            JsonNode ids = input.get("carIds");
            if (!"manual-stock-compact-v1".equals(input.get("payloadShape").asText()) || input.has("cars") || shared == null
                    || !shared.isArray() || ids == null || !ids.isArray()) return null;
            Set<String> seen = new HashSet<>();
            for (JsonNode k : shared) {
                if (!text(k) || !seen.add(k.textValue()) || !versions.has(k.textValue())
                        || List.of("draft", "context").contains(k.textValue())) return null;
            }
            for (JsonNode row : input.get("decisions")) {
                if (!row.isObject() || !row.path("versions").isObject()) return null;
                com.fasterxml.jackson.databind.node.ObjectNode copy = ((com.fasterxml.jackson.databind.node.ObjectNode) row).deepCopy();
                com.fasterxml.jackson.databind.node.ObjectNode pin = (com.fasterxml.jackson.databind.node.ObjectNode) copy.get("versions");
                for (JsonNode k : shared) {
                    if (row.get("versions").has(k.textValue())) return null;
                    pin.set(k.textValue(), versions.get(k.textValue()));
                }
                rows.add(copy);
            }
            Set<String> ids2 = new HashSet<>();
            for (JsonNode id : ids) if (!text(id) || !ids2.add(id.textValue())) return null;
            for (JsonNode id : ids) {
                JsonNode row = rows.stream().filter(r -> id.textValue().equals(r.path("orderUuid").asText(null))).findFirst().orElse(null);
                if (row == null) return null;
                cars.add(row);
            }
        } else {
            if (!input.path("cars").isArray() || input.has("carIds") || input.has("sharedVersionKeys")) return null;
            input.get("decisions").forEach(rows::add);
            input.get("cars").forEach(cars::add);
        }
        Set<String> uuids = new HashSet<>();
        Set<String> numbers = new HashSet<>();
        for (JsonNode row : rows) {
            if (!decision(row, versions)) return null;
            uuids.add(row.get("orderUuid").textValue());
            numbers.add(row.get("orderNumber").textValue());
        }
        if (uuids.size() != rows.size() || numbers.size() != rows.size()) return null;
        List<JsonNode> eligible = rows.stream().filter(r -> "eligible".equals(r.get("gateStatus").asText())).toList();
        if (cars.size() != input.get("total").longValue() || cars.size() != eligible.size()) return null;
        Set<String> carIds = new HashSet<>();
        for (JsonNode car : cars) {
            JsonNode row = rows.stream().filter(r -> r.get("orderUuid").equals(car.get("orderUuid"))).findFirst().orElse(null);
            if (row == null || !same(car, row) || !"eligible".equals(car.path("gateStatus").asText())) return null;
            carIds.add(car.get("orderUuid").textValue());
        }
        if (carIds.size() != cars.size()) return null;
        String state = input.path("state").asText();
        String expected = rows.isEmpty() ? "empty-stock" : eligible.isEmpty() ? "no-eligible-stock" : "available-stock";
        if (!state.equals(expected) && !(state.equals("nothing-released-yet") && rows.isEmpty())) return null;
        JsonNode held = input.get("heldOffer");
        if (held != null && !held.isNull() && !(held.isObject() && optionalText(held.get("offerId")) && optionalText(held.get("runId")))) {
            return null;
        }
        return rows;
    }

    /** account.client.ts stock(): the shape the client checks before it validates the payload. */
    public static boolean stock(JsonNode v) {
        if (v == null || !v.isObject() || !count(v.get("total")) || !v.path("decisions").isArray() || !v.path("versions").isObject()
                || !count(v.get("versions").get("draft")) || !text(v.get("versions").get("context"))) return false;
        for (JsonNode d : v.get("decisions")) if (!d.isObject()) return false;
        if (!v.has("payloadShape")) {
            if (!v.path("cars").isArray()) return false;
            for (JsonNode c : v.get("cars")) if (!c.isObject()) return false;
            return true;
        }
        if (!"manual-stock-compact-v1".equals(v.get("payloadShape").asText()) || !v.path("carIds").isArray()
                || !v.path("sharedVersionKeys").isArray()) return false;
        for (JsonNode id : v.get("carIds")) if (!text(id)) return false;
        for (JsonNode k : v.get("sharedVersionKeys")) if (!text(k) || !v.get("versions").has(k.textValue())) return false;
        return true;
    }

    /** Every nested employeeId, environmentId and runId must equal the caller's. */
    public static boolean scoped(JsonNode v, Map<String, String> scope) {
        if (v.isArray()) {
            for (JsonNode n : v) if (!scoped(n, scope)) return false;
            return true;
        }
        if (!v.isObject()) return true;
        for (var it = v.fields(); it.hasNext();) {
            var e = it.next();
            if (scope.containsKey(e.getKey())) {
                if (!e.getValue().isTextual() || !e.getValue().textValue().equals(scope.get(e.getKey()))) return false;
            } else if (!scoped(e.getValue(), scope)) {
                return false;
            }
        }
        return true;
    }

    /** A 200 body that the Angular client and validateStockPayload both accept, scoped to the caller. */
    public static List<JsonNode> assertOkStock(JsonNode body, Map<String, String> scope) {
        assertEquals("ok", body.get("status").asText(), body.toString());
        assertTrue(stock(body.get("value")), "account.client stock(): " + body);
        List<JsonNode> rows = validate(body.get("value"));
        assertTrue(rows != null, "validateStockPayload: " + body);
        assertTrue(scoped(body, scope), "scoped: " + body);
        return rows;
    }
}
