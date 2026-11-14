package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Port of the Node policy order-plan catalogue: the one canonical entry orderPlan.catalog.v1. */
public final class PlanningCatalog {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern CURRENCY = Pattern.compile("[A-Z]{3}");

    private final PolicyService policy;

    public PlanningCatalog(PolicyService policy) {
        this.policy = policy;
    }

    private static ObjectNode fail(String status, String code) {
        ObjectNode n = F.objectNode();
        n.put("status", status);
        n.put("code", code);
        n.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        return n;
    }

    private static boolean scalar(JsonNode v) {
        return v != null && (v.isTextual() || v.isBoolean() || v.isNumber() && Double.isFinite(v.doubleValue()));
    }

    private static boolean compactFact(JsonNode f) {
        if (!Js.object(f)) {
            return false;
        }
        JsonNode value = f.get("value");
        JsonNode unit = f.get("unit");
        boolean valueOk = value != null && (value.isNull() || scalar(value)
                || value.isArray() && Js.items(value).stream().allMatch(PlanningCatalog::scalar));
        boolean unitOk = unit != null && (unit.isNull() || Js.text(unit));
        return valueOk && unitOk && (value == null || !value.isNumber() || Js.text(unit));
    }

    private static boolean valid(JsonNode entry, int solverDerivatives) {
        JsonNode v = entry.get("value");
        if (!Js.object(v) || !Js.text(v.get("version")) || !CURRENCY.matcher(Js.coerce(v.get("currency"))).matches()
                || !Js.text(v.get("assurance")) || JsTime.parse(entry.path("effectiveFrom").isTextual()
                        ? entry.get("effectiveFrom").textValue() : null) == null
                || !Js.array(v.get("derivatives")) || v.get("derivatives").size() == 0
                || v.get("derivatives").size() > solverDerivatives
                || !Js.array(v.get("configurations")) || v.get("configurations").size() == 0
                || v.get("configurations").size() > 256) {
            return false;
        }
        List<JsonNode> derivatives = Js.items(v.get("derivatives"));
        List<JsonNode> configurations = Js.items(v.get("configurations"));
        if (!Js.unique(derivatives.stream().map(d -> Js.get(d, "derivativeId")).toList())
                || !Js.unique(configurations.stream().map(c -> Js.get(c, "configurationId")).toList())) {
            return false;
        }
        for (JsonNode d : derivatives) {
            if (!Js.object(d) || !Js.text(d.get("derivativeId")) || !Js.text(d.get("modelId")) || !Js.integer(d.get("unitCostMinor"))
                    || !Js.text(Js.get(d.get("production"), "model")) || !Js.text(Js.get(d.get("production"), "derivative"))
                    || !Js.array(d.get("configurationIds")) || d.get("configurationIds").size() == 0
                    || !Js.everyText(d.get("configurationIds")) || !Js.unique(Js.items(d.get("configurationIds")))) {
                return false;
            }
            for (JsonNode id : d.get("configurationIds")) {
                boolean found = configurations.stream().anyMatch(c -> Js.object(c) && id.equals(c.get("configurationId"))
                        && d.get("derivativeId").equals(c.get("derivativeId")));
                if (!found) {
                    return false;
                }
            }
        }
        for (JsonNode c : configurations) {
            if (!Js.object(c) || !Js.text(c.get("configurationId")) || !Js.text(c.get("version"))
                    || !Js.text(Js.get(c.get("display"), "name"))
                    || derivatives.stream().noneMatch(d -> d.get("derivativeId").equals(c.get("derivativeId"))
                            && Js.items(d.get("configurationIds")).contains(c.get("configurationId")))
                    || !Js.object(c.get("facts")) || c.get("facts").size() == 0) {
                return false;
            }
            Iterator<JsonNode> facts = c.get("facts").elements();
            while (facts.hasNext()) {
                if (!compactFact(facts.next())) {
                    return false;
                }
            }
        }
        return true;
    }

