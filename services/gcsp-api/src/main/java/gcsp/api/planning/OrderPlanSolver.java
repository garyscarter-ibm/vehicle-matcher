package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Port of the Node constrained order-plan solver: bounded exhaustive integer search over order quantities,
 * each scored by a capacitated matching of entitlements to supply. Same JSON as Node planOrder.
 */
public final class OrderPlanSolver {

    public static final String CONTRACT_VERSION = "1.0.0";
    static final long MAX_DERIVATIVES = 12;
    static final long MAX_ENTITLEMENTS = 128;
    static final long MAX_SUPPLY_LOTS = 256;
    static final double MAX_CANDIDATES = 50000;
    static final long MAX_MATCHING_STEPS = 2_000_000;
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String TRADE_OFF =
            "Maximise weighted acceptable coverage, less unmatched supply and order cost; budget and quantity bounds remain hard.";

    private record Constraint(String id, String detail) {
        ObjectNode json() {
            ObjectNode n = F.objectNode();
            n.put("id", id);
            n.put("detail", detail);
            return n;
        }
    }

    private static final class Lot {
        String id;
        String derivativeId;
        long quantity;
        String availableAt;
        long ms;
        String held;
        Set<String> permitted;
        String source;
        String stockId;
    }

    private static final class Candidate {
        boolean feasible;
        double[] vector;
        List<Constraint> conflicts;
        List<Lot> lots;
        int[] assigned;
        int covered;
        long totalSupply;
        long unused;
        double spend;
        double objective;
        double orderQuantity;
        double coverageTerm;
        double unallocatedTerm;
        double costTerm;
    }

    private static final class Effort {
        long steps;
    }

    private static final class MatchingEffort extends RuntimeException {
        MatchingEffort() {
            super("matching-effort", null, false, false);
        }
    }

    private static ObjectNode limit(String field, double actual, double maximum) {
        ObjectNode n = F.objectNode();
        n.put("field", field);
        n.set("actual", JsNum.node(actual));
        n.set("maximum", JsNum.node(maximum));
        return n;
    }

    private static ObjectNode solverLimits() {
        ObjectNode n = F.objectNode();
        n.put("derivatives", MAX_DERIVATIVES);
        n.put("entitlements", MAX_ENTITLEMENTS);
        n.put("supplyLots", MAX_SUPPLY_LOTS);
        n.put("candidatePlans", (long) MAX_CANDIDATES);
        n.put("matchingSteps", MAX_MATCHING_STEPS);
        return n;
    }

    private static ObjectNode invalid(String code, List<ObjectNode> reasons) {
        ObjectNode n = F.objectNode();
        n.put("status", "invalid");
        n.put("code", code);
        ArrayNode rs = n.putArray("reasons");
        reasons.forEach(rs::add);
        n.put("contractVersion", CONTRACT_VERSION);
        return n;
    }

    private static String num(double d) {
        return JsNum.str(d);
    }

