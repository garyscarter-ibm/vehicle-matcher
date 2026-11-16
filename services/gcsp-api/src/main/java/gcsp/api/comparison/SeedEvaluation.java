package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Port of evaluateComparisonSeed: every employee against every car group once per seed, stated and underlying briefs. */
final class SeedEvaluation {

    /** One decision reduced to what the routes read; components are kept for the underlying brief only. */
    record Fit(String gateStatus, Double score, List<Component> components) {

        boolean passes(double threshold) {
            return "eligible".equals(gateStatus) && score != null && Double.isFinite(score) && score >= threshold;
        }
    }

    record Component(String field, JsonNode score, JsonNode importance, List<String> facts) {}

    record GroupFit(Fit stated, Fit underlying) {}

    final String inputHash;
    final double threshold;
    final List<ReplayStock.Row> rows;
    final ReplayStock.Groups groups;
    final GroupEvaluator evaluator;
    final JsonNode adapterRow;
    private final Map<String, Map<String, GroupFit>> employees = new HashMap<>();

    private SeedEvaluation(String inputHash, double threshold, List<ReplayStock.Row> rows, ReplayStock.Groups groups,
            GroupEvaluator evaluator, JsonNode adapterRow) {
        this.inputHash = inputHash;
        this.threshold = threshold;
        this.rows = rows;
        this.groups = groups;
        this.evaluator = evaluator;
        this.adapterRow = adapterRow;
    }

    GroupFit fit(String employeeId, String orderUuid) {
        Map<String, GroupFit> fits = employees.get(employeeId);
        String groupId = groups.groupOf().get(orderUuid);
        if (fits == null || groupId == null) throw refuse("invalid-input", "evaluation-member");
        return fits.get(groupId);
    }

    /** The underlying brief alone decides acceptance. */
    boolean acceptable(String employeeId, String orderUuid) {
        return fit(employeeId, orderUuid).underlying().passes(threshold);
    }

    /** Cars the employee would claim from the listing: stated gates and fit, best first, then orderUuid. */
    List<String> statedCandidates(String employeeId) {
        Map<String, GroupFit> fits = employees.get(employeeId);
        if (fits == null) throw refuse("invalid-input", "evaluation-member");
        record Entry(String orderUuid, double score) {}
        List<Entry> found = new ArrayList<>();
        for (ReplayStock.Group group : groups.list()) {
            GroupFit fit = fits.get(group.groupId());
            if (fit == null || !fit.stated().passes(threshold)) continue;
            for (String orderUuid : group.orderUuids()) found.add(new Entry(orderUuid, fit.stated().score()));
        }
        found.sort(Comparator.comparingDouble(Entry::score).reversed().thenComparing(Entry::orderUuid));
        List<String> out = new ArrayList<>(found.size());
        found.forEach(entry -> out.add(entry.orderUuid()));
        return out;
    }

    static SeedEvaluation evaluate(ComparisonInputs inputs, PolicyService policy) {
        ObjectNode manifest = inputs.manifest();
        String inputHash = manifest.get("inputHash").textValue();
        PolicyRead read = new PolicyRead("comparison-evaluation-" + inputHash.substring(0, 24),
                manifest.get("startsAt").textValue(), manifest.get("policyVersion").textValue());
        JsonNode adapterRow = ComparisonExperiments.assumption(policy, "comparison.recordAdapter.v1", read);
        JsonNode thresholdRow = ComparisonExperiments.assumption(policy, "comparison.acceptableFitThreshold", read);
        JsonNode value = thresholdRow.get("value");
        if (value == null || !value.isNumber() || !Double.isFinite(value.doubleValue()) || value.doubleValue() < 0
                || value.doubleValue() > 100) {
            throw refuse("invalid-input", "comparison.acceptableFitThreshold");
        }
        List<ReplayStock.Row> rows = ReplayStock.rows(inputs, adapterRow);
        ReplayStock.Groups groups = ReplayStock.groups(rows);
        GroupEvaluator evaluator = new GroupEvaluator(inputs, policy, adapterRow, groups, rows, () -> manifest.get("startsAt").textValue());
        SeedEvaluation result = new SeedEvaluation(inputHash, value.doubleValue(), rows, groups, evaluator, adapterRow);
        for (JsonNode employee : inputs.employees()) {
            if (Thread.interrupted()) throw new ComparisonInterrupted();
            Map<String, Fit[]> fits = new LinkedHashMap<>();
            String[] routes = {"stated", "underlying"};
            for (int r = 0; r < 2; r++) {
                JsonNode brief = r == 0 ? employee.get("statedBrief") : underlyingBrief(employee);
                ObjectNode outcome = evaluator.evaluate(employee, brief);
                String status = ReplayRecords.text(outcome.get("status"));
                if (!"ok".equals(status)) {
                    String code = ReplayRecords.text(outcome.get("code"));
                    throw refuse(status, "evaluation:" + routes[r] + ":" + (code != null ? code : status));
                }
                for (JsonNode decision : outcome.get("value").get("decisions")) {
                    String groupId = result.groups.groupOf().get(decision.get("orderUuid").textValue());
                    fits.computeIfAbsent(groupId, k -> new Fit[2])[r] = fit(decision, r == 1);
                }
            }
            Map<String, GroupFit> perGroup = new LinkedHashMap<>();
            fits.forEach((groupId, pair) -> perGroup.put(groupId, new GroupFit(pair[0], pair[1])));
            result.employees.put(employee.get("employeeId").textValue(), perGroup);
        }
        return result;
    }

    private static Fit fit(JsonNode decision, boolean withComponents) {
        JsonNode score = decision.get("score");
        List<Component> components = new ArrayList<>();
        if (withComponents) {
            for (JsonNode c : decision.get("components")) {
                List<String> names = new ArrayList<>();
                JsonNode facts = c.get("facts");
                if (facts != null && facts.isObject()) facts.fieldNames().forEachRemaining(names::add);
                names.sort(null);
                JsonNode importance = c.get("effectiveImportance") != null && !c.get("effectiveImportance").isNull()
                        ? c.get("effectiveImportance") : c.get("importance");
                components.add(new Component(ReplayRecords.text(c.get("field")), c.get("score"), importance, names));
            }
        }
        return new Fit(decision.get("gateStatus").textValue(),
                score == null || !score.isNumber() ? null : score.doubleValue(), components);
    }

    // The latent needs use the same brief schema as the stated brief, so both pass through one evaluator.
    private static ObjectNode underlyingBrief(JsonNode employee) {
        ObjectNode brief = JSON.objectNode();
        brief.put("schemaVersion", 1);
        brief.put("briefVersion", 1);
        brief.set("requiredBy", employee.get("renewalAt"));
        brief.set("essentials", ReplayRecords.underlyingEssentials(employee));
        ObjectNode preferences = brief.putObject("preferences");
        employee.get("underlyingNeeds").get("preferences").fields().forEachRemaining(e -> {
            ObjectNode preference = ((ObjectNode) e.getValue()).deepCopy();
            preference.put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "synthetic-underlying-needs");
            preferences.set(e.getKey(), preference);
        });
        return brief;
    }
}
