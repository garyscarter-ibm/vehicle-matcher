package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Port of Node resolveInput: validates the raw input, then returns it sorted into canonical order. */
final class PlanInput {

    static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Pattern CURRENCY = Pattern.compile("[A-Z]{3}");
    private static final List<String> WEIGHTS = List.of("coverage", "unallocatedStock", "costMinor");

    /** Exactly one of reasons and plan is set. */
    record Resolved(List<ObjectNode> reasons, Plan plan) {
    }

    private PlanInput() {
    }

    static ObjectNode reason(String field, String reason) {
        ObjectNode n = F.objectNode();
        n.put("field", field);
        n.put("reason", reason);
        return n;
    }

    private static Resolved refuse(List<ObjectNode> reasons) {
        return new Resolved(reasons, null);
    }

    private static Long inst(JsonNode n) {
        return n != null && n.isTextual() ? JsTime.parse(n.textValue()) : null;
    }

    private static boolean instant(JsonNode n) {
        return inst(n) != null;
    }

    private static boolean isText(JsonNode n, String field) {
        return Js.text(Js.get(n, field));
    }

    private static boolean stringsUnique(List<JsonNode> values) {
        return Js.unique(values);
    }

    static Resolved resolve(JsonNode input) {
        if (!Js.jsonData(input)) {
            return refuse(List.of(reason("input", "Supply finite JSON data.")));
        }
        if (!Js.object(input)) {
            return refuse(List.of(reason("input", "Supply an input object.")));
        }
        List<ObjectNode> reasons = new ArrayList<>();
        Long asOfMs = inst(input.get("asOf"));
        if (!Js.text(input.get("runId")) || asOfMs == null) {
            reasons.add(reason("runId/asOf", "Supply a run and ISO planning instant."));
        }
        JsonNode versions = input.get("versions");
        if (!Js.object(versions) || List.of("forecast", "policy", "stock", "supply", "cohort", "catalog").stream()
                .anyMatch(k -> !isText(versions, k))) {
            reasons.add(reason("versions", "Pin forecast, policy, stock, supply, cohort and catalog."));
        }
        JsonNode forecast = input.get("forecast");
        if (!Js.object(forecast) || !isText(forecast, "basis") || !instant(forecast.get("horizonEnd"))
                || !Js.array(forecast.get("entitlements")) || !Js.array(forecast.get("limitations"))
                || !Js.everyText(forecast.get("limitations"))) {
            reasons.add(reason("forecast", "Supply a versioned joint entitlement forecast, horizon and limitations."));
        }
        JsonNode catalog = input.get("catalog");
        double asOfParsed = input.get("asOf") != null && input.get("asOf").isTextual()
                ? JsTime.lenient(input.get("asOf").textValue()) : Double.NaN;
        if (!Js.array(catalog) || catalog.size() == 0 || Js.items(catalog).stream().anyMatch(d -> !Js.object(d)
                || !isText(d, "derivativeId") || !isText(d, "modelId") || !Js.integer(d.get("unitCostMinor"))
                || !Js.integer(d.get("leadTimeDays")) || !(Math.abs(asOfParsed + d.get("leadTimeDays").doubleValue()
                        * JsTime.DAY) <= JsTime.MAX_TIME))
                || !stringsUnique(Js.items(catalog).stream().map(d -> Js.get(d, "derivativeId")).toList())) {
            reasons.add(reason("catalog", "Supply unique derivatives, model, integer cost and finite resolved lead time."));
        }
        JsonNode policy = input.get("constraints");
        JsonNode weights = Js.get(policy, "objectiveWeights");
        if (!Js.object(policy) || !Js.integer(policy.get("horizonDays")) || !Js.integer(policy.get("budgetMinor"))
                || !CURRENCY.matcher(Js.coerce(policy.get("currency"))).matches()
                || !Js.object(weights) || WEIGHTS.stream().anyMatch(k -> !Js.integer(weights.get(k)))
                || WEIGHTS.stream().noneMatch(k -> weights.get(k).doubleValue() > 0)) {
            reasons.add(reason("constraints", "Supply explicit horizon, budget, currency and nonnegative integer objective weights."));
        }
        if (!reasons.isEmpty()) {
            return refuse(reasons);
        }
        double horizonMs = inst(forecast.get("horizonEnd"));
        if (horizonMs != asOfMs + policy.get("horizonDays").doubleValue() * JsTime.DAY) {
            reasons.add(reason("forecast.horizonEnd", "Forecast and policy horizon must agree exactly."));
        }
        Set<String> derivatives = new HashSet<>();
        Set<String> models = new HashSet<>();
        for (JsonNode d : catalog) {
            derivatives.add(d.get("derivativeId").textValue());
            models.add(d.get("modelId").textValue());
        }
        boundsCheck(policy, "derivativeBounds", "derivativeId", derivatives, reasons);
        boundsCheck(policy, "modelBounds", "modelId", models, reasons);
        JsonNode entitlements = forecast.get("entitlements");
        long horizon = (long) horizonMs;
        if (!entitlementsValid(entitlements, derivatives, horizon)) {
            reasons.add(reason("forecast.entitlements",
                    "Each employee occurs once, with unique entitlement/slot, exact renewal date and joint permitted choices."));
        }
        stockInboundCheck(input, derivatives, asOfMs, reasons);
        if (!reasons.isEmpty()) {
            return refuse(reasons);
        }
        return sorted(input, asOfMs, horizon, reasons);
    }

