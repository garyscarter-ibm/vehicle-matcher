package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.learning.LearnedPlanView;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.PolicySource;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Greg's read and preview from Node createOrderPlanOperations; disposable policy drafts save and order nothing. */
public final class OrderPlanOperations {

    static final String PREVIEW_MESSAGE = "Preview only. Nothing is saved, published or ordered.";
    private static final Map<String, String> BOUNDS = Map.of("orderPlan.modelBounds", "modelId", "orderPlan.derivativeBounds",
            "derivativeId");

    private final PolicyService policy;
    private final PlanningDemand demand;
    private final PlanningSupply supply;
    private final PlanningClock clock;
    private final SubmissionHistory history;
    private final LearnedPlanView learned;

    public OrderPlanOperations(PolicyService policy, PlanningDemand demand, PlanningSupply supply, PlanningClock clock,
            SubmissionHistory history) {
        this(policy, demand, supply, clock, history, null);
    }

    public OrderPlanOperations(PolicyService policy, PlanningDemand demand, PlanningSupply supply, PlanningClock clock,
            SubmissionHistory history, LearnedPlanView learned) {
        this.policy = policy;
        this.demand = demand;
        this.supply = supply;
        this.clock = clock;
        this.history = history;
        this.learned = learned;
    }

    /** What every operation starts from: the trusted run, the instant, the planning rules and Greg's editable keys. */
    private record Base(RunContext context, String now, PolicyRead read, JsonNode rules, List<String> editable) {
    }

    private record Started(Base base, ObjectNode failure) {
    }

    private Started start(Principal principal) {
        if (!OrderPlanService.greg(principal)) {
            return new Started(null, Outcomes.forbidden());
        }
        RunContext context = new RunContext(principal.environmentId(), principal.runId(), principal.subject());
        String now = PolicyClock.iso(clock.observe(context).now());
        PolicyRead read = new PolicyRead(principal.runId(), now, principal.policyVersion());
        PlanningPolicy rules = new PlanningPolicy(policy);
        ObjectNode ruleOutcome = rules.readRules(read);
        if (!Outcomes.isOk(ruleOutcome)) {
            return new Started(null, ruleOutcome);
        }
        List<String> editable = rules.editableKeys(read);
        if (editable == null) {
            return new Started(null, Outcomes.operationsUnavailable("editable-keys-unavailable"));
        }
        return new Started(new Base(context, now, read, ruleOutcome.get("value"), editable), null);
    }

    private static boolean isPlan(JsonNode plan) {
        JsonNode status = plan.get("status");
        return Js.text(plan.get("planId")) && status != null
                && ("feasible".equals(status.textValue()) || "infeasible".equals(status.textValue()));
    }

    private ObjectNode plan(Principal principal, PolicyService under, String policyVersion, PlanningSupply source) {
        return new OrderPlanService(under, demand, source, clock).readPlan(principal, policyVersion);
    }

    /** The current plan from current inputs, with its replan state, presentation and learned advice. */
    public ObjectNode readPlan(Principal principal) {
        try {
            Started started = start(principal);
            if (started.failure() != null) {
                return started.failure();
            }
            Base base = started.base();
            ObjectNode plan = plan(principal, policy, principal.policyVersion(), supply);
            if (!isPlan(plan)) {
                return plan;
            }
            JsonNode replan = history.replan(base.context(), plan);
            ObjectNode presentation = presentation(base);
            if (!Outcomes.isOk(presentation)) {
                return presentation;
            }
            ObjectNode value = Outcomes.object();
            value.put("mode", "current");
            value.put("preview", false);
            value.set("plan", plan);
            value.set("replan", replan);
            value.set("presentation", presentation.get("value"));
            value.set("learned", learnedFor(principal, base, plan, null));
            return finish(principal, value);
        } catch (RuntimeException e) {
            return Outcomes.operationsUnavailable("order-plan-operations-unavailable");
        }
    }

