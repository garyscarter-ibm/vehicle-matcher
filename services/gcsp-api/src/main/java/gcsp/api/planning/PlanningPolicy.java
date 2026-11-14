package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.List;

/**
 * Port of the Node planning policy and catalogue readers. Every value is read from the canonical policy
 * through PolicyService, with no runtime default. Outcomes are the same JSON as Node.
 */
public final class PlanningPolicy {

    public static final List<String> KEYS = List.of("orderPlan.horizonDays", "orderPlan.budgetMinor", "orderPlan.currency",
            "orderPlan.modelBounds", "orderPlan.derivativeBounds", "orderPlan.objectiveWeights", "supply.leadTimeDays");
    public static final String EDITABLE_KEY = "orderPlan.gregEditableKeys";
    public static final String CATALOG_KEY = "orderPlan.catalog.v1";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final PolicyService policy;

    public PlanningPolicy(PolicyService policy) {
        this.policy = policy;
    }

    private static ObjectNode fail(String status, String code) {
        ObjectNode n = F.objectNode();
        n.put("status", status);
        n.put("code", code);
        n.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        return n;
    }

    /** The planning rules for one read, equal to Node readPlanningPolicy. */
    public ObjectNode readRules(PolicyRead read) {
        if (policy == null || read == null || read.policyVersion() == null || read.policyVersion().isEmpty()) {
            return fail("unavailable", "planning-policy-not-configured");
        }
        List<PolicyResult> rows = new ArrayList<>();
        try {
            for (String key : KEYS) {
                rows.add(policy.getAssumption(key, read));
            }
        } catch (RuntimeException e) {
            return fail("unavailable", "planning-policy-unavailable");
        }
        List<String> failures = new ArrayList<>();
        for (int i = 0; i < KEYS.size(); i++) {
            PolicyResult r = rows.get(i);
            JsonNode value = r.ok() ? r.value() : null;
            JsonNode key = value == null ? null : value.get("key");
            if (!r.ok() || !read.policyVersion().equals(r.policyVersion()) || key == null || !KEYS.get(i).equals(key.textValue())) {
                failures.add(KEYS.get(i));
            }
        }
        if (!failures.isEmpty()) {
            ObjectNode out = fail("unavailable", "planning-policy-incomplete");
            ArrayNode keys = out.putArray("keys");
            failures.forEach(keys::add);
            return out;
        }
        ArrayNode provenance = F.arrayNode();
        ObjectNode values = F.objectNode();
        for (PolicyResult r : rows) {
            JsonNode row = r.value().deepCopy();
            provenance.add(row);
            values.set(row.get("key").textValue(), row.get("value"));
        }
        if (!Js.integer(values.get("supply.leadTimeDays"))) {
            return fail("invalid", "planning-lead-time-invalid");
        }
        ObjectNode out = F.objectNode();
        out.put("status", "ok");
        out.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        out.put("policyVersion", read.policyVersion());
        ObjectNode value = out.putObject("value");
        value.set("horizonDays", values.get("orderPlan.horizonDays"));
        value.set("budgetMinor", values.get("orderPlan.budgetMinor"));
        value.set("currency", values.get("orderPlan.currency"));
        value.set("modelBounds", values.get("orderPlan.modelBounds"));
        value.set("derivativeBounds", values.get("orderPlan.derivativeBounds"));
        value.set("objectiveWeights", values.get("orderPlan.objectiveWeights"));
        value.set("leadTimeDays", values.get("supply.leadTimeDays"));
        value.set("provenance", provenance);
        return out;
    }

    /** The keys Greg may edit, or null when the policy does not supply a list of text keys. */
    public List<String> editableKeys(PolicyRead read) {
        PolicyResult r = policy.getAssumption(EDITABLE_KEY, read);
        JsonNode value = r.ok() ? r.value().get("value") : null;
        if (!Js.array(value) || !Js.everyText(value)) {
            return null;
        }
        List<String> out = new ArrayList<>();
        value.forEach(n -> out.add(n.textValue()));
        return out;
    }
}
