package gcsp.api.learning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.planning.PlanningRead;
import gcsp.api.planning.PolicyFutureTerms;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;

/** Node forecast/input.js: permitted planning choices and saved briefs become a versioned model input. */
final class LearnedPredictionInput {
    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;

    private LearnedPredictionInput() {}

    static ObjectNode unavailable(String code) {
        return JSON.objectNode().put("status", "unavailable").put("code", code)
                .put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
    }

    static boolean ok(JsonNode value) {
        return value != null && "ok".equals(value.path("status").asText());
    }

    private static boolean text(JsonNode value) {
        return Js.isText(value) && !value.textValue().isEmpty() && value.textValue().length() <= 512;
    }

    private static List<JsonNode> sorted(JsonNode values) {
        List<JsonNode> rows = new ArrayList<>();
        values.forEach(rows::add);
        rows.sort(Comparator.comparing(JsonNode::textValue));
        return rows;
    }

    private static JsonNode find(JsonNode rows, String key, JsonNode id) {
        if (rows == null || !rows.isArray()) return null;
        for (JsonNode row : rows) if (id != null && id.equals(row.get(key))) return row;
        return null;
    }

    private static JsonNode known(JsonNode configuration, String key) {
        JsonNode fact = configuration.path("facts").path(key);
        return "known".equals(fact.path("status").asText()) && fact.hasNonNull("value")
                ? fact.get("value").deepCopy() : JSON.nullNode();
    }

    static ObjectNode create(JsonNode expressed, JsonNode catalog, PlanningRead read, PolicyService policy) {
        JsonNode contexts = expressed == null ? null : expressed.path("predictionContext").get("entitlements");
        if (contexts == null || !contexts.isArray() || !expressed.path("forecast").path("entitlements").isArray()
                || catalog == null || !catalog.path("derivatives").isArray() || !text(catalog.get("version"))
                || read == null || !Instants.valid(read.asOf()) || !Instants.valid(read.horizonEnd())) {
            return unavailable("prediction-input-sources-missing");
        }
        try {
            PolicyFutureTerms terms = new PolicyFutureTerms(policy);
            TreeSet<String> versions = new TreeSet<>();
            ArrayNode entitlements = JSON.arrayNode();
            for (JsonNode e : expressed.path("forecast").path("entitlements")) {
                JsonNode saved = find(contexts, "entitlementId", e.get("entitlementId"));
                if (saved == null) return unavailable("prediction-input-context-missing");
                ArrayNode choices = JSON.arrayNode();
                for (JsonNode id : sorted(e.get("acceptableDerivativeIds"))) {
                    JsonNode derivative = find(catalog.get("derivatives"), "derivativeId", id);
                    JsonNode configuration = find(catalog.get("configurations"), "configurationId",
                            derivative == null ? null : derivative.path("configurationIds").path(0));
                    if (configuration == null) return unavailable("prediction-input-catalog-mismatch");
                    ObjectNode request = JSON.objectNode();
                    request.set("employee", saved.get("employee"));
                    request.set("brief", saved.get("brief"));
                    request.set("catalogVersion", catalog.get("version"));
                    request.set("configuration", configuration);
                    request.set("renewalAt", e.get("renewalAt"));
                    ObjectNode provided = terms.readFutureTerms(read.context(), read, request);
                    if (!ok(provided)) return unavailable("prediction-input-terms-unavailable");
                    JsonNode value = provided.path("value");
                    JsonNode version = value.get("version");
                    JsonNode points = value.at("/terms/points/value");
                    JsonNode allowance = value.at("/terms/allowanceInputs/allowance/value");
                    if (!text(version) || !Js.finite(points) || !Js.finite(allowance)) {
                        return unavailable("prediction-input-terms-invalid");
                    }
                    versions.add(version.textValue());
                    ObjectNode choice = choices.addObject();
                    choice.set("derivativeId", id.deepCopy());
                    choice.set("configurationId", configuration.get("configurationId").deepCopy());
                    JsonNode body = known(configuration, "body");
                    choice.set("vehicleClass", body.isNull() ? JSON.textNode("unknown") : body.deepCopy());
                    ObjectNode attributes = choice.putObject("attributes");
                    for (String key : List.of("body", "fuel", "seats", "boot")) attributes.set(key, known(configuration, key));
                    attributes.set("monthlyPoints", points.deepCopy());
                    attributes.set("allowance", allowance.deepCopy());
                    choice.set("termsVersion", version.deepCopy());
                }
                ObjectNode entitlement = entitlements.addObject();
                for (String key : List.of("entitlementId", "employeeId", "renewalAt", "requiredBy")) {
                    if (e.has(key)) entitlement.set(key, e.get(key).deepCopy());
                }
                entitlement.set("cohortKey", saved.path("employee").get("gradeId"));
                JsonNode requiredBy = e.get("requiredBy");
                String periodInstant = requiredBy != null && !requiredBy.isNull()
                        ? requiredBy.textValue() : e.path("renewalAt").textValue();
                entitlement.put("period", Instant.ofEpochMilli(Instants.parse(periodInstant)).atOffset(ZoneOffset.UTC)
                        .toLocalDate().toString().substring(0, 7));
                ObjectNode brief = entitlement.putObject("brief");
                for (String key : List.of("preferences", "essentials")) {
                    JsonNode entry = saved.path("brief").get(key);
                    brief.set(key, entry == null || entry.isNull() ? JSON.objectNode() : entry.deepCopy());
                }
                entitlement.set("permittedChoices", choices);
            }
            ObjectNode input = JSON.objectNode().put("contractVersion", PredictionInputValidator.CONTRACT_VERSION)
                    .put("runId", read.runId()).put("asOf", read.asOf()).put("policyVersion", read.policyVersion());
            input.putObject("horizon").put("start", read.asOf()).put("end", read.horizonEnd());
            input.putObject("cohort").set("version", expressed.get("cohortVersion"));
            ((ObjectNode) input.get("cohort")).set("entitlements", entitlements);
            ArrayNode termVersions = JSON.arrayNode();
            versions.forEach(termVersions::add);
            input.putObject("terms").put("version", CanonicalJson.digest(termVersions));
            if (!PredictionInputValidator.validate(input).isEmpty()) return unavailable("prediction-input-invalid");
            ObjectNode result = JSON.objectNode().put("status", "ok")
                    .put("contractVersion", PredictionInputValidator.CONTRACT_VERSION);
            result.set("value", input);
            return result;
        } catch (RuntimeException e) {
            return unavailable("prediction-input-unavailable");
        }
    }
}