    private static void boundsCheck(JsonNode policy, String field, String id, Set<String> required, List<ObjectNode> reasons) {
        JsonNode rows = policy.get(field);
        if (!Js.array(rows) || rows.size() != required.size() || Js.items(rows).stream().anyMatch(b -> !Js.object(b)
                || !(b.get(id) != null && b.get(id).isTextual() && required.contains(b.get(id).textValue()))
                || !Js.integer(b.get("min")) || !Js.integer(b.get("max")))
                || !stringsUnique(Js.items(rows).stream().map(b -> Js.get(b, id)).toList())) {
            reasons.add(reason("constraints." + field, "Supply one explicit integer minimum and maximum for every catalog identity."));
        }
    }

    private static boolean entitlementsValid(JsonNode entitlements, Set<String> derivatives, long horizon) {
        List<JsonNode> rows = Js.items(entitlements);
        for (JsonNode e : rows) {
            if (!Js.object(e) || List.of("entitlementId", "employeeId", "renewalId", "entitlementSlotId").stream()
                    .anyMatch(k -> !isText(e, k))) {
                return false;
            }
            Long renewal = inst(e.get("renewalAt"));
            if (renewal == null || renewal > horizon) {
                return false;
            }
            JsonNode required = e.get("requiredBy");
            if (required != null) {
                Long by = inst(required);
                if (by == null || by > renewal) {
                    return false;
                }
            }
            JsonNode acceptable = e.get("acceptableDerivativeIds");
            if (!Js.array(acceptable) || !Js.items(acceptable).stream()
                    .allMatch(id -> id.isTextual() && derivatives.contains(id.textValue())) || !stringsUnique(Js.items(acceptable))
                    || !Js.array(e.get("gates")) || !Js.everyText(e.get("gates"))) {
                return false;
            }
            JsonNode excluded = e.get("excludedStockIds");
            if (excluded != null && (!Js.array(excluded) || !Js.everyText(excluded) || !stringsUnique(Js.items(excluded)))) {
                return false;
            }
        }
        for (String k : List.of("entitlementId", "employeeId", "entitlementSlotId")) {
            if (!stringsUnique(rows.stream().map(e -> e.get(k)).toList())) {
                return false;
            }
        }
        return true;
    }

    private static void stockInboundCheck(JsonNode input, Set<String> derivatives, long asOfMs, List<ObjectNode> reasons) {
        for (String[] spec : new String[][] {{"stock", "stockId"}, {"inbound", "supplyId"}}) {
            boolean stock = spec[0].equals("stock");
            JsonNode rows = input.get(spec[0]);
            boolean bad = !Js.array(rows) || !stringsUnique(Js.items(rows).stream().map(r -> Js.get(r, spec[1])).toList());
            if (!bad) {
                for (JsonNode r : rows) {
                    if (!Js.object(r) || !Js.text(r.get(spec[1])) || !(r.get("derivativeId") != null && r.get("derivativeId").isTextual()
                            && derivatives.contains(r.get("derivativeId").textValue()))
                            || (stock ? stockBad(r, asOfMs) : inboundBad(r))) {
                        bad = true;
                        break;
                    }
                }
            }
            if (bad) {
                reasons.add(reason(spec[0], "Supply exact unique released/held units or confirmed unreleased quantities and dates."));
            }
        }
    }