    /**
     * Re-reads the plan from current inputs and compares it with a pinned planId and versions (Node submitPlan's
     * replan-needed check). Read-only, so a submitting caller (FUCQ-478) can call it again inside its own transaction.
     */
    public ObjectNode recheck(Principal principal, String planId, JsonNode versions, JsonNode changes) {
        try {
            if (planId == null || planId.isEmpty() || planId.length() > 512 || versions == null || !versions.isObject()) {
                return Outcomes.invalid("invalid-request", "input", "Supply planId and versions.", null);
            }
            Started started = start(principal);
            if (started.failure() != null) {
                return started.failure();
            }
            ObjectNode current;
            if (changes == null || changes.isNull()) {
                current = plan(principal, policy, principal.policyVersion(), supply);
            } else {
                Checked checked = checkChanges(started.base(), changes);
                if (checked.failure() != null) {
                    return checked.failure();
                }
                current = draftPlan(principal, started.base(), checked.changes());
            }
            if (!isPlan(current)) {
                return current;
            }
            JsonNode now = current.get("versions");
            java.util.TreeSet<String> keys = new java.util.TreeSet<>();
            versions.fieldNames().forEachRemaining(keys::add);
            now.fieldNames().forEachRemaining(keys::add);
            ArrayNode changed = Outcomes.object().arrayNode();
            for (String k : keys) {
                if (!java.util.Objects.equals(versions.get(k), now.get(k))) {
                    changed.add(k);
                }
            }
            if (!planId.equals(current.get("planId").textValue())) {
                changed.add("plan");
            }
            if (!changed.isEmpty()) {
                ObjectNode refused = Outcomes.conflict("replan-needed");
                refused.put("reason", "Inputs changed since the preview. Replan before submitting.");
                refused.set("changedInputs", changed);
                ObjectNode head = refused.putObject("current");
                head.put("planId", current.get("planId").textValue());
                head.set("versions", now);
                return refused;
            }
            return finish(principal, current);
        } catch (RuntimeException e) {
            return Outcomes.operationsUnavailable("order-plan-operations-unavailable");
        }
    }

    /** The same plan under Greg's edited constraints, beside the active plan. Writes nothing. */
    public ObjectNode previewPlan(Principal principal, JsonNode input) {
        try {
            if (!only(input, List.of("changes"))) {
                return Outcomes.invalid("invalid-request", "input", "Supply changes only.", null);
            }
            Started started = start(principal);
            if (started.failure() != null) {
                return started.failure();
            }
            Base base = started.base();
            Checked changes = checkChanges(base, input.get("changes"));
            if (changes.failure() != null) {
                return changes.failure();
            }
            ObjectNode activePlan = plan(principal, policy, principal.policyVersion(), supply);
            if (!isPlan(activePlan)) {
                return activePlan;
            }
            ObjectNode plan = draftPlan(principal, base, changes.changes());
            if (!isPlan(plan)) {
                return plan;
            }
            ObjectNode presentation = presentation(base);
            if (!Outcomes.isOk(presentation)) {
                return presentation;
            }
            ObjectNode value = Outcomes.object();
            value.put("mode", "preview");
            value.put("preview", true);
            value.put("writes", "none");
            value.put("message", PREVIEW_MESSAGE);
            value.put("activePolicyVersion", base.read().policyVersion());
            value.set("draftPolicyVersion", plan.get("versions").get("policy"));
            value.set("changes", changes.changes());
            value.set("plan", plan);
            value.set("activePlan", activePlan);
            value.set("presentation", presentation.get("value"));
            value.set("learned", learnedFor(principal, base, plan, changes.changes()));
            return finish(principal, value);
        } catch (RuntimeException e) {
            return Outcomes.operationsUnavailable("order-plan-operations-unavailable");
        }
    }

    private ObjectNode finish(Principal principal, ObjectNode value) {
        return OrderPlanService.greg(principal) ? Outcomes.ok(value) : Outcomes.forbidden();
    }

    private ObjectNode learnedFor(Principal principal, Base base, JsonNode baseline, ArrayNode changes) {
        if (learned == null) return LearnedPlanView.unavailable("learned-forecast-not-configured");
        try {
            return changes == null
                    ? learned.read(principal, policy, base.read().policyVersion(), demand, supply, clock, baseline)
                    : draftPlan(principal, base, changes, baseline);
        } catch (RuntimeException e) {
            return LearnedPlanView.unavailable("learned-plan-unavailable");
        }
    }

    private static boolean only(JsonNode value, List<String> keys) {
        if (!Js.object(value)) {
            return false;
        }
        for (var it = value.fieldNames(); it.hasNext();) {
            if (!keys.contains(it.next())) {
                return false;
            }
        }
        return true;
    }

