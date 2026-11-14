package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.evidence.CanonicalJson;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Port of validatePredictionInput (forecast/input.js), PredictionInput contract 1.0.0; empty means usable. */
public final class PredictionInputValidator {

    public static final String CONTRACT_VERSION = "1.0.0";

    /** One refusal: the field and what to supply, as in Node. */
    public record Reason(String field, String reason) {}

    private PredictionInputValidator() {}

    private static boolean text(JsonNode v) {
        return v != null && v.isTextual() && !v.textValue().isEmpty() && v.textValue().length() <= 512;
    }

    private static boolean instant(JsonNode v) {
        return v != null && v.isTextual() && Instants.valid(v.textValue());
    }

    private static boolean isArray(JsonNode v) {
        return v != null && v.isArray();
    }

    private static boolean object(JsonNode v) {
        return v != null && v.isObject();
    }

    private static boolean nullableNumber(JsonNode v) {
        return v != null && (v.isNull() || Js.finite(v) && v.doubleValue() >= 0);
    }

    private static boolean nullableText(JsonNode v) {
        return v != null && (v.isNull() || text(v));
    }

    private static boolean unique(List<JsonNode> values) {
        Set<JsonNode> seen = new HashSet<>();
        for (JsonNode v : values) if (!seen.add(v == null ? com.fasterxml.jackson.databind.node.MissingNode.getInstance() : v)) return false;
        return true;
    }

    public static List<Reason> validate(JsonNode input) {
        List<Reason> reasons = new ArrayList<>();
        try {
            CanonicalJson.canonical(input);
        } catch (RuntimeException e) {
            return List.of(new Reason("input", "Supply finite JSON data."));
        }
        if (!object(input) || !Js.isString(input.get("contractVersion"), CONTRACT_VERSION)) {
            return List.of(new Reason("contractVersion", "Supply a version 1.0.0 prediction input."));
        }
        if (!text(input.get("runId")) || !text(input.get("policyVersion")) || !instant(input.get("asOf"))) {
            reasons.add(new Reason("runId/asOf/policyVersion", "Supply a run, instant and policy version."));
        }
        JsonNode horizon = input.get("horizon");
        if (!instant(Js.get(horizon, "start")) || !instant(Js.get(horizon, "end"))) {
            reasons.add(new Reason("horizon", "Supply a start and end instant."));
        }
        JsonNode cohort = input.get("cohort");
        if (!text(Js.get(cohort, "version")) || !isArray(Js.get(cohort, "entitlements"))) {
            reasons.add(new Reason("cohort", "Supply a versioned cohort."));
        }
        if (!text(Js.get(input.get("terms"), "version"))) reasons.add(new Reason("terms", "Supply a terms version."));
        if (!reasons.isEmpty()) return reasons;
        List<JsonNode> rows = new ArrayList<>();
        cohort.get("entitlements").forEach(rows::add);
        boolean bad = false;
        for (JsonNode e : rows) bad |= badEntitlement(e);
        List<JsonNode> ids = new ArrayList<>();
        List<JsonNode> employees = new ArrayList<>();
        for (JsonNode e : rows) {
            ids.add(e.get("entitlementId"));
            employees.add(e.get("employeeId"));
        }
        if (bad || !unique(ids) || !unique(employees)) {
            reasons.add(new Reason("cohort.entitlements", "Each employee occurs once with valid permitted choices and brief."));
        }
        return reasons;
    }

    private static boolean badEntitlement(JsonNode e) {
        if (!object(e) || !text(e.get("entitlementId")) || !text(e.get("employeeId")) || !text(e.get("cohortKey"))
                || !instant(e.get("renewalAt"))) return true;
        if (e.has("requiredBy") && !instant(e.get("requiredBy"))) return true;
        JsonNode period = e.get("period");
        if (period == null || !period.isTextual() || !period.textValue().matches("\\d{4}-\\d{2}")) return true;
        JsonNode brief = e.get("brief");
        if (!object(brief) || !object(brief.get("preferences")) || !object(brief.get("essentials"))) return true;
        JsonNode choices = e.get("permittedChoices");
        if (choices == null || !choices.isArray()) return true;
        List<JsonNode> derivatives = new ArrayList<>();
        for (JsonNode c : choices) derivatives.add(Js.get(c, "derivativeId"));
        if (!unique(derivatives)) return true;
        for (JsonNode c : choices) {
            if (!object(c) || !text(c.get("derivativeId")) || !text(c.get("configurationId")) || !text(c.get("vehicleClass"))
                    || !text(c.get("termsVersion")) || !object(c.get("attributes"))) return true;
            JsonNode a = c.get("attributes");
            for (String k : List.of("seats", "boot", "monthlyPoints", "allowance")) if (!nullableNumber(a.get(k))) return true;
            for (String k : List.of("body", "fuel")) if (!nullableText(a.get(k))) return true;
        }
        return false;
    }
}
