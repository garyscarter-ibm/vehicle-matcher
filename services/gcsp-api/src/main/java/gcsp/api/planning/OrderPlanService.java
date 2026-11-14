package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.util.List;

/**
 * Greg's plan from current demand, supply and policy: a port of Node createOrderPlanService.readPlan. Inputs are
 * loaded twice and a changed digest or clock is a conflict, so a plan never mixes two states. Read-only.
 */
public final class OrderPlanService {

    private final PolicyService policy;
    private final PlanningDemand demand;
    private final PlanningSupply supply;
    private final PlanningClock clock;
    private final OrderPlanSolver solver = new OrderPlanSolver();

    public OrderPlanService(PolicyService policy, PlanningDemand demand, PlanningSupply supply, PlanningClock clock) {
        this.policy = policy;
        this.demand = demand;
        this.supply = supply;
        this.clock = clock;
    }

    static boolean greg(Principal principal) {
        return principal != null && principal.roles().contains(Role.GREG.wire());
    }

    /** The plan result (the planner's own outcome plus provenance), or a typed failure. */
    public ObjectNode readPlan(Principal principal, String policyVersion) {
        if (!greg(principal)) {
            return Outcomes.forbidden();
        }
        RunContext context = new RunContext(principal.environmentId(), principal.runId(), principal.subject());
        try {
            PlanningClock.Observation time = clock.observe(context);
            String asOf = PolicyClock.iso(time.now());
            String clockVersion = time.version();
            PolicyRead pin = new PolicyRead(principal.runId(), asOf, policyVersion);
            ObjectNode rules = new PlanningPolicy(policy).readRules(pin);
            if (!Outcomes.isOk(rules)) {
                return rules;
            }
            JsonNode ruleValue = rules.get("value");
            Long horizon = horizon(asOf, ruleValue.get("horizonDays"));
            if (horizon == null) {
                return Outcomes.unavailable("planning-horizon-invalid");
            }
            PlanningRead read = new PlanningRead(context, asOf, policyVersion, JsTime.iso(horizon));
            ArrayNode first = load(read);
            ObjectNode failure = failure(first);
            if (failure != null) {
                return failure;
            }
            JsonNode forecast = first.get(0).get("value");
            JsonNode availability = first.get(1).get("value");
            JsonNode choices = first.get(2).get("value");
            if (!coherent(read, forecast, availability, choices, ruleValue)) {
                return Outcomes.unavailable("planning-producer-version-mismatch");
            }
            ObjectNode resolved = resolve(read, rules, forecast, availability, choices, clockVersion);
            ObjectNode plan = solver.plan(resolved);
            ArrayNode second = load(read);
            failure = failure(second);
            if (failure != null) {
                return failure;
            }
            if (!PlanDigest.of(first).equals(PlanDigest.of(second)) || !time.version().equals(clock.observe(context).version())) {
                return Outcomes.conflict("planning-inputs-changed");
            }
            if (!greg(principal)) {
                return Outcomes.forbidden();
            }
            plan.set("policyProvenance", ruleValue.get("provenance").deepCopy());
            ObjectNode activity = plan.putObject("supplyActivity");
            activity.set("requests", orEmpty(availability.get("requests")));
            activity.set("responses", orEmpty(availability.get("responses")));
            JsonNode unbound = availability.get("unboundStock");
            if (unbound == null || unbound.isNull()) {
                ObjectNode none = plan.putObject("unboundStock");
                none.put("count", 0);
                none.putArray("models");
            } else {
                plan.set("unboundStock", unbound.deepCopy());
            }
            return plan;
        } catch (RuntimeException e) {
            return Outcomes.unavailable("planning-source-unavailable");
        }
    }

    private static JsonNode orEmpty(JsonNode node) {
        return node == null || node.isNull() ? Outcomes.array() : node.deepCopy();
    }

    private ArrayNode load(PlanningRead read) {
        ArrayNode out = Outcomes.array();
        out.add(demand.readForecast(read, policy));
        out.add(supply.readSupply(read, policy));
        out.add(catalogOf(read));
        return out;
    }

    private ObjectNode catalogOf(PlanningRead read) {
        return new PlanningCatalog(policy).readCatalog(read.runId(), new PolicyRead(read.runId(), read.asOf(), read.policyVersion()));
    }

    private static ObjectNode failure(ArrayNode results) {
        for (JsonNode r : results) {
            if (!Outcomes.isOk(r)) {
                return r instanceof ObjectNode o ? o : Outcomes.unavailable("planning-source-unavailable");
            }
        }
        return null;
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isTextual() ? v.textValue() : null;
    }

