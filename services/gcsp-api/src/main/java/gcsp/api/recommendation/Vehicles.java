package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** createVehicleSnapshot and createEmployeeTerms from server/vehicles/index.js: validation plus the normalised shape. */
final class Vehicles {

    private static final List<String> ASSURANCES =
            List.of("unknown", "confirmed-listing", "confirmed-build", "model-reference", "derived", "synthetic-scenario");
    private static final Map<String, String> FACT_UNITS = Map.of("seats", "count", "doors", "count", "boot", "L",
            "zeroTo62", "s", "mileage", "mi", "evRange", "mi", "mpg", "mpg-imperial", "cc", "cm3", "year", "year",
            "sizeClass", "ordinal-1-5");
    private static final Pattern VIN = Pattern.compile("[A-HJ-NPR-Z0-9]{17}");
    private static final List<String> KINDS = List.of("advert", "exact-stock", "vin", "legacy-record");
    private static final Map<String, String> KEY_OF = Map.of("advert", "advertId", "exact-stock", "stockId",
            "legacy-record", "recordId");

    private Vehicles() {}

    private static RecommendationFault fail(String field) {
        return new RecommendationFault("Invalid " + field);
    }

    private static void text(JsonNode value, String field) {
        if (!Js.text(value)) throw fail(field);
    }

    private static void object(JsonNode value, String field) {
        if (!Js.object(value)) throw fail(field);
    }

    private static void keys(JsonNode value, List<String> allowed, String field) {
        object(value, field);
        value.fieldNames().forEachRemaining(name -> {
            if (!allowed.contains(name)) throw fail(field);
        });
    }

    private static void date(JsonNode value, String field) {
        text(value, field);
        if (!Instants.strictDate(value)) throw fail(field);
    }

    private static void amount(JsonNode value, String field) {
        if (!Js.finite(value) || value.doubleValue() < 0) throw fail(field);
    }

    /** Clones only JSON data (objects keep the JS own-key order: integer-like keys first). */
    static JsonNode data(JsonNode value, String field) {
        if (value != null && (value.isNull() || value.isTextual() || value.isBoolean())) return value;
        if (Js.finite(value)) return value;
        if (value != null && value.isArray()) {
            ArrayNode out = Js.arr();
            for (JsonNode item : value) out.add(data(item, field));
            return out;
        }
        object(value, field);
        ObjectNode out = Js.obj();
        for (Map.Entry<String, JsonNode> e : Js.entries(value)) out.set(e.getKey(), data(e.getValue(), field));
        return out;
    }

    private static JsonNode provenance(JsonNode value) {
        keys(value, List.of("sourceRef", "observedAt", "version", "assurance"), "provenance");
        text(value.get("sourceRef"), "provenance.sourceRef");
        text(value.get("version"), "provenance.version");
        date(value.get("observedAt"), "provenance.observedAt");
        if (!Js.includes(ASSURANCES, value.get("assurance"))) throw fail("provenance.assurance");
        return data(value, "provenance");
    }

    private static ObjectNode fact(JsonNode value, String name) {
        String where = "facts." + name;
        keys(value, List.of("status", "value", "unit", "provenance"), where);
        JsonNode status = value.get("status");
        if (!Js.eqStr(status, "known") && !Js.eqStr(status, "unknown")) throw fail(where + ".status");
        JsonNode origin = provenance(value.get("provenance"));
        JsonNode val = value.get("value");
        boolean unknown = Js.eqStr(status, "unknown");
        if (unknown != (val != null && val.isNull()) || unknown != Js.eqStr(origin.get("assurance"), "unknown")) {
            throw fail(where + ".assurance");
        }
        JsonNode unit = value.get("unit");
        if (!(unit != null && unit.isNull())) text(unit, where + ".unit");
        if (Js.finite(val) && !Js.truthy(unit)) throw fail(where + ".unit");
        String expectedUnit = FACT_UNITS.get(name);
        if (expectedUnit != null && !Js.eqStr(unit, expectedUnit)) throw fail(where + ".unit");
        if (!unknown && expectedUnit != null) {
            amount(val, where + ".value");
            if (List.of("seats", "doors", "year", "sizeClass").contains(name) && !Js.isInteger(val)) throw fail(where + ".value");
            if (name.equals("sizeClass") && (val.doubleValue() < 1 || val.doubleValue() > 5)) throw fail("facts.sizeClass.value");
        }
        if (!unknown && (name.equals("frontIsofix") || name.equals("rearIsofix")) && !Js.isBool(val)) throw fail(where + ".value");
        return new Js.B().s("status", status).s("value", data(val, where + ".value")).s("unit", unit)
                .s("provenance", origin).build();
    }

