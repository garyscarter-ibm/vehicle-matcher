package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** projectCurrentCarBaseline of server/gcsp/recommendation/current-car.js: the frozen baseline of the stored current contract. */
final class CurrentCarBaseline {

    private static final List<String> STRINGS = List.of("configuration", "body", "fuel", "modelLine", "eligibilityModelKey");
    private static final List<String> NUMBERS = List.of("seats", "boot", "mpg", "zeroTo62", "points", "sizeClass");
    private static final List<String> MODES = List.of("synthetic", "dated-snapshot", "authorised-live");

    private CurrentCarBaseline() {}

    private static boolean validSource(JsonNode s, String now) {
        if (s == null || !s.isObject() || !Js.includes(MODES, s.get("mode"))) return false;
        for (String key : List.of("sourceRef", "sourceVersion", "schemaVersion")) if (!CurrentCar.text(s.get(key))) return false;
        for (String key : List.of("effectiveFrom", "observedAt")) {
            if (!Js.validInstant(s.get(key)) || !(Instants.parse(s.get(key)) <= Instants.parse(now))) return false;
        }
        return true;
    }

    /** The baseline, or null when anything is missing or ambiguous (the provider then sends no currentCar). */
    static ObjectNode project(JsonNode accountSource, JsonNode contracts, JsonNode contractId, RecommendationContext context,
            String now) {
        if (!CurrentCar.text(contractId) || now == null || !Js.validInstant(Js.F.textNode(now)) || contracts == null
                || !contracts.isArray() || !validSource(accountSource, now)) return null;
        JsonNode contract = null;
        int matches = 0;
        for (JsonNode row : contracts) {
            if (row != null && row.isObject() && Js.strictEq(row.get("contractId"), contractId)) {
                contract = row;
                matches++;
            }
        }
        if (matches != 1 || !Js.eqStr(contract.get("employeeId"), context.employeeId())
                || !Js.eqStr(contract.get("schemeId"), context.schemeId()) || !Js.eqStr(contract.get("status"), "current")
                || context.entitlementSlotId() != null && !Js.eqStr(contract.get("slotId"), context.entitlementSlotId())
                || !validSource(contract.get("source"), now)) return null;
        JsonNode source = contract.get("source");
        JsonNode vehicle = contract.get("vehicle");
        ObjectNode provenance = new Js.B().s("sourceRef", source.get("sourceRef")).s("version", source.get("sourceVersion"))
                .s("observedAt", source.get("observedAt"))
                .s("assurance", Js.eqStr(source.get("mode"), "synthetic") ? "synthetic-scenario" : "derived").build();
        ObjectNode facts = Js.obj();
        if (vehicle != null && vehicle.isObject()) {
            for (String key : STRINGS) if (CurrentCar.text(vehicle.get(key))) put(facts, key, vehicle.get(key), null, provenance);
            if (CurrentCar.canonicalConfiguration(vehicle.get("configurationId")) != null) {
                put(facts, "configurationId", vehicle.get("configurationId"), null, provenance);
            }
            for (String key : NUMBERS) {
                JsonNode n = vehicle.get(key);
                if (Js.finite(n) && n.doubleValue() > 0) put(facts, key, n, key.equals("points") ? "points-per-month" : unit(key), provenance);
            }
            JsonNode tags = vehicle.get("tags");
            if (tags != null && tags.isArray() && tags.size() > 0 && allText(tags)) put(facts, "tags", tags, null, provenance);
        }
        ObjectNode out = Js.obj();
        out.set("contractId", contractId);
        out.set("source", new Js.B().s("mode", source.get("mode")).s("sourceVersion", source.get("sourceVersion"))
                .s("observedAt", source.get("observedAt")).build());
        out.set("facts", facts);
        return out;
    }

    private static String unit(String key) {
        return switch (key) {
            case "seats" -> "count";
            case "boot" -> "L";
            case "mpg" -> "mpg-imperial";
            case "zeroTo62" -> "s";
            default -> "ordinal-1-5";
        };
    }

    private static boolean allText(JsonNode list) {
        for (JsonNode n : list) if (!CurrentCar.text(n)) return false;
        return true;
    }

    private static void put(ObjectNode facts, String key, JsonNode value, String unit, ObjectNode provenance) {
        facts.set(key, new Js.B().s("status", "known").s("value", value.deepCopy())
                .s("unit", unit == null ? Js.F.nullNode() : Js.F.textNode(unit)).s("provenance", provenance.deepCopy()).build());
    }
}
