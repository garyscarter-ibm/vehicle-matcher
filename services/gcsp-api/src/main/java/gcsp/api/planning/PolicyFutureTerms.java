package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.util.Iterator;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Port of createPolicyFutureTermsProvider (server/gcsp/predict/plan/terms.js): the canonical monthly points and
 * allowance for one employee and configuration, valid from the read to the horizon. Any non-ok read fails closed.
 * A plain class: not a bean and not wired anywhere.
 */
public final class PolicyFutureTerms {

    static final String NOT_CONFIGURED = "planning-future-terms-not-configured";
    static final String INPUT_INVALID = "planning-future-terms-input-invalid";
    static final String UNAVAILABLE = "planning-future-terms-unavailable";
    /** Same assurance label as the synthetic points and allowance rows it quotes. */
    static final String ASSURANCE = "synthetic-scenario";

    private static final Pattern STRICT_DATE =
            Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z");

    private final PolicyService policy;

    public PolicyFutureTerms(PolicyService policy) {
        this.policy = policy;
    }

    /**
     * request carries employee, brief, catalogVersion and configuration (as the Node request). Returns {status:'ok',
     * value} or the planner's unavailable outcome; it never throws.
     */
    public ObjectNode readFutureTerms(RunContext context, PlanningRead read, JsonNode request) {
        if (policy == null) {
            return Outcomes.unavailable(NOT_CONFIGURED);
        }
        JsonNode employee = Js.get(request, "employee");
        JsonNode brief = Js.get(request, "brief");
        JsonNode catalogVersion = Js.get(request, "catalogVersion");
        JsonNode configuration = Js.get(request, "configuration");
        JsonNode configurationId = Js.get(configuration, "configurationId");
        JsonNode facts = Js.get(configuration, "facts");
        if (!validRead(context, read) || !truthy(employee) || !truthy(brief) || !Js.text(catalogVersion)
                || !Js.text(configurationId) || !truthy(facts)) {
            return Outcomes.unavailable(INPUT_INVALID);
        }
        try {
            String runId = read.runId();
            PolicyContext employeeContext = new PolicyContext(context == null ? null : context.runId(),
                    string(employee, "companyId"), string(employee, "schemeId"), string(employee, "gradeId"));
            ObjectNode car = knownFacts(facts);
            car.put("configurationId", configurationId.textValue());
            PolicyRead pinned = new PolicyRead(runId, read.asOf(), read.policyVersion());
            PolicyResult points = policy.getPointsCost(employeeContext, car, pinned);
            PolicyResult allowance = policy.getAllowance(employeeContext, pinned);
            if (!"ok".equals(points.status()) || !"ok".equals(allowance.status())
                    || !read.policyVersion().equals(points.policyVersion())
                    || !read.policyVersion().equals(allowance.policyVersion())) {
                return Outcomes.unavailable(UNAVAILABLE);
            }
            JsonNode pointsValue = points.value();
            JsonNode allowanceValue = allowance.value();
            if (!Js.object(pointsValue) || !Js.object(allowanceValue)) {
                return Outcomes.unavailable(UNAVAILABLE);
            }
            String id = read.policyVersion() + ":" + configurationId.textValue();
            ObjectNode terms = employeeTerms("future-terms:" + id, pointsValue.get("monthlyPoints"),
                    allowanceValue.get("monthlyPoints"), read.asOf(), read.horizonEnd(),
                    "policy:" + template(pointsValue.get("pricePlanId")), read.policyVersion(), read.asOf());
            ObjectNode value = Outcomes.object();
            value.put("runId", runId);
            value.put("asOf", read.asOf());
            value.put("policyVersion", read.policyVersion());
            copy(value, "employeeId", Js.get(employee, "employeeId"));
            copy(value, "renewalId", Js.get(employee, "renewalId"));
            copy(value, "briefVersion", Js.get(brief, "briefVersion"));
            value.put("catalogVersion", catalogVersion.textValue());
            value.put("configurationId", configurationId.textValue());
            value.put("version", "future-terms:" + id);
            value.set("terms", terms);
            ObjectNode ok = Outcomes.object();
            ok.put("status", "ok");
            ok.set("value", value);
            return ok;
        } catch (RuntimeException e) {
            return Outcomes.unavailable(UNAVAILABLE);
        }
    }

