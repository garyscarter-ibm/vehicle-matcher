package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.array;
import static gcsp.api.comparison.ComparisonValidation.eq;
import static gcsp.api.comparison.ComparisonValidation.field;
import static gcsp.api.comparison.ComparisonValidation.jsText;
import static gcsp.api.comparison.ComparisonValidation.object;
import static gcsp.api.comparison.ComparisonValidation.require;
import static gcsp.api.comparison.ComparisonValidation.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.Supplier;

/** The pinned policy snapshot a generation reads: assumption rows, allowances and the configuration set. */
public record ComparisonPolicy(String policyVersion, Map<String, JsonNode> assumptions, List<JsonNode> allowances,
        List<JsonNode> configurations, ObjectNode configurationSource) {

    public static final String GENERATOR_VERSION = "comparison-inputs.sha256.v1";
    public static final List<String> COMPARISON_KEYS = List.of(
            "comparison.cohortSize", "comparison.seeds", "comparison.startsAt", "comparison.horizonDays",
            "comparison.gradeDistribution", "comparison.pointsAllowanceMultiplier", "comparison.renewalDays",
            "comparison.needs.v1", "comparison.importanceDistribution", "comparison.briefNoise.v1",
            "comparison.accessGroups", "comparison.buddyUptake", "comparison.carsPerEmployee",
            "comparison.modelLineMix", "comparison.releaseCadence", "comparison.configurationSet.v1",
            "comparison.maximumGeneratedRows");
    static final List<String> EXTRA_KEYS = List.of("stock.configuration.modelCodeField",
            "stock.configuration.codeSeparator", "stock.configuration.includePaintAndUpholstery",
            "stock.configuration.encoding", "hold.buddy.durationSeconds", "employee.recommendation.v1",
            "brief.slider.minimum", "brief.slider.maximum");
    private static final String SET_KEY = "comparison.configurationSet.v1";

    /** The assumption values by key, the shape every validator and the generator read. */
    Map<String, JsonNode> values() {
        Map<String, JsonNode> values = new LinkedHashMap<>();
        assumptions.forEach((key, row) -> {
            if (row.get("value") != null) values.put(key, row.get("value"));
        });
        return values;
    }

    /** Resolves every policy read once; a failed or incoherent read is a ComparisonInputError. */
    public static ComparisonPolicy load(PolicyService service, PolicyRead read) {
        require(service != null && read != null, "PolicyService", "policy-unavailable");
        PolicyResult active = call("policyVersion", () -> service.getActiveVersion(read));
        JsonNode activeValue = active.ok() ? active.value() : null;
        String version = active.policyVersion();
        require(active.ok() && version != null && jsText(version) && eq(field(activeValue, "policyVersion"), version)
                && (read.policyVersion() == null || read.policyVersion().equals(version)),
                "policyVersion", "policy-unavailable");
        PolicyRead pinned = new PolicyRead(read.runId(), read.asOf(), version);
        Map<String, JsonNode> assumptions = new LinkedHashMap<>();
        List<String> keys = new ArrayList<>(COMPARISON_KEYS);
        keys.addAll(EXTRA_KEYS);
        for (String key : keys) {
            PolicyResult result = call(key, () -> service.getAssumption(key, pinned));
            require(result.ok() && version.equals(result.policyVersion())
                    && eq(field(result.value(), "policyVersion"), version), key, "policy-unavailable");
            assumptions.put(key, result.value().deepCopy());
        }
        ComparisonPolicy draft = new ComparisonPolicy(version, assumptions, List.of(), List.of(), null);
        Map<String, JsonNode> values = draft.values();
        ComparisonValidation.validateValues(values);
        List<JsonNode> allowances = new ArrayList<>();
        for (JsonNode grade : values.get("comparison.gradeDistribution")) {
            PolicyContext context = new PolicyContext(pinned.runId(), grade.get("companyId").textValue(),
                    grade.get("schemeId").textValue(), grade.get("gradeId").textValue());
            PolicyResult result = call("comparison.gradeDistribution", () -> service.getAllowance(context, pinned));
            require(result.ok() && version.equals(result.policyVersion())
                    && eq(field(result.value(), "policyVersion"), version),
                    "comparison.gradeDistribution", "allowance-unavailable");
            allowances.add(result.value().deepCopy());
        }
        JsonNode set = values.get(SET_KEY);
        boolean referencesOk = object(set) && (eq(set.get("kind"), "reviewed-fixtures") || eq(set.get("kind"), "corpus"))
                && array(set.get("configurations"));
        if (referencesOk) {
            for (JsonNode reference : set.get("configurations")) {
                referencesOk &= object(reference) && text(reference.get("configurationId"))
                        && text(reference.get("snapshotVersion")) && text(reference.get("modelLine"));
            }
        }
        require(referencesOk, SET_KEY);
        // The corpus port is not wired in Java: an honest unavailable, never a substitute.
        require(!eq(set.get("kind"), "corpus") || set.get("configurations").size() == 0, SET_KEY,
                "configuration-unavailable");
        List<JsonNode> configurations = new ArrayList<>();
        set.get("configurations").forEach(reference -> configurations.add(reference.deepCopy()));
        ObjectNode source = JsonNodeFactory.instance.objectNode();
        for (String name : List.of("kind", "datasetId", "version")) copy(set, name, source);
        if (eq(set.get("kind"), "corpus")) copy(set, "manifestDigest", source);
        copy(set, "basis", source);
        copy(set, "reviewedOn", source);
        source.put("configurationCount", configurations.size());
        TreeSet<String> lines = new TreeSet<>();
        configurations.forEach(row -> lines.add(row.get("modelLine").textValue()));
        var modelLines = source.putArray("modelLines");
        lines.forEach(modelLines::add);
        ComparisonPolicy policy = new ComparisonPolicy(version, Collections.unmodifiableMap(assumptions),
                Collections.unmodifiableList(allowances), Collections.unmodifiableList(configurations), source);
        ComparisonValidation.validatePolicy(policy, values);
        return policy;
    }

    private static void copy(JsonNode from, String name, ObjectNode to) {
        if (from.get(name) != null) to.set(name, from.get(name).deepCopy());
    }

    /** Any failure of the policy service is policy-unavailable for the key being read. */
    private static PolicyResult call(String key, Supplier<PolicyResult> read) {
        PolicyResult result;
        try {
            result = read.get();
        } catch (RuntimeException e) {
            throw new ComparisonInputError("policy-unavailable", key);
        }
        require(result != null, key, "policy-unavailable");
        return result;
    }
}