    /** The plan for one input, equal to Node planOrder(raw). */
    public ObjectNode plan(JsonNode raw) {
        PlanInput.Resolved resolved = PlanInput.resolve(raw);
        if (resolved.reasons() != null) {
            return invalid("invalid-order-plan-input", resolved.reasons());
        }
        Plan input = resolved.plan();
        ObjectNode base = F.objectNode();
        base.put("contractVersion", CONTRACT_VERSION);
        base.put("planId", "order-plan-" + PlanDigest.of(input.json));
        base.put("runId", input.runId);
        base.put("asOf", input.asOf);
        base.set("versions", input.versions.deepCopy());
        ArrayNode limitations = base.putArray("limitations");
        input.limitations.forEach(limitations::add);
        ObjectNode baseSolver = base.putObject("solver");
        baseSolver.put("method", "bounded-exhaustive-integer-search-with-capacity-matching");
        baseSolver.set("limits", solverLimits());

        List<ObjectNode> exceeded = new ArrayList<>();
        if (input.catalog.size() > MAX_DERIVATIVES) {
            exceeded.add(limit("derivatives", input.catalog.size(), MAX_DERIVATIVES));
        }
        if (input.entitlements.size() > MAX_ENTITLEMENTS) {
            exceeded.add(limit("entitlements", input.entitlements.size(), MAX_ENTITLEMENTS));
        }
        int lotCount = input.stock.size() + input.inbound.size() + input.catalog.size();
        if (lotCount > MAX_SUPPLY_LOTS) {
            exceeded.add(limit("supplyLots", lotCount, MAX_SUPPLY_LOTS));
        }
        if (!exceeded.isEmpty()) {
            return unsupported(base, exceeded);
        }
        List<Plan.Bound> ranges = new ArrayList<>();
        for (Plan.Derivative d : input.catalog) {
            ranges.add(input.boundByDerivative.get(d.id()));
        }
        List<Constraint> preliminary = new ArrayList<>();
        for (Plan.Bound b : ranges) {
            if (b.min() > b.max()) {
                preliminary.add(new Constraint("derivative:" + b.id() + ":min", "Minimum " + b.min() + " exceeds maximum " + b.max() + "."));
                preliminary.add(new Constraint("derivative:" + b.id() + ":max", "Conflicts with minimum."));
            }
        }
        for (Plan.Bound b : input.modelBounds) {
            if (b.min() > b.max()) {
                preliminary.add(new Constraint("model:" + b.id() + ":min", "Minimum exceeds maximum."));
                preliminary.add(new Constraint("model:" + b.id() + ":max", "Conflicts with minimum."));
            }
        }
        if (!preliminary.isEmpty()) {
            return infeasible(base, preliminary, 0);
        }
        double combinations = 1;
        for (Plan.Bound b : ranges) {
            combinations = combinations * ((double) b.max() - b.min() + 1);
        }
        if (combinations > MAX_CANDIDATES) {
            return unsupported(base, List.of(limit("candidatePlans", combinations, MAX_CANDIDATES)));
        }
        Effort effort = new Effort();
        Search search = new Search(input, ranges, effort);
        try {
            search.visit(0);
            if (search.top.isEmpty()) {
                List<Constraint> all = new ArrayList<>(search.conflicts.values());
                all.sort(Comparator.comparing(Constraint::id));
                return infeasible(base, all, search.visited);
            }
            Candidate bestCandidate = search.top.get(0);
            ObjectNode best = explain(input, bestCandidate);
            Candidate zero = evaluate(input, new double[input.catalog.size()], effort);
            ObjectNode baseline = explain(input, zero);
            ArrayNode alternatives = F.arrayNode();
            ObjectNode first = F.objectNode();
            first.put("kind", "zero-new-orders-baseline");
            first.setAll(baseline);
            boolean allZero = true;
            for (double q : bestCandidate.vector) {
                allZero = allZero && q == 0;
            }
            first.put("identicalToRecommendation", allZero);
            alternatives.add(first);
            if (search.top.size() > 1) {
                ObjectNode second = F.objectNode();
                second.put("kind", "next-best-distinct-feasible");
                second.setAll(explain(input, search.top.get(1)));
                alternatives.add(second);
            }
            JsonNode comparison = F.nullNode();
            if (input.hasCurrentDraft) {
                double[] draft = draftVector(input);
                if (draft == null) {
                    ObjectNode out = base.deepCopy();
                    out.put("status", "invalid");
                    out.put("code", "invalid-current-draft");
                    out.putArray("quantities");
                    out.putArray("reasons").add(PlanInput.reason("currentDraft",
                            "Supply unique known derivatives and nonnegative integer quantities."));
                    return out;
                }
                Candidate drafted = evaluate(input, draft, effort);
                ObjectNode result = explain(input, drafted);
                ObjectNode c = result.deepCopy();
                if (drafted.feasible) {
                    c.put("coverageDelta", bestCandidate.covered - drafted.covered);
                    c.set("spendDeltaMinor", JsNum.node(bestCandidate.spend - drafted.spend));
                } else {
                    c.putNull("coverageDelta");
                    c.putNull("spendDeltaMinor");
                }
                comparison = c;
            }
            ObjectNode out = base.deepCopy();
            out.setAll(best);
            out.set("alternatives", alternatives);
            out.set("currentDraftComparison", comparison);
            ObjectNode solver = (ObjectNode) out.get("solver");
            solver.put("complete", true);
            solver.put("optimalWithinDeclaredModel", true);
            solver.put("visited", search.visited);
            solver.put("feasibleCount", search.feasibleCount);
            solver.put("matchingSteps", effort.steps);
            return out;
        } catch (MatchingEffort e) {
            return unsupported(base, List.of(limit("matchingSteps", effort.steps, MAX_MATCHING_STEPS)));
        }
    }