    private record Checked(ArrayNode changes, ObjectNode failure) {
    }

    private static Checked refuse(ObjectNode failure) {
        return new Checked(null, failure);
    }

    /** Validates Greg's edits against the policy-marked editable keys and the active id sets (Node checkChanges). */
    private Checked checkChanges(Base base, JsonNode changes) {
        ObjectNode shape = Outcomes.invalid("invalid-changes", "changes", "Supply each editable key once with its new value.", null);
        if (!Js.array(changes) || changes.isEmpty() || changes.size() > base.editable().size()) {
            return refuse(shape);
        }
        List<String> keys = new ArrayList<>();
        for (JsonNode c : changes) {
            if (!only(c, List.of("key", "value")) || !Js.text(c.get("key")) || !c.has("value")) {
                return refuse(shape);
            }
            keys.add(c.get("key").textValue());
        }
        if (keys.stream().distinct().count() != keys.size()) {
            return refuse(shape);
        }
        List<String> refused = keys.stream().filter(k -> !base.editable().contains(k)).toList();
        if (!refused.isEmpty()) {
            ObjectNode extra = Outcomes.object();
            ArrayNode list = extra.putArray("keys");
            refused.forEach(list::add);
            return refuse(Outcomes.invalid("policy-key-not-editable", "changes", "Greg cannot edit: " + String.join(", ", refused) + ".",
                    extra));
        }
        List<ObjectNode> out = new ArrayList<>();
        for (JsonNode c : changes) {
            String key = c.get("key").textValue();
            JsonNode value = c.get("value");
            if ("orderPlan.budgetMinor".equals(key)) {
                if (!Js.integer(value)) {
                    return refuse(Outcomes.invalid("invalid-change-value", key,
                            "Use a nonnegative whole number of currency minor units.", null));
                }
                out.add(change(key, JsNum.node(value.doubleValue())));
                continue;
            }
            String id = BOUNDS.get(key);
            if (id == null) {
                ObjectNode extra = Outcomes.object();
                extra.putArray("keys").add(key);
                return refuse(Outcomes.invalid("policy-key-unsupported", key, "This key has no editor yet.", extra));
            }
            JsonNode active = base.rules().get("orderPlan.modelBounds".equals(key) ? "modelBounds" : "derivativeBounds");
            ArrayNode bounds = bounds(value, active, id);
            if (bounds == null) {
                return refuse(Outcomes.invalid("invalid-change-value", key,
                        "Give every " + id + " a whole-number minimum not above its maximum.", null));
            }
            out.add(change(key, bounds));
        }
        out.sort(Comparator.comparing(n -> n.get("key").textValue()));
        ArrayNode sorted = Outcomes.array();
        out.forEach(sorted::add);
        return new Checked(sorted, null);
    }

    private static ObjectNode change(String key, JsonNode value) {
        ObjectNode n = Outcomes.object();
        n.put("key", key);
        n.set("value", value.deepCopy());
        return n;
    }

    /** The bounds sorted by id and reduced to {id, min, max}, or null when they do not cover the active ids exactly. */
    private static ArrayNode bounds(JsonNode value, JsonNode active, String id) {
        if (!Js.array(value) || value.size() != active.size()) {
            return null;
        }
        List<String> seen = new ArrayList<>();
        List<ObjectNode> rows = new ArrayList<>();
        for (JsonNode b : value) {
            if (!only(b, List.of(id, "min", "max")) || !Js.text(b.get(id)) || !Js.integer(b.get("min")) || !Js.integer(b.get("max"))
                    || b.get("min").doubleValue() > b.get("max").doubleValue()) {
                return null;
            }
            seen.add(b.get(id).textValue());
            ObjectNode row = Outcomes.object();
            row.set(id, b.get(id).deepCopy());
            row.set("min", JsNum.node(b.get("min").doubleValue()));
            row.set("max", JsNum.node(b.get("max").doubleValue()));
            rows.add(row);
        }
        if (seen.stream().distinct().count() != seen.size()) {
            return null;
        }
        for (JsonNode a : active) {
            if (!seen.contains(a.get(id).textValue())) {
                return null;
            }
        }
        rows.sort(Comparator.comparing(n -> n.get(id).textValue()));
        ArrayNode out = Outcomes.array();
        rows.forEach(out::add);
        return out;
    }