    private static JsonNode require(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || !v.isObject()) {
            throw new IllegalStateException(field);
        }
        return v;
    }

    private static boolean coherent(PlanningRead read, JsonNode forecast, JsonNode availability, JsonNode choices, JsonNode rules) {
        String catalogVersion = text(require(availability, "versions"), "catalog");
        return read.runId().equals(text(forecast, "runId")) && read.runId().equals(text(availability, "runId"))
                && read.runId().equals(text(choices, "runId"))
                && read.asOf().equals(text(forecast, "asOf")) && read.asOf().equals(text(availability, "asOf"))
                && read.asOf().equals(text(choices, "asOf"))
                && read.policyVersion().equals(text(forecast, "policyVersion"))
                && read.policyVersion().equals(text(choices, "policyVersion"))
                && catalogVersion != null && catalogVersion.equals(text(choices, "version"))
                && choices.get("currency") != null && choices.get("currency").equals(rules.get("currency"));
    }

    private static Long horizon(String asOf, JsonNode days) {
        double d = number(days);
        double ms = JsTime.parse(asOf) + d * JsTime.DAY;
        if (Double.isNaN(ms) || Math.abs(ms) > JsTime.MAX_TIME) {
            return null;
        }
        return (long) ms;
    }

    /** JavaScript's unary Number() of a policy value. */
    private static double number(JsonNode n) {
        if (n == null || n.isNull()) {
            return 0;
        }
        if (n.isNumber()) {
            return n.doubleValue();
        }
        if (n.isBoolean()) {
            return n.booleanValue() ? 1 : 0;
        }
        if (n.isTextual()) {
            String s = n.textValue().trim();
            try {
                return s.isEmpty() ? 0 : Double.parseDouble(s);
            } catch (NumberFormatException e) {
                return Double.NaN;
            }
        }
        return Double.NaN;
    }

    private static boolean truthy(JsonNode n) {
        return n != null && !n.isNull() && !(n.isTextual() && n.textValue().isEmpty())
                && !(n.isNumber() && (n.doubleValue() == 0 || Double.isNaN(n.doubleValue()))) && !(n.isBoolean() && !n.booleanValue());
    }

    private static boolean contains(JsonNode array, JsonNode value) {
        for (JsonNode n : array) {
            if (n.equals(value)) {
                return true;
            }
        }
        return false;
    }

    private static void put(ObjectNode target, String field, JsonNode value) {
        if (value != null) {
            target.set(field, value.deepCopy());
        }
    }

    private ObjectNode resolve(PlanningRead read, ObjectNode rules, JsonNode forecast, JsonNode availability, JsonNode choices,
            String clockVersion) {
        JsonNode ruleValue = rules.get("value");
        JsonNode entitled = forecast.get("forecast").get("entitlements");
        ArrayNode stock = Outcomes.array();
        for (JsonNode s : availability.get("stock")) {
            JsonNode vis = s.get("visibility");
            boolean exact = vis != null && vis.isObject() && vis.get("companyIds") != null && vis.get("companyIds").isArray()
                    && vis.get("schemeIds") != null && vis.get("schemeIds").isArray()
                    && (vis.get("employeeIds") == null ? false : vis.get("employeeIds").isNull() || vis.get("employeeIds").isArray());
            if (!exact) {
                throw new IllegalStateException("Exact stock visibility must be resolved from the trusted cohort.");
            }
            for (JsonNode e : entitled) {
                if (!truthy(e.get("companyId")) || !truthy(e.get("schemeId"))) {
                    throw new IllegalStateException("Exact stock visibility must be resolved from the trusted cohort.");
                }
            }
            ObjectNode row = stock.addObject();
            put(row, "stockId", s.get("stockId"));
            put(row, "derivativeId", s.get("derivativeId"));
            put(row, "availableAt", s.get("availableAt"));
            JsonNode slot = s.get("heldForEntitlementSlotId");
            if (slot != null && slot.isNull()) {
                row.putNull("heldForEntitlementId");
            } else {
                String held = null;
                for (JsonNode e : entitled) {
                    JsonNode id = e.get("entitlementId");
                    if (slot != null && slot.equals(e.get("entitlementSlotId")) && id != null && !id.isNull()) {
                        held = Js.coerce(id);
                        break;
                    }
                }
                row.put("heldForEntitlementId", held != null ? held : "outside-cohort:" + (slot == null ? "undefined" : Js.coerce(slot)));
            }
            ArrayNode permitted = row.putArray("permittedEntitlementIds");
            JsonNode employees = vis.get("employeeIds");
            for (JsonNode e : entitled) {
                if (contains(vis.get("companyIds"), e.get("companyId")) && contains(vis.get("schemeIds"), e.get("schemeId"))
                        && (employees.isNull() || contains(employees, e.get("employeeId")))) {
                    permitted.add(e.get("entitlementId"));
                }
            }
        }
        ObjectNode resolved = Outcomes.object();
        resolved.put("runId", read.runId());
        resolved.put("asOf", read.asOf());
        ObjectNode versions = resolved.putObject("versions");
        put(versions, "forecast", forecast.get("version"));
        put(versions, "cohort", forecast.get("cohortVersion"));
        put(versions, "policy", rules.get("policyVersion"));
        put(versions, "stock", availability.get("versions").get("stock"));
        put(versions, "supply", availability.get("versions").get("supply"));
        put(versions, "catalog", choices.get("version"));
        if (clockVersion != null) {
            versions.put("clock", clockVersion);
        }
        put(resolved, "forecast", forecast.get("forecast"));
        ArrayNode catalog = resolved.putArray("catalog");
        for (JsonNode d : choices.get("derivatives")) {
            ObjectNode row = catalog.addObject();
            put(row, "derivativeId", d.get("derivativeId"));
            put(row, "modelId", d.get("modelId"));
            put(row, "unitCostMinor", d.get("unitCostMinor"));
            put(row, "leadTimeDays", ruleValue.get("leadTimeDays"));
        }
        ObjectNode constraints = resolved.putObject("constraints");
        for (String key : List.of("horizonDays", "budgetMinor", "currency", "modelBounds", "derivativeBounds", "objectiveWeights")) {
            put(constraints, key, ruleValue.get(key));
        }
        resolved.set("stock", stock);
        put(resolved, "inbound", availability.get("inbound"));
        return resolved;
    }
}