    /** The catalogue for one run and read, equal to Node createPolicyOrderPlanCatalog().readCatalog. */
    public ObjectNode readCatalog(String runId, PolicyRead read) {
        if (policy == null || runId == null || runId.isEmpty() || runId.length() > 512 || read == null
                || !runId.equals(read.runId()) || read.policyVersion() == null || read.policyVersion().isEmpty()
                || read.policyVersion().length() > 512 || JsTime.parse(read.asOf()) == null) {
            return fail("unavailable", "planning-catalog-not-configured");
        }
        PolicyResult row;
        try {
            row = policy.getAssumption(PlanningPolicy.CATALOG_KEY, read);
        } catch (RuntimeException e) {
            return fail("unavailable", "planning-catalog-unavailable");
        }
        JsonNode entry = row.ok() ? row.value() : null;
        if (entry == null || entry.get("key") == null || !PlanningPolicy.CATALOG_KEY.equals(entry.get("key").textValue())) {
            return fail("unavailable", "planning-catalog-unavailable");
        }
        JsonNode entryVersion = entry.get("policyVersion");
        if (!read.policyVersion().equals(row.policyVersion()) || entryVersion == null
                || !read.policyVersion().equals(entryVersion.textValue())) {
            return fail("unavailable", "planning-catalog-policy-mismatch");
        }
        if (!valid(entry, (int) OrderPlanSolver.MAX_DERIVATIVES) || JsTime.parse(entry.get("effectiveFrom").textValue())
                > JsTime.parse(read.asOf())) {
            return fail("invalid", "planning-catalog-invalid");
        }
        JsonNode catalog = entry.get("value");
        String effectiveFrom = entry.get("effectiveFrom").textValue();
        ObjectNode out = F.objectNode();
        out.put("status", "ok");
        out.put("contractVersion", OrderPlanSolver.CONTRACT_VERSION);
        ObjectNode value = out.putObject("value");
        value.put("runId", runId);
        value.put("asOf", read.asOf());
        value.put("policyVersion", read.policyVersion());
        value.put("version", read.policyVersion() + ":" + catalog.get("version").textValue());
        value.set("currency", catalog.get("currency"));
        ArrayNode derivatives = value.putArray("derivatives");
        for (JsonNode d : catalog.get("derivatives")) {
            ObjectNode o = derivatives.addObject();
            o.set("derivativeId", d.get("derivativeId"));
            o.set("modelId", d.get("modelId"));
            o.set("unitCostMinor", d.get("unitCostMinor"));
            o.set("production", d.get("production").deepCopy());
            o.set("configurationIds", d.get("configurationIds").deepCopy());
        }
        ArrayNode configurations = value.putArray("configurations");
        for (JsonNode c : catalog.get("configurations")) {
            ObjectNode o = configurations.addObject();
            o.set("configurationId", c.get("configurationId"));
            o.set("derivativeId", c.get("derivativeId"));
            o.set("version", c.get("version"));
            o.set("display", c.get("display").deepCopy());
            ObjectNode facts = o.putObject("facts");
            Iterator<Map.Entry<String, JsonNode>> it = c.get("facts").fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> f = it.next();
                boolean unknown = f.getValue().get("value").isNull();
                ObjectNode fact = facts.putObject(f.getKey());
                fact.put("status", unknown ? "unknown" : "known");
                fact.set("value", f.getValue().get("value").deepCopy());
                fact.set("unit", f.getValue().get("unit").deepCopy());
                ObjectNode provenance = fact.putObject("provenance");
                provenance.put("sourceRef", "policy:" + PlanningPolicy.CATALOG_KEY);
                provenance.set("version", c.get("version"));
                provenance.put("observedAt", effectiveFrom);
                provenance.put("assurance", unknown ? "unknown" : catalog.get("assurance").textValue());
            }
        }
        return out;
    }
}