    private static ObjectNode unsupported(ObjectNode base, List<ObjectNode> limits) {
        ObjectNode out = base.deepCopy();
        out.put("status", "unsupported");
        out.put("code", "solver-limit");
        ArrayNode ls = out.putArray("limits");
        limits.forEach(ls::add);
        out.putArray("quantities");
        ((ObjectNode) out.get("solver")).put("complete", false);
        return out;
    }

    private static ObjectNode infeasible(ObjectNode base, List<Constraint> conflicts, long visited) {
        ObjectNode out = base.deepCopy();
        out.put("status", "infeasible");
        out.putArray("quantities");
        ArrayNode cs = out.putArray("conflicts");
        conflicts.forEach(c -> cs.add(c.json()));
        out.put("conflictAnalysis", "explanatory-non-minimal-constraint-set");
        out.putArray("alternatives");
        ObjectNode solver = (ObjectNode) out.get("solver");
        solver.put("complete", true);
        solver.put("visited", visited);
        return out;
    }

    /** The exhaustive walk over every vector in the declared ranges, keeping the two best feasible plans. */
    private static final class Search {
        final Plan input;
        final List<Plan.Bound> ranges;
        final Effort effort;
        final double[] vector;
        final List<Candidate> top = new ArrayList<>();
        final Map<String, Constraint> conflicts = new LinkedHashMap<>();
        long visited;
        long feasibleCount;

        Search(Plan input, List<Plan.Bound> ranges, Effort effort) {
            this.input = input;
            this.ranges = ranges;
            this.effort = effort;
            this.vector = new double[ranges.size()];
        }

        void visit(int at) {
            if (at < ranges.size()) {
                for (long q = ranges.get(at).min(); q <= ranges.get(at).max(); q++) {
                    vector[at] = q;
                    visit(at + 1);
                }
                return;
            }
            visited++;
            Candidate candidate = evaluate(input, vector.clone(), effort);
            if (!candidate.feasible) {
                candidate.conflicts.forEach(c -> conflicts.put(c.id(), c));
                return;
            }
            feasibleCount++;
            top.add(candidate);
            top.sort(OrderPlanSolver::rank);
            if (top.size() > 2) {
                top.remove(top.size() - 1);
            }
        }
    }

