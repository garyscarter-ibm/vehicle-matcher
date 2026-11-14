package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/** Port of model/features.js: the statistical feature versions and the per-alternative feature vector. */
public final class ChoiceFeatures {

    private static final List<String> VEHICLE = List.of("wait.intercept", "vehicle.ev", "vehicle.estate", "vehicle.seats/7",
            "vehicle.boot/700", "vehicle.points/allowance", "missing.seats", "missing.boot", "missing.points");
    private static final List<String> INTERACTIONS = List.of("preference.body.match", "preference.fuel.match",
            "importance.body.match", "importance.fuel.match", "essential.seats.capacity", "essential.boot.capacity");

    public static final Map<String, List<String>> FEATURE_SETS = Map.of(
            "vehicle-only-v1", VEHICLE,
            "vehicle-preference-v1", java.util.stream.Stream.concat(VEHICLE.stream(), INTERACTIONS.stream()).toList());

    private ChoiceFeatures() {}

    public static boolean known(String featureVersion) {
        return featureVersion != null && FEATURE_SETS.containsKey(featureVersion);
    }

    private static boolean validNumber(JsonNode x) {
        return Js.finite(x) && x.doubleValue() >= 0;
    }

    private static boolean confirmed(JsonNode entry) {
        return Js.isString(Js.get(entry, "valueState"), "confirmed") && Js.isString(Js.get(entry, "importanceState"), "confirmed");
    }

    /** Node featureVector: a wait alternative has only the intercept; attributes may be null for a wait. */
    public static double[] featureVector(JsonNode attributes, boolean isWait, JsonNode brief, String featureVersion) {
        ChoiceModelException.require(known(featureVersion), "featureVersion");
        List<String> names = FEATURE_SETS.get(featureVersion);
        double[] out = new double[names.size()];
        if (isWait) {
            for (int i = 0; i < out.length; i++) out[i] = "wait.intercept".equals(names.get(i)) ? 1 : 0;
            return out;
        }
        ChoiceModelException.require(attributes == null || attributes.isObject(), "attributes");
        JsonNode a = attributes;
        for (String key : List.of("seats", "boot", "monthlyPoints", "allowance")) {
            JsonNode v = Js.get(a, key);
            ChoiceModelException.require(v == null || v.isNull() || validNumber(v), "attributes." + key);
        }
        JsonNode prefsNode = Js.get(brief, "preferences");
        JsonNode preferences = prefsNode == null || prefsNode.isNull() ? null : prefsNode;
        JsonNode essNode = Js.get(brief, "essentials");
        JsonNode essentials = essNode == null || essNode.isNull() ? null : essNode;
        boolean hasPoints = validNumber(Js.get(a, "monthlyPoints")) && validNumber(Js.get(a, "allowance"))
                && Js.get(a, "allowance").doubleValue() > 0;
        JsonNode seats = Js.get(a, "seats");
        JsonNode boot = Js.get(a, "boot");
        boolean seatsMissing = seats == null || seats.isNull();
        boolean bootMissing = boot == null || boot.isNull();
        double bodyMatch = match("body", preferences, a);
        double fuelMatch = match("fuel", preferences, a);
        double[] values = new double[] {
            0,
            Js.isString(Js.get(a, "fuel"), "ev") ? 1 : 0,
            Js.isString(Js.get(a, "body"), "estate") ? 1 : 0,
            seatsMissing ? 0 : seats.doubleValue() / 7,
            bootMissing ? 0 : boot.doubleValue() / 700,
            hasPoints ? Js.get(a, "monthlyPoints").doubleValue() / Js.get(a, "allowance").doubleValue() : 0,
            seatsMissing ? 1 : 0,
            bootMissing ? 1 : 0,
            hasPoints ? 0 : 1,
            bodyMatch,
            fuelMatch,
            bodyMatch * Js.toNumber(orZero(Js.get(Js.get(preferences, "body"), "importance"))) / 100,
            fuelMatch * Js.toNumber(orZero(Js.get(Js.get(preferences, "fuel"), "importance"))) / 100,
            capacity("seats", 7, essentials, a),
            capacity("boot", 700, essentials, a),
        };
        for (int i = 0; i < out.length; i++) out[i] = values[i];
        return out;
    }

    private static JsonNode orZero(JsonNode node) {
        return node == null || node.isNull() ? com.fasterxml.jackson.databind.node.IntNode.valueOf(0) : node;
    }

    private static double match(String key, JsonNode preferences, JsonNode a) {
        JsonNode p = Js.get(preferences, key);
        if (!confirmed(p)) return 0;
        JsonNode value = Js.get(p, "value");
        boolean list = value != null && value.isArray();
        ChoiceModelException.require(!list || value.size() > 0, "preferences." + key);
        boolean allText = list ? allText(value) : Js.isText(value);
        JsonNode importance = Js.get(p, "importance");
        ChoiceModelException.require(allText && validNumber(importance) && importance.doubleValue() <= 100, "preferences." + key);
        JsonNode attribute = Js.get(a, key);
        if (!Js.isText(attribute)) return 0;
        if (!list) return attribute.textValue().equals(value.textValue()) ? 1 : 0;
        for (JsonNode chosen : value) if (chosen.textValue().equals(attribute.textValue())) return 1;
        return 0;
    }

    private static boolean allText(JsonNode array) {
        for (JsonNode item : array) if (!item.isTextual()) return false;
        return true;
    }

    private static double capacity(String key, double scale, JsonNode essentials, JsonNode a) {
        JsonNode e = Js.get(essentials, key);
        JsonNode attribute = Js.get(a, key);
        if (!Js.isString(Js.get(e, "state"), "confirmed") || attribute == null || attribute.isNull()) return 0;
        ChoiceModelException.require(Js.isString(Js.get(e, "operator"), "gte") && validNumber(Js.get(e, "value")), "essentials." + key);
        return (attribute.doubleValue() - Js.get(e, "value").doubleValue()) / scale;
    }
}