    private static boolean stockBad(JsonNode r, long asOfMs) {
        Long at = inst(r.get("availableAt"));
        if (at == null || at > asOfMs) {
            return true;
        }
        JsonNode held = r.get("heldForEntitlementId");
        if (!(held != null && (held.isNull() || Js.text(held)))) {
            return true;
        }
        JsonNode permitted = r.get("permittedEntitlementIds");
        return permitted != null && !permitted.isNull()
                && (!Js.array(permitted) || !Js.everyText(permitted) || !stringsUnique(Js.items(permitted)));
    }

    private static boolean inboundBad(JsonNode r) {
        JsonNode state = r.get("state");
        JsonNode quantity = r.get("quantity");
        JsonNode released = r.get("releasedQuantity");
        return state == null || !state.isTextual() || !state.textValue().equals("confirmed") || !Js.integer(quantity)
                || quantity.doubleValue() == 0 || !Js.integer(released) || released.doubleValue() > quantity.doubleValue()
                || !instant(r.get("expectedAt"));
    }

    private static ArrayNode sortedArray(JsonNode array, Comparator<JsonNode> by) {
        List<JsonNode> items = new ArrayList<>(Js.items(array));
        items.sort(by);
        ArrayNode out = F.arrayNode();
        items.forEach(i -> out.add(i.deepCopy()));
        return out;
    }

    private static Comparator<JsonNode> text(String field) {
        return Comparator.comparing(n -> n.get(field).textValue(), String::compareTo);
    }

    private static Resolved sorted(JsonNode input, long asOfMs, long horizon, List<ObjectNode> reasons) {
        ObjectNode value = input.deepCopy();
        ((ObjectNode) value).set("catalog", sortedArray(input.get("catalog"), text("derivativeId")));
        ObjectNode forecast = (ObjectNode) value.get("forecast");
        Comparator<JsonNode> byDeadline = Comparator.comparing((JsonNode n) -> n.has("requiredBy")
                ? n.get("requiredBy").textValue() : n.get("renewalAt").textValue(), String::compareTo)
                .thenComparing(n -> n.get("entitlementId").textValue(), String::compareTo);
        ArrayNode entitlements = sortedArray(forecast.get("entitlements"), byDeadline);
        for (JsonNode e : entitlements) {
            ((ObjectNode) e).set("acceptableDerivativeIds", sortedStrings(e.get("acceptableDerivativeIds")));
            if (e.has("excludedStockIds")) {
                ((ObjectNode) e).set("excludedStockIds", sortedStrings(e.get("excludedStockIds")));
            }
        }
        forecast.set("entitlements", entitlements);
        value.set("stock", sortedArray(input.get("stock"), text("stockId")));
        value.set("inbound", sortedArray(input.get("inbound"), text("supplyId")));
        ObjectNode constraints = (ObjectNode) value.get("constraints");
        constraints.set("modelBounds", sortedArray(input.get("constraints").get("modelBounds"), text("modelId")));
        constraints.set("derivativeBounds", sortedArray(input.get("constraints").get("derivativeBounds"), text("derivativeId")));
        return typed(value, asOfMs, horizon);
    }

    private static ArrayNode sortedStrings(JsonNode array) {
        List<String> all = new ArrayList<>();
        Js.items(array).forEach(n -> all.add(n.textValue()));
        all.sort(String::compareTo);
        ArrayNode out = F.arrayNode();
        all.forEach(out::add);
        return out;
    }