    private static String joined(double[] vector) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(num(vector[i]));
        }
        return sb.toString();
    }

    private static int sign(double difference) {
        return difference < 0 ? -1 : difference > 0 ? 1 : 0;
    }

    private static int rank(Candidate a, Candidate b) {
        int c = sign(b.objective - a.objective);
        if (c == 0) {
            c = sign(a.spend - b.spend);
        }
        if (c == 0) {
            c = sign(a.orderQuantity - b.orderQuantity);
        }
        return c != 0 ? c : joined(a.vector).compareTo(joined(b.vector));
    }

    private static List<Lot> lotsFor(Plan input, double[] vector) {
        List<Lot> lots = new ArrayList<>();
        for (Plan.Stock s : input.stock) {
            Lot l = new Lot();
            l.id = "stock:" + s.stockId();
            l.derivativeId = s.derivativeId();
            l.quantity = 1;
            l.availableAt = s.availableAt();
            l.ms = s.ms();
            l.held = s.held();
            l.permitted = s.permitted();
            l.source = "stock";
            l.stockId = s.stockId();
            lots.add(l);
        }
        for (Plan.Inbound s : input.inbound) {
            Lot l = new Lot();
            l.id = "supply:" + s.supplyId();
            l.derivativeId = s.derivativeId();
            l.quantity = s.quantity();
            l.availableAt = s.expectedAt();
            l.ms = s.ms();
            l.source = "confirmed-inbound";
            lots.add(l);
        }
        for (int i = 0; i < input.catalog.size(); i++) {
            Plan.Derivative d = input.catalog.get(i);
            Lot l = new Lot();
            l.id = "order:" + d.id();
            l.derivativeId = d.id();
            l.quantity = (long) vector[i];
            l.ms = input.asOfMs + d.lead() * JsTime.DAY;
            l.availableAt = JsTime.iso(l.ms);
            l.source = "new-order";
            lots.add(l);
        }
        lots.removeIf(l -> l.quantity <= 0 || l.ms > input.horizonMs);
        lots.sort((a, b) -> {
            int c = a.availableAt.compareTo(b.availableAt);
            return c != 0 ? c : a.id.compareTo(b.id);
        });
        return lots;
    }

    private static boolean visible(Lot lot, String entitlementId) {
        return lot.permitted == null || lot.permitted.contains(entitlementId);
    }

    private static boolean heldOk(Lot lot, String entitlementId) {
        return lot.held == null || lot.held.equals(entitlementId);
    }

    private static boolean excluded(Lot lot, Plan.Entitlement e) {
        return lot.source.equals("stock") && e.excluded() != null && e.excluded().contains(lot.stockId);
    }

    /** Capacitated bipartite matching; each augmentation may move a flexible entitlement to a substitute. */
    private static int[] allocate(Plan input, List<Lot> lots, Effort effort) {
        int n = input.entitlements.size();
        List<List<Integer>> owners = new ArrayList<>();
        for (int i = 0; i < lots.size(); i++) {
            owners.add(new ArrayList<>());
        }
        int[] assignment = new int[n];
        java.util.Arrays.fill(assignment, -1);
        int[][] choices = new int[n][];
        for (int e = 0; e < n; e++) {
            Plan.Entitlement en = input.entitlements.get(e);
            List<Integer> list = new ArrayList<>();
            if (input.asOfMs <= en.deadlineMs()) {
                for (int i = 0; i < lots.size(); i++) {
                    Lot s = lots.get(i);
                    if (en.acceptable().contains(s.derivativeId) && s.ms <= en.deadlineMs() && !excluded(s, en)
                            && heldOk(s, en.id()) && visible(s, en.id())) {
                        list.add(i);
                    }
                }
            }
            choices[e] = list.stream().mapToInt(Integer::intValue).toArray();
        }
        for (int e = 0; e < n; e++) {
            augment(e, new boolean[lots.size()], choices, owners, lots, assignment, effort);
        }
        return assignment;
    }

    private static boolean augment(int employee, boolean[] seen, int[][] choices, List<List<Integer>> owners,
            List<Lot> lots, int[] assignment, Effort effort) {
        for (int lot : choices[employee]) {
            effort.steps++;
            if (effort.steps > MAX_MATCHING_STEPS) {
                throw new MatchingEffort();
            }
            if (seen[lot]) {
                continue;
            }
            seen[lot] = true;
            List<Integer> mine = owners.get(lot);
            if (mine.size() < lots.get(lot).quantity) {
                mine.add(employee);
                assignment[employee] = lot;
                return true;
            }
            for (int at = 0; at < mine.size(); at++) {
                int previous = mine.get(at);
                if (augment(previous, seen, choices, owners, lots, assignment, effort)) {
                    mine.set(at, employee);
                    assignment[employee] = lot;
                    return true;
                }
            }
        }
        return false;
    }

    private static double spend(Plan input, double[] vector) {
        double n = 0;
        for (int i = 0; i < input.catalog.size(); i++) {
            n = n + (double) input.catalog.get(i).cost() * vector[i];
        }
        return n;
    }

    private static List<Constraint> hardConstraints(Plan input, double[] vector) {
        List<Constraint> conflicts = new ArrayList<>();
        for (int i = 0; i < input.catalog.size(); i++) {
            Plan.Derivative d = input.catalog.get(i);
            Plan.Bound bound = input.boundByDerivative.get(d.id());
            if (vector[i] < bound.min()) {
                conflicts.add(new Constraint("derivative:" + d.id() + ":min", "Minimum " + bound.min() + "."));
            }
            if (vector[i] > bound.max()) {
                conflicts.add(new Constraint("derivative:" + d.id() + ":max", "Maximum " + bound.max() + "."));
            }
            if (vector[i] > 0 && input.asOfMs + d.lead() * JsTime.DAY > input.horizonMs) {
                conflicts.add(new Constraint("lead-time:" + d.id(), "New orders arrive after the planning horizon."));
            }
        }
        for (Plan.Bound b : input.modelBounds) {
            double quantity = 0;
            for (int i = 0; i < input.catalog.size(); i++) {
                quantity = quantity + (input.catalog.get(i).modelId().equals(b.id()) ? vector[i] : 0);
            }
            if (quantity < b.min()) {
                conflicts.add(new Constraint("model:" + b.id() + ":min", "Minimum " + b.min() + "."));
            }
            if (quantity > b.max()) {
                conflicts.add(new Constraint("model:" + b.id() + ":max", "Maximum " + b.max() + "."));
            }
        }
        double spend = spend(input, vector);
        if (spend > input.budget) {
            conflicts.add(new Constraint("budget", "Spend " + num(spend) + " exceeds " + input.budget + " " + input.currency
                    + " minor units."));
        }
        return conflicts;
    }

    private static Candidate evaluate(Plan input, double[] vector, Effort effort) {
        Candidate c = new Candidate();
        c.vector = vector;
        List<Constraint> conflicts = hardConstraints(input, vector);
        if (!conflicts.isEmpty()) {
            c.conflicts = conflicts;
            return c;
        }
        List<Lot> lots = lotsFor(input, vector);
        int[] assignment = allocate(input, lots, effort);
        int covered = 0;
        for (int a : assignment) {
            if (a >= 0) {
                covered++;
            }
        }
        c.feasible = true;
        c.lots = lots;
        c.assigned = assignment;
        c.covered = covered;
        c.spend = spend(input, vector);
        long total = 0;
        for (Lot l : lots) {
            total += l.quantity;
        }
        c.totalSupply = total;
        c.unused = total - covered;
        double order = 0;
        for (double q : vector) {
            order = order + q;
        }
        c.orderQuantity = order;
        c.coverageTerm = (double) covered * input.coverageWeight;
        c.unallocatedTerm = 0 - (double) c.unused * input.unallocatedWeight;
        c.costTerm = 0 - c.spend * input.costWeight;
        c.objective = c.coverageTerm + c.unallocatedTerm + c.costTerm;
        return c;
    }

    private static ArrayNode quantities(Plan input, double[] vector) {
        ArrayNode out = F.arrayNode();
        for (int i = 0; i < input.catalog.size(); i++) {
            ObjectNode q = out.addObject();
            q.put("derivativeId", input.catalog.get(i).id());
            q.put("modelId", input.catalog.get(i).modelId());
            q.set("quantity", JsNum.node(vector[i]));
        }
        return out;
    }

    private static double modelQuantity(Plan input, double[] vector, String modelId) {
        double n = 0;
        for (int i = 0; i < input.catalog.size(); i++) {
            if (input.catalog.get(i).modelId().equals(modelId)) {
                n = n + vector[i];
            }
        }
        return n;
    }

    private static ObjectNode json(Plan input, Candidate c) {
        ObjectNode out = F.objectNode();
        if (!c.feasible) {
            out.put("status", "infeasible");
            out.set("quantities", quantities(input, c.vector));
            ArrayNode cs = out.putArray("conflicts");
            c.conflicts.forEach(x -> cs.add(x.json()));
            return out;
        }
        out.put("status", "feasible");
        out.set("quantities", quantities(input, c.vector));
        ArrayNode models = out.putArray("modelQuantities");
        for (Plan.Bound b : input.modelBounds) {
            ObjectNode m = models.addObject();
            m.put("modelId", b.id());
            m.set("quantity", JsNum.node(modelQuantity(input, c.vector, b.id())));
        }
        ArrayNode allocations = out.putArray("allocations");
        int[] perLot = new int[c.lots.size()];
        for (int e = 0; e < c.assigned.length; e++) {
            if (c.assigned[e] < 0) {
                continue;
            }
            Plan.Entitlement en = input.entitlements.get(e);
            Lot lot = c.lots.get(c.assigned[e]);
            perLot[c.assigned[e]]++;
            ObjectNode a = allocations.addObject();
            a.put("entitlementId", en.id());
            a.put("derivativeId", lot.derivativeId);
            a.put("sourceId", lot.id);
            a.put("source", lot.source);
            a.put("availableAt", lot.availableAt);
            a.put("renewalAt", en.renewalAt());
            if (en.requiredBy() != null) {
                a.put("requiredBy", en.requiredBy());
            }
        }
        ObjectNode coverage = out.putObject("expectedAcceptableCoverage");
        coverage.put("covered", c.covered);
        coverage.put("total", input.entitlements.size());
        if (input.entitlements.isEmpty()) {
            coverage.putNull("fraction");
        } else {
            coverage.set("fraction", JsNum.node((double) c.covered / input.entitlements.size()));
        }
        coverage.put("basis", "deterministic-acceptable-matching-before-renewal");
        ObjectNode risk = out.putObject("unallocatedStockRisk");
        risk.put("quantity", c.unused);
        risk.put("totalSupply", c.totalSupply);
        risk.put("basis", "unmatched-supply-within-horizon");
        ArrayNode bySource = risk.putArray("bySource");
        for (int i = 0; i < c.lots.size(); i++) {
            long left = c.lots.get(i).quantity - perLot[i];
            if (left > 0) {
                ObjectNode s = bySource.addObject();
                s.put("sourceId", c.lots.get(i).id);
                s.put("quantity", left);
            }
        }
        out.set("spendMinor", JsNum.node(c.spend));
        out.put("currency", input.currency);
        out.set("orderQuantity", JsNum.node(c.orderQuantity));
        ObjectNode objective = out.putObject("objective");
        objective.set("value", JsNum.node(c.objective));
        objective.set("weights", input.weights.deepCopy());
        ObjectNode terms = objective.putObject("terms");
        terms.set("coverage", JsNum.node(c.coverageTerm));
        terms.set("unallocatedStock", JsNum.node(c.unallocatedTerm));
        terms.set("cost", JsNum.node(c.costTerm));
        objective.put("tradeOff", TRADE_OFF);
        return out;
    }

    private static List<Constraint> bindings(Plan input, Candidate c) {
        List<Constraint> result = new ArrayList<>();
        if (c.spend == input.budget) {
            result.add(new Constraint("budget", "Order spend meets the budget."));
        }
        for (int i = 0; i < input.catalog.size(); i++) {
            Plan.Derivative d = input.catalog.get(i);
            Plan.Bound b = input.boundByDerivative.get(d.id());
            if (c.vector[i] == b.min()) {
                result.add(new Constraint("derivative:" + d.id() + ":min", "Quantity meets minimum " + b.min() + "."));
            }
            if (c.vector[i] == b.max()) {
                result.add(new Constraint("derivative:" + d.id() + ":max", "Quantity meets maximum " + b.max() + "."));
            }
            if (input.asOfMs + d.lead() * JsTime.DAY > input.horizonMs) {
                result.add(new Constraint("lead-time:" + d.id(), "No new quantity reaches this horizon."));
            }
        }
        for (Plan.Bound b : input.modelBounds) {
            double quantity = modelQuantity(input, c.vector, b.id());
            if (quantity == b.min()) {
                result.add(new Constraint("model:" + b.id() + ":min", "Quantity meets minimum " + b.min() + "."));
            }
            if (quantity == b.max()) {
                result.add(new Constraint("model:" + b.id() + ":max", "Quantity meets maximum " + b.max() + "."));
            }
        }
        return result;
    }

    private static ObjectNode explain(Plan input, Candidate c) {
        ObjectNode plan = json(input, c);
        if (!c.feasible) {
            return plan;
        }
        List<Constraint> binding = bindings(input, c);
        List<Lot> lots = lotsFor(input, c.vector);
        ArrayNode unmet = F.arrayNode();
        for (int idx = 0; idx < input.entitlements.size(); idx++) {
            if (c.assigned[idx] >= 0) {
                continue;
            }
            Plan.Entitlement e = input.entitlements.get(idx);
            List<Lot> acceptable = new ArrayList<>();
            List<Lot> timely = new ArrayList<>();
            List<Lot> visibleLots = new ArrayList<>();
            List<Lot> heldPermitted = new ArrayList<>();
            List<Lot> accessible = new ArrayList<>();
            for (Lot s : lots) {
                if (e.acceptable().contains(s.derivativeId)) {
                    acceptable.add(s);
                    if (s.ms <= e.deadlineMs()) {
                        timely.add(s);
                        if (visible(s, e.id())) {
                            visibleLots.add(s);
                            if (heldOk(s, e.id())) {
                                heldPermitted.add(s);
                                if (!excluded(s, e)) {
                                    accessible.add(s);
                                }
                            }
                        }
                    }
                }
            }
            List<String> gates = new ArrayList<>(e.gates());
            if (e.deadlineMs() < input.asOfMs) {
                gates.add(e.renewalDeadline() ? "renewal-already-passed" : "required-by-already-passed");
            }
            if (!e.hasAcceptable()) {
                gates.add("no-permitted-acceptable-choice");
            } else if (!timely.isEmpty() && visibleLots.isEmpty()) {
                gates.add("stock-not-visible");
            } else if (!visibleLots.isEmpty() && heldPermitted.isEmpty()) {
                gates.add("held-for-another-entitlement");
            } else if (!heldPermitted.isEmpty() && accessible.isEmpty()) {
                gates.add("declined-unchanged");
            } else if (!acceptable.isEmpty() && timely.isEmpty()) {
                gates.add(e.renewalDeadline() ? "arrival-after-renewal" : "arrival-after-required-by");
            }
            List<String> blocked = new ArrayList<>();
            boolean additionalOrderFeasible = false;
            for (int i = 0; i < input.catalog.size(); i++) {
                Plan.Derivative d = input.catalog.get(i);
                if (!e.acceptable().contains(d.id())) {
                    continue;
                }
                if (input.asOfMs + d.lead() * JsTime.DAY > e.deadlineMs()) {
                    blocked.add((e.renewalDeadline() ? "lead-time-before-renewal:" : "lead-time-before-required-by:") + d.id());
                    continue;
                }
                double[] next = c.vector.clone();
                next[i] = next[i] + 1;
                List<Constraint> obstacles = hardConstraints(input, next);
                if (obstacles.isEmpty()) {
                    additionalOrderFeasible = true;
                }
                for (Constraint obstacle : obstacles) {
                    blocked.add(obstacle.id());
                    if (binding.stream().noneMatch(b -> b.id().equals(obstacle.id()))) {
                        binding.add(new Constraint(obstacle.id(), "An additional acceptable vehicle is blocked: " + obstacle.detail()));
                    }
                }
            }
            if (e.hasAcceptable()) {
                gates.add(additionalOrderFeasible ? "objective-tradeoff" : "acceptable-supply-scarcity");
            }
            ObjectNode need = unmet.addObject();
            need.put("entitlementId", e.id());
            need.put("renewalAt", e.renewalAt());
            ArrayNode g = need.putArray("gates");
            new TreeSet<>(gates).forEach(g::add);
            ArrayNode ids = need.putArray("constraintIds");
            new TreeSet<>(blocked).forEach(ids::add);
        }
        ArrayNode bc = F.arrayNode();
        binding.forEach(b -> bc.add(b.json()));
        plan.set("bindingConstraints", bc);
        plan.set("unmetNeeds", unmet);
        return plan;
    }

    private static double[] draftVector(Plan input) {
        JsonNode draft = input.currentDraft;
        JsonNode rows = Js.get(draft, "quantities");
        if (!Js.array(rows)) {
            return null;
        }
        Set<String> seen = new HashSet<>();
        Map<String, Double> byId = new LinkedHashMap<>();
        for (JsonNode r : rows) {
            JsonNode id = Js.get(r, "derivativeId");
            if (!Js.object(r) || !Js.integer(r.get("quantity")) || id == null || !id.isTextual()
                    || input.catalog.stream().noneMatch(d -> d.id().equals(id.textValue()))) {
                return null;
            }
            seen.add(id.textValue());
            byId.putIfAbsent(id.textValue(), r.get("quantity").doubleValue());
        }
        if (seen.size() != rows.size()) {
            return null;
        }
        double[] vector = new double[input.catalog.size()];
        for (int i = 0; i < vector.length; i++) {
            vector[i] = byId.getOrDefault(input.catalog.get(i).id(), 0.0);
        }
        return vector;
    }
}