    /** Node: read.runId === context.runId, a text policy version, valid asOf and horizonEnd instants. */
    private static boolean validRead(RunContext context, PlanningRead read) {
        if (read == null || read.context() == null
                || !Objects.equals(context == null ? null : context.runId(), read.runId())) {
            return false;
        }
        return text(read.policyVersion()) && JsTime.parse(read.asOf()) != null && JsTime.parse(read.horizonEnd()) != null;
    }

    private static boolean text(String value) {
        return value != null && value.length() > 0 && value.length() <= 512;
    }

    /** JS truthiness of a parsed JSON value; an absent property is undefined. */
    private static boolean truthy(JsonNode n) {
        if (n == null || n.isNull()) {
            return false;
        }
        if (n.isBoolean()) {
            return n.booleanValue();
        }
        if (n.isNumber()) {
            return n.doubleValue() != 0 && !Double.isNaN(n.doubleValue());
        }
        return !n.isTextual() || !n.textValue().isEmpty();
    }

    /** employee[key] when it is a string; any other value can never equal a policy identifier. */
    private static String string(JsonNode employee, String key) {
        JsonNode n = Js.get(employee, key);
        return n != null && n.isTextual() ? n.textValue() : null;
    }

    /** Only facts with status 'known' contribute their value; a null fact throws (as f.status does in Node). */
    private static ObjectNode knownFacts(JsonNode facts) {
        ObjectNode car = Outcomes.object();
        if (facts.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> it = facts.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                addKnown(car, e.getKey(), e.getValue());
            }
        } else if (facts.isArray()) {
            for (int i = 0; i < facts.size(); i++) {
                addKnown(car, Integer.toString(i), facts.get(i));
            }
        }
        return car;
    }

    private static void addKnown(ObjectNode car, String key, JsonNode fact) {
        if (fact == null || fact.isNull()) {
            throw new IllegalArgumentException("fact");
        }
        JsonNode status = Js.get(fact, "status");
        JsonNode value = Js.get(fact, "value");
        if (status != null && status.isTextual() && "known".equals(status.textValue()) && value != null) {
            car.set(key, value.deepCopy());
        }
    }

    private static void copy(ObjectNode target, String key, JsonNode value) {
        if (value != null) {
            target.set(key, value.deepCopy());
        }
    }

    /** A template literal of a JSON value; a missing property reads as undefined. */
    private static String template(JsonNode n) {
        if (n == null) {
            return "undefined";
        }
        return n.isNull() ? "null" : Js.coerce(n);
    }

    private static boolean amount(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.doubleValue()) && n.doubleValue() >= 0;
    }

    private static boolean strictDate(String value) {
        return value != null && STRICT_DATE.matcher(value).matches() && JsTime.parse(value) != null;
    }

    /** createEmployeeTerms for the future-terms quote: same checks, same key order, contribution null. */
    private static ObjectNode employeeTerms(String termsVersion, JsonNode points, JsonNode allowance, String validFrom,
            String validUntil, String sourceRef, String version, String observedAt) {
        if (!amount(points) || !amount(allowance) || !strictDate(validFrom) || !strictDate(validUntil)
                || JsTime.parse(validUntil) <= JsTime.parse(validFrom) || !strictDate(observedAt) || version.isBlank()) {
            throw new IllegalArgumentException("terms");
        }
        ObjectNode pointsOut = Outcomes.object();
        pointsOut.set("value", points.deepCopy());
        pointsOut.put("unit", "points");
        ObjectNode allowanceOut = Outcomes.object();
        allowanceOut.set("value", allowance.deepCopy());
        allowanceOut.put("unit", "points");
        ObjectNode inputs = Outcomes.object();
        inputs.set("allowance", allowanceOut);
        ObjectNode provenance = Outcomes.object();
        provenance.put("sourceRef", sourceRef);
        provenance.put("version", version);
        provenance.put("observedAt", observedAt);
        provenance.put("assurance", ASSURANCE);
        ObjectNode terms = Outcomes.object();
        terms.put("termsVersion", termsVersion);
        terms.set("points", pointsOut);
        terms.set("allowanceInputs", inputs);
        terms.putNull("contribution");
        terms.put("validFrom", validFrom);
        terms.put("validUntil", validUntil);
        terms.set("provenance", provenance);
        terms.put("kind", "employee-scheme");
        return terms;
    }
}