    /** The plan under a disposable draft of the active policy. Nothing is written anywhere. */
    private ObjectNode draftPlan(Principal principal, Base base, ArrayNode changes) {
        return draftPlan(principal, base, changes, null);
    }

    private ObjectNode draftPlan(Principal principal, Base base, ArrayNode changes, JsonNode baseline) {
        PolicyResult snapshot = policy.getPolicySnapshot(new PolicyRead(principal.runId(), base.now(), base.read().policyVersion()));
        if (!snapshot.ok()) {
            return baseline == null ? snapshot.body()
                    : LearnedPlanView.unavailable(snapshot.body().path("code").asText("learned-plan-unavailable"));
        }
        ObjectNode draft = ((ObjectNode) snapshot.value()).deepCopy();
        ObjectNode digest = Outcomes.object();
        digest.put("activeVersion", base.read().policyVersion());
        digest.set("changes", changes);
        String version = "preview-" + PlanDigest.of(digest).substring(0, 24);
        draft.put("policyVersion", version);
        for (String table : List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions")) {
            for (JsonNode row : draft.get(table)) {
                ((ObjectNode) row).put("policyVersion", version);
            }
        }
        for (JsonNode c : changes) {
            ObjectNode row = null;
            for (JsonNode a : draft.get("assumptions")) {
                if (a.get("key").textValue().equals(c.get("key").textValue())) {
                    row = (ObjectNode) a;
                    break;
                }
            }
            row.set("value", c.get("value").deepCopy());
            row.put("source", "greg-order-plan-constraints");
            row.put("sourceDate", base.now().substring(0, 10));
            row.put("status", "assumed");
            row.put("basis", "Greg edited this order-plan constraint.");
        }
        List<JsonNode> retained = List.of(draft);
        PolicySource source = runId -> retained;
        PolicyService draftPolicy = new PolicyService(source);
        String active = base.read().policyVersion();
        // Supply reads the active policy; only its catalogue version prefix is rewritten to the draft's.
        PlanningSupply draftSupply = (read, under) -> {
            PlanningRead activeRead = new PlanningRead(read.context(), read.asOf(), active, read.horizonEnd());
            ObjectNode out = supply.readSupply(activeRead, policy);
            if (!Outcomes.isOk(out)) {
                return out;
            }
            JsonNode catalog = out.get("value").path("versions").get("catalog");
            if (!Js.text(catalog) || !catalog.textValue().startsWith(active + ":")) {
                return Outcomes.unavailable("planning-supply-catalog-version-invalid");
            }
            ObjectNode copy = out.deepCopy();
            ((ObjectNode) copy.get("value").get("versions")).put("catalog", version + ":" + catalog.textValue().substring(active.length() + 1));
            return copy;
        };
        return baseline == null ? plan(principal, draftPolicy, version, draftSupply)
                : learned.read(principal, draftPolicy, version, demand, draftSupply, clock, baseline);
    }

    /** Display names and editor keys for the panel, from the policy catalogue. */
    private ObjectNode presentation(Base base) {
        ObjectNode catalog = new PlanningCatalog(policy).readCatalog(base.read().runId(), base.read());
        if (!Outcomes.isOk(catalog)) {
            return Outcomes.operationsUnavailable("order-plan-operations-unavailable");
        }
        JsonNode value = catalog.get("value");
        Map<String, String> models = new LinkedHashMap<>();
        ObjectNode out = Outcomes.object();
        out.put("forecastBasis", "expressed-saved-demand");
        ArrayNode keys = out.putArray("editableKeys");
        base.editable().forEach(keys::add);
        out.set("currency", value.get("currency"));
        ArrayNode derivatives = out.putArray("derivatives");
        for (JsonNode d : value.get("derivatives")) {
            String modelId = d.get("modelId").textValue();
            models.putIfAbsent(modelId, d.get("production").get("model").textValue());
            ObjectNode row = derivatives.addObject();
            row.set("derivativeId", d.get("derivativeId"));
            row.put("modelId", modelId);
            row.set("model", d.get("production").get("model"));
            row.set("derivative", d.get("production").get("derivative"));
        }
        ArrayNode list = out.putArray("models");
        models.forEach((id, model) -> list.addObject().put("modelId", id).put("model", model));
        return Outcomes.ok(out);
    }
}