    private static Resolved typed(ObjectNode value, long asOfMs, long horizon) {
        Plan p = new Plan();
        p.json = value;
        p.runId = value.get("runId").textValue();
        p.asOf = value.get("asOf").textValue();
        p.asOfMs = asOfMs;
        p.horizonMs = horizon;
        p.versions = value.get("versions");
        List<String> limitations = new ArrayList<>();
        value.get("forecast").get("limitations").forEach(n -> limitations.add(n.textValue()));
        limitations.add("Acceptable matching is deterministic feasibility, not calibrated acceptance or employee selection.");
        p.limitations = limitations;
        p.catalog = new ArrayList<>();
        for (JsonNode d : value.get("catalog")) {
            p.catalog.add(new Plan.Derivative(d.get("derivativeId").textValue(), d.get("modelId").textValue(),
                    d.get("unitCostMinor").longValue(), d.get("leadTimeDays").longValue()));
        }
        p.entitlements = new ArrayList<>();
        for (JsonNode e : value.get("forecast").get("entitlements")) {
            String renewal = e.get("renewalAt").textValue();
            String required = e.has("requiredBy") ? e.get("requiredBy").textValue() : null;
            String deadline = required != null ? required : renewal;
            Set<String> acceptable = new LinkedHashSet<>();
            e.get("acceptableDerivativeIds").forEach(n -> acceptable.add(n.textValue()));
            Set<String> excluded = null;
            if (e.has("excludedStockIds")) {
                excluded = new HashSet<>();
                for (JsonNode n : e.get("excludedStockIds")) {
                    excluded.add(n.textValue());
                }
            }
            List<String> gates = new ArrayList<>();
            e.get("gates").forEach(n -> gates.add(n.textValue()));
            p.entitlements.add(new Plan.Entitlement(e.get("entitlementId").textValue(), renewal, required,
                    JsTime.parse(deadline), deadline.equals(renewal), acceptable, e.get("acceptableDerivativeIds").size() > 0,
                    excluded, gates));
        }
        p.stock = new ArrayList<>();
        for (JsonNode s : value.get("stock")) {
            JsonNode held = s.get("heldForEntitlementId");
            JsonNode permitted = s.get("permittedEntitlementIds");
            Set<String> permit = null;
            if (permitted != null && !permitted.isNull()) {
                permit = new HashSet<>();
                for (JsonNode n : permitted) {
                    permit.add(n.textValue());
                }
            }
            p.stock.add(new Plan.Stock(s.get("stockId").textValue(), s.get("derivativeId").textValue(),
                    s.get("availableAt").textValue(), JsTime.parse(s.get("availableAt").textValue()),
                    held.isNull() ? null : held.textValue(), permit));
        }
        p.inbound = new ArrayList<>();
        for (JsonNode s : value.get("inbound")) {
            p.inbound.add(new Plan.Inbound(s.get("supplyId").textValue(), s.get("derivativeId").textValue(),
                    s.get("quantity").longValue() - s.get("releasedQuantity").longValue(), s.get("expectedAt").textValue(),
                    JsTime.parse(s.get("expectedAt").textValue())));
        }
        JsonNode c = value.get("constraints");
        p.currency = c.get("currency").textValue();
        p.budget = c.get("budgetMinor").longValue();
        p.weights = c.get("objectiveWeights");
        p.coverageWeight = p.weights.get("coverage").longValue();
        p.unallocatedWeight = p.weights.get("unallocatedStock").longValue();
        p.costWeight = p.weights.get("costMinor").longValue();
        p.derivativeBounds = bounds(c.get("derivativeBounds"), "derivativeId");
        p.modelBounds = bounds(c.get("modelBounds"), "modelId");
        p.boundByDerivative = new HashMap<>();
        p.derivativeBounds.forEach(b -> p.boundByDerivative.put(b.id(), b));
        p.hasCurrentDraft = value.has("currentDraft");
        p.currentDraft = value.get("currentDraft");
        // Reject unsafe arithmetic before comparing or ranking integer plans (all in doubles, as Node does).
        double maxSpend = 0;
        for (Plan.Derivative d : p.catalog) {
            maxSpend = maxSpend + (double) d.cost() * (double) p.boundByDerivative.get(d.id()).max();
        }
        double maxUnits = p.stock.size();
        double inbound = 0;
        for (JsonNode s : value.get("inbound")) {
            inbound = inbound + s.get("quantity").doubleValue();
        }
        maxUnits = maxUnits + inbound;
        double bounds = 0;
        for (Plan.Bound b : p.derivativeBounds) {
            bounds = bounds + b.max();
        }
        maxUnits = maxUnits + bounds;
        double total = maxSpend * p.costWeight + maxUnits * p.unallocatedWeight + (double) p.entitlements.size() * p.coverageWeight;
        if (!JsNum.safe(maxSpend) || !JsNum.safe(maxUnits) || !JsNum.safe(total)) {
            return refuse(List.of(reason("constraints", "Plan arithmetic exceeds exact integer precision.")));
        }
        return new Resolved(null, p);
    }

    private static List<Plan.Bound> bounds(JsonNode rows, String id) {
        List<Plan.Bound> out = new ArrayList<>();
        for (JsonNode b : rows) {
            out.add(new Plan.Bound(b.get(id).textValue(), b.get("min").longValue(), b.get("max").longValue()));
        }
        return out;
    }
}