    /** The validated VehicleSnapshot v1 in its normalised shape, or a RecommendationFault. */
    static ObjectNode snapshot(JsonNode input) {
        keys(input, List.of("contractVersion", "candidateKey", "sourceNamespace", "identityKind", "sourceKeys",
                "snapshotVersion", "observedAt", "vin", "display", "facts"), "VehicleSnapshot");
        JsonNode version = input.get("contractVersion");
        if (version != null && !Js.eqStr(version, "vehicle-snapshot-v1")) throw fail("contractVersion");
        text(input.get("sourceNamespace"), "sourceNamespace");
        text(input.get("snapshotVersion"), "snapshotVersion");
        date(input.get("observedAt"), "observedAt");
        JsonNode kind = input.get("identityKind");
        if (!Js.includes(KINDS, kind)) throw fail("identityKind");
        JsonNode sourceKeys = input.get("sourceKeys");
        keys(sourceKeys, List.of("advertId", "stockId", "modelGroupId", "recordId"), "sourceKeys");
        for (JsonNode value : sourceKeys) if (!Js.text(value) && !Js.safeInt(value)) throw fail("sourceKeys");
        String kindText = kind.textValue();
        JsonNode sourceKey = kindText.equals("vin") ? input.get("vin") : sourceKeys.get(KEY_OF.get(kindText));
        if (sourceKey == null) throw fail("sourceKeys candidate identity");
        String candidateKey = encode(input.get("sourceNamespace").textValue()) + ":" + kindText + ":" + encode(Js.toStr(sourceKey));
        JsonNode supplied = input.get("candidateKey");
        if (supplied != null && !Js.eqStr(supplied, candidateKey)) throw fail("candidateKey");
        JsonNode vin = input.get("vin");
        if (vin != null && (!vin.isTextual() || !VIN.matcher(vin.textValue()).matches())) throw fail("vin");
        JsonNode display = input.get("display");
        keys(display, List.of("name", "manufacturer", "model", "derivative", "photo", "images", "link", "colour"), "display");
        text(display.get("name"), "display.name");
        JsonNode facts = input.get("facts");
        object(facts, "facts");
        ObjectNode outFacts = Js.obj();
        for (Map.Entry<String, JsonNode> e : Js.entries(facts)) outFacts.set(e.getKey(), fact(e.getValue(), e.getKey()));
        return new Js.B().s("contractVersion", "vehicle-snapshot-v1").s("candidateKey", candidateKey)
                .s("sourceNamespace", input.get("sourceNamespace")).s("identityKind", kind)
                .s("sourceKeys", data(sourceKeys, "sourceKeys")).s("snapshotVersion", input.get("snapshotVersion"))
                .s("observedAt", input.get("observedAt")).s("vin", vin).s("display", data(display, "display"))
                .s("facts", outFacts).build();
    }

    /** encodeURIComponent: UTF-8 percent encoding keeping A-Z a-z 0-9 - _ . ! ~ * ' ( ); a lone surrogate throws. */
    static String encode(String s) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 128 && (Character.isLetterOrDigit(c) || "-_.!~*'()".indexOf(c) >= 0)) {
                out.append(c);
                continue;
            }
            int end = i + 1;
            if (Character.isHighSurrogate(c) && end < s.length() && Character.isLowSurrogate(s.charAt(end))) end++;
            else if (Character.isSurrogate(c)) throw new RecommendationFault("URI malformed");
            for (byte b : s.substring(i, end).getBytes(StandardCharsets.UTF_8)) out.append(String.format("%%%02X", b & 0xff));
            i = end - 1;
        }
        return out.toString();
    }

    /** createEmployeeTerms for the points quote: validates like Node and returns the normalised terms. */
    static ObjectNode employeeTerms(String termsVersion, JsonNode points, JsonNode allowance, String validFrom,
            String validUntil, JsonNode sourceRef, String version, String observedAt, String assurance) {
        amount(points, "points.value");
        amount(allowance, "allowanceInputs.value");
        if (!Instants.strictDate(Js.F.textNode(validFrom))) throw fail("validFrom");
        if (!Instants.strictDate(Js.F.textNode(validUntil))) throw fail("validUntil");
        if (Instants.parse(validUntil) <= Instants.parse(validFrom)) throw fail("terms validity");
        text(Js.F.textNode(termsVersion), "termsVersion");
        text(sourceRef, "provenance.sourceRef");
        text(Js.F.textNode(version), "provenance.version");
        if (!Instants.strictDate(Js.F.textNode(observedAt))) throw fail("provenance.observedAt");
        ObjectNode pointsOut = new Js.B().s("value", points).s("unit", "points").build();
        ObjectNode allowanceOut = new Js.B().s("allowance", new Js.B().s("value", allowance).s("unit", "points").build()).build();
        ObjectNode provenance = new Js.B().s("sourceRef", sourceRef).s("version", version).s("observedAt", observedAt)
                .s("assurance", assurance).build();
        return new Js.B().s("termsVersion", termsVersion).s("points", pointsOut).s("allowanceInputs", allowanceOut)
                .s("contribution", Js.F.nullNode()).s("validFrom", validFrom).s("validUntil", validUntil)
                .s("provenance", provenance).s("kind", "employee-scheme").build();
    }
}
