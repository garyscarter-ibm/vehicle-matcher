package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.DemandPolicyPort.DemandPolicy;
import gcsp.api.demand.DemandStore.Brief;
import gcsp.api.demand.DemandStore.Car;
import gcsp.api.demand.DemandStore.Employee;
import gcsp.api.demand.DemandStore.Hold;
import gcsp.api.demand.Disclosure.Cell;
import gcsp.api.demand.Disclosure.Relation;
import gcsp.api.demand.OfferRecordsPort.DecisionRow;
import gcsp.api.demand.OfferRecordsPort.OfferRecords;
import gcsp.api.demand.OfferRecordsPort.OfferRow;
import gcsp.api.demand.UnmetEvaluationPort.BriefCandidate;
import gcsp.api.demand.UnmetEvaluationPort.CarCandidate;
import gcsp.api.demand.UnmetEvaluationPort.CarDecision;
import gcsp.api.demand.UnmetEvaluationPort.Evaluation;
import gcsp.api.demand.UnmetEvaluationPort.Gate;
import gcsp.api.persistence.Canonical;
import java.sql.Connection;
import java.text.Collator;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import javax.sql.DataSource;

/**
 * The Greg saved-demand projection over native PostgreSQL (port of server/gcsp/greg readDemand). Every SQL read runs in
 * one repeatable-read snapshot, so no mixed view can be published; the unmet evaluation is a pure call after it.
 */
public final class DemandService {

    static final String THRESHOLD_KEY = "greg.demand.smallCountThreshold";
    private static final Set<String> OCCUPYING = Set.of("active", "claim-pending", "release-pending", "selection-pending");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final String UNSPECIFIED = "unspecified";

    private final DataSource dataSource;
    private final DemandPolicyPort policy;
    private final UnmetEvaluationPort unmet;
    private final OfferRecordsPort offers;
    private final Clock clock;

    public DemandService(DataSource dataSource, DemandPolicyPort policy, UnmetEvaluationPort unmet, OfferRecordsPort offers,
            Clock clock) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.unmet = unmet;
        this.offers = offers;
        this.clock = clock;
    }

    /** What one snapshot read captured. */
    private record Snapshot(long revision, List<Brief> briefs, Map<String, Employee> owners, List<Hold> holds, List<Car> cars,
            ObjectNode source, OfferRecords offers, Map<String, JsonNode> priorBriefs) {}

    /** No role check here: the HTTP layer requires Greg before calling. */
    public DemandResult read(DemandScope scope) {
        Instant asOf = clock.instant();
        DemandPolicy rules;
        int threshold;
        List<String> reasonCodes;
        try {
            rules = policy.read(scope.policyVersion(), asOf).orElse(null);
            reasonCodes = rules == null ? null : validate(rules, scope.policyVersion());
            threshold = reasonCodes == null ? 0 : rules.threshold().asInt();
        } catch (RuntimeException e) {
            return DemandResult.Refusal.unavailable("privacy-policy-unavailable");
        }
        if (reasonCodes == null) return DemandResult.Refusal.unavailable("privacy-policy-unavailable");
        try {
            Snapshot snap = snapshot(scope);
            if (snap == null) return DemandResult.Refusal.staleRun();
            if (snap.offers() == null) return DemandResult.Refusal.unavailable("source-invalid");
            return project(scope, rules, threshold, new HashSet<>(reasonCodes), asOf, snap);
        } catch (Unavailable e) {
            return DemandResult.Refusal.unavailable(e.code);
        } catch (Exception e) {
            return DemandResult.Refusal.unavailable("source-invalid");
        }
    }

    private static final class Unavailable extends RuntimeException {
        final String code;

        Unavailable(String code) {
            super(code, null, false, false);
            this.code = code;
        }
    }

    // ---- policy validation: the decline reason codes, or null when any value is unusable ----

    private static List<String> validate(DemandPolicy p, String version) {
        if (!version.equals(p.policyVersion())) return null;
        JsonNode t = p.threshold();
        if (t == null || !t.isNumber() || t.asDouble() != Math.rint(t.asDouble()) || t.asDouble() < 1
                || t.asDouble() > Integer.MAX_VALUE) return null;
        JsonNode r = p.declineReasons();
        if (r == null || !r.path("schemaVersion").isNumber() || r.path("schemaVersion").asDouble() != 1
                || !r.path("reasons").isArray() || r.get("reasons").isEmpty()) return null;
        List<String> codes = new ArrayList<>();
        for (JsonNode reason : r.get("reasons")) {
            JsonNode code = reason.path("code");
            if (!code.isTextual() || code.asText().isEmpty() || codes.contains(code.asText())) return null;
            codes.add(code.asText());
        }
        JsonNode x = p.declinedCarExclusion();
        if (x == null || !x.isTextual() || !"untilRelevantConfirmedBriefChange".equals(x.asText())) return null;
        return p.recommendationEssentials() != null && p.recommendationEssentials().isObject() ? codes : null;
    }

    // ---- the snapshot: one connection, repeatable read, read only ----

    private Snapshot snapshot(DemandScope scope) throws Exception {
        try (Connection c = dataSource.getConnection()) {
            boolean auto = c.getAutoCommit();
            boolean readOnly = c.isReadOnly();
            int isolation = c.getTransactionIsolation();
            try {
                c.setAutoCommit(false);
                c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                c.setReadOnly(true);
                Optional<Long> revision = DemandStore.activeRevision(c, scope);
                if (revision.isEmpty()) return null;
                List<Brief> briefs = DemandStore.currentBriefs(c, scope);
                Map<String, Employee> owners = DemandStore.owners(c, scope);
                List<Hold> holds = DemandStore.holds(c, scope);
                List<Car> cars = DemandStore.cars(c, scope);
                ObjectNode source = DemandStore.sourceStatus(c, scope);
                OfferRecords records = offers.read(c, scope).orElse(null);
                Map<String, JsonNode> prior = new HashMap<>();
                if (records != null) prior = priorBriefs(c, scope, briefs, records);
                c.commit();
                return new Snapshot(revision.get(), briefs, owners, holds, cars, source, records, prior);
            } finally {
                try {
                    c.rollback();
                } finally {
                    c.setReadOnly(readOnly);
                    c.setTransactionIsolation(isolation);
                    c.setAutoCommit(auto);
                }
            }
        }
    }

    /** One batched read of the earlier briefs that an employee's declines point to (not the current version). */
    private static Map<String, JsonNode> priorBriefs(Connection c, DemandScope scope, List<Brief> briefs, OfferRecords r)
            throws Exception {
        Map<String, Long> current = new HashMap<>();
        briefs.forEach(b -> current.put(b.employeeId(), b.version()));
        Set<String> pairs = new TreeSet<>();
        List<String> employees = new ArrayList<>();
        List<Long> versions = new ArrayList<>();
        for (DecisionRow d : r.decisions()) {
            Long cur = current.get(d.employeeId());
            if (!"decline".equals(d.decision()) || cur == null || d.briefVersion() == null || d.briefVersion().equals(cur)) continue;
            if (pairs.add(d.employeeId() + "|" + d.briefVersion())) {
                employees.add(d.employeeId());
                versions.add(d.briefVersion());
            }
        }
        return DemandStore.briefContents(c, scope, employees, versions);
    }

    // ---- the projection ----

    private record Ver(Long brief, String policy) {}

    /** The members of one published count and the versions they were derived from. */
    private static final class Bucket {
        long count;
        final TreeSet<Long> brief = new TreeSet<>();
        final TreeSet<String> policy = new TreeSet<>();

        Bucket hit(Collection<Ver> versions) {
            count++;
            for (Ver v : versions) {
                if (v.brief() != null) brief.add(v.brief());
                if (v.policy() != null) policy.add(v.policy());
            }
            return this;
        }
    }

    private record Agg(Cell cell, Bucket bucket) {}

    private record Group(String key, Agg agg, ObjectNode meta) {}

    /** Collects every count, its relations to the others, and renders them once withholding is settled. */
    private static final class Counts {
        final int n;
        final String scopePolicy;
        final List<Agg> all = new ArrayList<>();
        final List<Relation> relations = new ArrayList<>();
        final Collator collator = Collator.getInstance(Locale.ROOT);
        TreeSet<Long> topBrief;
        TreeSet<String> topPolicy;

        Counts(int n, String scopePolicy) {
            this.n = n;
            this.scopePolicy = scopePolicy;
        }

        Agg agg(String key, Bucket b, int minimum) {
            Agg a = new Agg(new Cell(key, b.count, minimum, n), b);
            all.add(a);
            return a;
        }

        /** Groups only list keys that have items, ordered by the root collator. */
        List<Group> groups(Map<String, Bucket> buckets, Map<String, ObjectNode> metas) {
            List<String> keys = new ArrayList<>(buckets.keySet());
            keys.sort(collator::compare);
            List<Group> out = new ArrayList<>();
            for (String k : keys) out.add(new Group(k, agg(k, buckets.get(k), 1), metas == null ? null : metas.get(k)));
            return out;
        }

        void freeze() {
            topBrief = new TreeSet<>();
            topPolicy = new TreeSet<>(List.of(scopePolicy));
            for (Agg a : all) {
                topBrief.addAll(a.bucket().brief);
                topPolicy.addAll(a.bucket().policy);
            }
            Disclosure.apply(n, relations);
        }

        boolean withheld() {
            return all.stream().anyMatch(a -> a.cell().kind == Disclosure.Kind.AT_LEAST);
        }

        ObjectNode count(Agg a) {
            ObjectNode o = Demand.obj();
            o.set("count", Disclosure.render(a.cell(), n));
            ObjectNode versions = o.putObject("versions");
            boolean banded = a.cell().banded();
            ArrayNode brief = versions.putArray("brief");
            (banded ? topBrief : a.bucket().brief).forEach(brief::add);
            ArrayNode pol = versions.putArray("policy");
            if (banded) topPolicy.forEach(pol::add);
            else {
                TreeSet<String> own = new TreeSet<>(a.bucket().policy);
                own.add(scopePolicy);
                own.forEach(pol::add);
            }
            return o;
        }

        ArrayNode list(List<Group> groups, boolean keyed) {
            ArrayNode out = Demand.arr();
            for (Group g : groups) {
                ObjectNode o = Demand.obj();
                if (keyed) o.put("key", g.key());
                else g.meta().properties().forEach(e -> o.set(e.getKey(), e.getValue()));
                o.setAll(count(g.agg()));
                out.add(o);
            }
            return out;
        }
    }

    private DemandResult project(DemandScope scope, DemandPolicy rules, int n, Set<String> reasonCodes, Instant asOf,
            Snapshot s) {
        Counts k = new Counts(n, scope.policyVersion());
        List<Brief> briefs = s.briefs();
        Map<String, Brief> byEmployee = new HashMap<>();
        briefs.forEach(b -> byEmployee.put(b.employeeId(), b));

        // Demand: the latest confirmed brief per employee only.
        Bucket total = new Bucket();
        Map<String, Bucket> model = new HashMap<>();
        Map<String, Bucket> body = new HashMap<>();
        Map<String, Bucket> fuel = new HashMap<>();
        Map<String, Bucket> essentials = new HashMap<>();
        Map<String, ObjectNode> essentialMeta = new HashMap<>();
        for (Brief b : briefs) {
            List<Ver> v = List.of(new Ver(b.version(), b.policyVersion()));
            total.hit(v);
            model.computeIfAbsent(text(desired(b.content(), "modelLine")), x -> new Bucket()).hit(v);
            for (String x : values(desired(b.content(), "body"))) body.computeIfAbsent(x, y -> new Bucket()).hit(v);
            for (String x : values(desired(b.content(), "fuel"))) fuel.computeIfAbsent(x, y -> new Bucket()).hit(v);
            for (var e : b.content().path("essentials").properties()) {
                if (!"charging".equals(e.getKey()) && !rules.recommendationEssentials().has(e.getKey())) continue;
                JsonNode req = e.getValue();
                boolean confirmed = "confirmed".equals(req.path("state").asText(null));
                ObjectNode meta = Demand.obj();
                meta.put("field", e.getKey());
                meta.set("operator", nodeOrNull(req.get("operator")));
                meta.set("value", confirmed ? requirementValue(req) : Demand.M.nullNode());
                meta.set("unit", nodeOrNull(req.get("unit")));
                meta.put("state", confirmed ? "confirmed" : "needs-confirmation");
                String key = Canonical.json(Demand.arr().add(e.getKey()).add(meta.get("operator")).add(meta.get("value"))
                        .add(meta.get("unit")).add(meta.get("state").asText()));
                essentials.computeIfAbsent(key, x -> new Bucket()).hit(v);
                essentialMeta.put(key, meta);
            }
        }
        Agg activeBriefs = k.agg("activeBriefs", total, 0);
        List<Group> byModelLine = k.groups(model, null);
        List<Group> byBody = k.groups(body, null);
        List<Group> byFuel = k.groups(fuel, null);
        List<Group> essentialGroups = k.groups(essentials, essentialMeta);
        k.relations.add(Relation.partition(activeBriefs.cell(), cells(byModelLine)));
        k.relations.add(Relation.cover(activeBriefs.cell(), cells(byBody)));
        k.relations.add(Relation.cover(activeBriefs.cell(), cells(byFuel)));

        // Unmet demand.
        Map<String, Bucket> gateBuckets = new HashMap<>();
        Bucket unmetTotal = new Bucket();
        for (Map.Entry<Brief, List<String>> u : unmet(scope, asOf, s, byEmployee, reasonCodes).entrySet()) {
            List<Ver> v = List.of(new Ver(u.getKey().version(), u.getKey().policyVersion()));
            unmetTotal.hit(v);
            for (String gate : u.getValue()) gateBuckets.computeIfAbsent(gate, x -> new Bucket()).hit(v);
        }
        Agg unmetAgg = k.agg("unmet", unmetTotal, 0);
        List<Group> byGate = k.groups(gateBuckets, null);
        k.relations.add(Relation.cover(unmetAgg.cell(), cells(byGate)));

        // Holds: versions come from the offers that point at the hold.
        Map<String, List<Ver>> offerVersionsByHold = new HashMap<>();
        OfferRecords records = s.offers();
        for (OfferRow o : records.offers()) {
            if (o.holdId() != null) offerVersionsByHold.computeIfAbsent(o.holdId(), x -> new ArrayList<>())
                    .add(new Ver(o.briefVersion(), o.policyVersion()));
        }
        Bucket holdTotal = new Bucket();
        Bucket holdActive = new Bucket();
        Map<String, Bucket> holdState = new HashMap<>();
        Map<String, Bucket> holdType = new HashMap<>();
        Map<String, Hold> holdById = new HashMap<>();
        for (Hold h : s.holds()) {
            List<Ver> v = offerVersionsByHold.getOrDefault(h.holdId(), List.of());
            holdById.put(h.holdId(), h);
            holdTotal.hit(v);
            if (OCCUPYING.contains(h.state())) holdActive.hit(v);
            holdState.computeIfAbsent(h.state(), x -> new Bucket()).hit(v);
            holdType.computeIfAbsent(h.type(), x -> new Bucket()).hit(v);
        }
        Agg holdsTotal = k.agg("holds", holdTotal, 0);
        Agg holdsActive = k.agg("holds-active", holdActive, 0);
        List<Group> byState = k.groups(holdState, null);
        List<Group> byType = k.groups(holdType, null);
        k.relations.add(Relation.partition(holdsTotal.cell(), cells(byState)));
        k.relations.add(Relation.partition(holdsTotal.cell(), cells(byType)));
        k.relations.add(Relation.partition(holdsActive.cell(),
                byState.stream().filter(g -> OCCUPYING.contains(g.key())).map(g -> g.agg().cell()).toList()));
        // Active is a part of the total too, so an absent occupying state cannot be differenced out of it.
        List<Cell> notActive = new ArrayList<>(List.of(holdsActive.cell()));
        byState.stream().filter(g -> !OCCUPYING.contains(g.key())).forEach(g -> notActive.add(g.agg().cell()));
        k.relations.add(Relation.partition(holdsTotal.cell(), notActive));

        // Offers.
        Map<String, List<DecisionRow>> decisionsByOffer = new HashMap<>();
        records.decisions().forEach(d -> decisionsByOffer.computeIfAbsent(d.offerId(), x -> new ArrayList<>()).add(d));
        Bucket made = new Bucket();
        Bucket accepted = new Bucket();
        Bucket declined = new Bucket();
        Bucket expired = new Bucket();
        Bucket selected = new Bucket();
        Map<String, Bucket> reasons = new HashMap<>();
        for (OfferRow o : records.offers()) {
            List<DecisionRow> ds = decisionsByOffer.getOrDefault(o.offerId(), List.of());
            List<Ver> v = new ArrayList<>(List.of(new Ver(o.briefVersion(), o.policyVersion())));
            ds.forEach(d -> v.add(new Ver(d.briefVersion(), d.policyVersion())));
            boolean isAccepted = "accepted".equals(o.state()) || decided(ds, "accept");
            boolean isDeclined = "declined".equals(o.state()) || decided(ds, "decline");
            Hold hold = o.holdId() == null ? null : holdById.get(o.holdId());
            boolean isSelected = "selected".equals(o.state()) || decided(ds, "select") || decided(ds, "selected")
                    || hold != null && "allocated".equals(hold.state());
            made.hit(v);
            if (isAccepted) accepted.hit(v);
            if (isDeclined) {
                declined.hit(v);
                String code = ds.stream().filter(d -> "decline".equals(d.decision())).map(DecisionRow::reasonCode)
                        .findFirst().orElse(null);
                reasons.computeIfAbsent(code != null && reasonCodes.contains(code) ? code : "unclassified", x -> new Bucket()).hit(v);
            }
            if (isSelected) selected.hit(v);
            if ("expired".equals(o.state()) && !isAccepted && !isSelected && !isDeclined) expired.hit(v);
        }
        Agg madeAgg = k.agg("made", made, 0);
        Agg acceptedAgg = k.agg("accepted", accepted, 0);
        Agg declinedAgg = k.agg("declined", declined, 0);
        Agg expiredAgg = k.agg("expired", expired, 0);
        Agg selectedAgg = k.agg("selected", selected, 0);
        List<Group> byReason = k.groups(reasons, null);
        k.relations.add(Relation.partition(madeAgg.cell(),
                List.of(acceptedAgg.cell(), declinedAgg.cell(), expiredAgg.cell(), selectedAgg.cell())));
        k.relations.add(Relation.partition(declinedAgg.cell(), cells(byReason)));

        // Stock by model: released counts available cars; held and allocated keep their own states.
        Map<String, Bucket[]> stock = new TreeMap<>();
        Set<String> allocatedCars = new HashSet<>();
        Set<String> heldCars = new HashSet<>();
        for (Hold h : s.holds()) {
            if ("allocated".equals(h.state())) allocatedCars.add(h.orderUuid());
            else if (OCCUPYING.contains(h.state())) heldCars.add(h.orderUuid());
        }
        for (Car car : s.cars()) {
            Bucket[] row = stock.computeIfAbsent(stockModel(car), x -> new Bucket[] {new Bucket(), new Bucket(), new Bucket()});
            switch (status(car, allocatedCars, heldCars, asOf)) {
                case "available" -> row[0].hit(List.of());
                case "held" -> row[1].hit(List.of());
                case "allocated" -> row[2].hit(List.of());
                default -> { }
            }
        }
        Map<String, Agg[]> stockAggs = new LinkedHashMap<>();
        stock.keySet().stream().sorted(k.collator::compare).forEach(key -> {
            Bucket[] b = stock.get(key);
            stockAggs.put(key, new Agg[] {k.agg(key, b[0], 0), k.agg(key, b[1], 0), k.agg(key, b[2], 0)});
        });

        // One occupying hold per car, so held cells are parts of the active holds; allocated cells of the allocated state.
        k.relations.add(Relation.partition(holdsActive.cell(), stockAggs.values().stream().map(a -> a[1].cell()).toList()));
        byState.stream().filter(g -> "allocated".equals(g.key())).findFirst().ifPresent(g -> k.relations
                .add(Relation.partition(g.agg().cell(), stockAggs.values().stream().map(a -> a[2].cell()).toList())));

        k.freeze();

        ObjectNode value = Demand.obj();
        value.put("runId", scope.runId());
        value.put("asOf", ISO.format(asOf.truncatedTo(ChronoUnit.MILLIS)));
        ObjectNode versions = Demand.obj();
        ArrayNode vb = versions.putArray("brief");
        k.topBrief.forEach(vb::add);
        ArrayNode vp = versions.putArray("policy");
        k.topPolicy.forEach(vp::add);
        versions.put("revision", s.revision());
        ObjectNode demand = Demand.obj();
        demand.set("activeBriefs", k.count(activeBriefs));
        demand.set("byModelLine", k.list(byModelLine, true));
        demand.set("byBody", k.list(byBody, true));
        demand.set("byFuel", k.list(byFuel, true));
        demand.set("essentials", k.list(essentialGroups, false));
        ObjectNode unmetNode = demand.putObject("unmet");
        unmetNode.set("total", k.count(unmetAgg));
        unmetNode.set("byGate", k.list(byGate, true));
        ObjectNode holdsNode = Demand.obj();
        holdsNode.set("total", k.count(holdsTotal));
        holdsNode.set("active", k.count(holdsActive));
        holdsNode.set("byState", k.list(byState, true));
        holdsNode.set("byType", k.list(byType, true));
        ObjectNode offersNode = Demand.obj();
        offersNode.set("made", k.count(madeAgg));
        offersNode.set("accepted", k.count(acceptedAgg));
        offersNode.set("declined", k.count(declinedAgg));
        offersNode.set("expired", k.count(expiredAgg));
        offersNode.set("selected", k.count(selectedAgg));
        offersNode.set("declinedByReason", k.list(byReason, true));
        ObjectNode stockNode = Demand.obj();
        ArrayNode stockList = stockNode.putArray("byModelLine");
        stockAggs.forEach((key, a) -> {
            ObjectNode o = stockList.addObject();
            o.put("key", key);
            o.set("released", k.count(a[0]));
            o.set("held", k.count(a[1]));
            o.set("allocated", k.count(a[2]));
        });
        stockNode.set("source", s.source());

        ObjectNode identity = Demand.obj();
        identity.put("runId", scope.runId()).put("revision", s.revision()).put("policyVersion", rules.policyVersion());
        identity.set("threshold", rules.threshold());
        identity.put("thresholdStatus", rules.thresholdStatus());
        identity.set("declineReasons", rules.declineReasons());
        identity.set("declinedCarExclusion", rules.declinedCarExclusion());
        identity.set("recommendationEssentials", rules.recommendationEssentials());
        identity.set("allocationRule", rules.allocationRule());
        identity.set("demand", demand);
        identity.set("holds", holdsNode);
        identity.set("offers", offersNode);
        identity.set("stock", stockNode);

        value.put("projectionVersion", Canonical.digest(identity));
        value.put("basis", "expressed-saved-demand");
        value.set("versions", versions);
        ObjectNode privacy = value.putObject("privacy");
        privacy.put("thresholdKey", THRESHOLD_KEY).put("threshold", n).put("policyVersion", rules.policyVersion());
        privacy.put("status", rules.thresholdStatus());
        privacy.put("withheld", k.withheld());
        value.set("demand", demand);
        value.set("holds", holdsNode);
        value.set("offers", offersNode);
        value.set("stock", stockNode);
        return new DemandResult.Ok(value);
    }

    private static List<Cell> cells(List<Group> groups) {
        return groups.stream().map(g -> g.agg().cell()).toList();
    }

    private static boolean decided(List<DecisionRow> ds, String decision) {
        return ds.stream().anyMatch(d -> decision.equals(d.decision()));
    }

    private static JsonNode nodeOrNull(JsonNode n) {
        return n == null ? Demand.M.nullNode() : n;
    }

    // ---- demand values ----

    /** A confirmed essential value, else a confirmed non-indifferent preference value, else "unspecified". */
    static JsonNode desired(JsonNode content, String field) {
        JsonNode e = content.path("essentials").path(field);
        if ("confirmed".equals(e.path("state").asText(null)) && e.hasNonNull("value")) return e.get("value");
        JsonNode p = content.path("preferences").path(field);
        if ("confirmed".equals(p.path("valueState").asText(null)) && "confirmed".equals(p.path("importanceState").asText(null))
                && p.path("importance").isNumber() && p.get("importance").asDouble() > 0 && p.has("value")) return p.get("value");
        return Demand.M.getNodeFactory().textNode(UNSPECIFIED);
    }

    private static String text(JsonNode v) {
        if (v.isTextual()) return v.asText();
        if (v.isArray()) {
            List<String> parts = new ArrayList<>();
            v.forEach(x -> parts.add(x.isTextual() ? x.asText() : x.toString()));
            return String.join(",", parts);
        }
        return v.isValueNode() ? v.asText() : v.toString();
    }

    /** One key per chosen value; a multiple choice counts the brief once under each value. */
    private static List<String> values(JsonNode v) {
        if (!v.isArray()) return List.of(text(v));
        Set<String> out = new TreeSet<>();
        v.forEach(x -> out.add(x.isTextual() ? x.asText() : x.toString()));
        return out.isEmpty() ? List.of(text(v)) : new ArrayList<>(out);
    }

    private static JsonNode requirementValue(JsonNode e) {
        JsonNode v = e.get("value");
        if (v == null) return Demand.M.nullNode();
        if ("includes".equals(e.path("operator").asText(null)) && v.isArray()) {
            Map<String, JsonNode> byText = new TreeMap<>();
            v.forEach(x -> byText.put(x.isTextual() ? x.asText() : x.toString(), x));
            ArrayNode out = Demand.arr();
            byText.values().forEach(out::add);
            return out;
        }
        return v;
    }

    // ---- stock ----

    private static String stockModel(Car car) {
        JsonNode line = Demand.known(car.modelLine());
        if (line != null && line.isTextual()) return line.asText();
        JsonNode key = Demand.known(car.eligibilityModelKey());
        if (key != null && key.isTextual()) {
            String t = key.asText();
            int bar = t.indexOf('|');
            return bar < 0 ? t : t.substring(0, bar);
        }
        return "unconfirmed";
    }

    /** Exactly one status per car: allocated, else held, else available while the source interval is open, else unavailable. */
    static String status(Car car, Set<String> allocated, Set<String> held, Instant asOf) {
        if (allocated.contains(car.orderUuid())) return "allocated";
        if (held.contains(car.orderUuid())) return "held";
        JsonNode a = car.availability();
        if (a == null || !"available".equals(a.path("state").asText(null))) return "unavailable";
        JsonNode until = a.get("availableUntil");
        if (until == null || until.isNull()) return "available";
        try {
            return until.isTextual() && OffsetDateTime.parse(until.asText()).toInstant().isAfter(asOf) ? "available" : "unavailable";
        } catch (RuntimeException e) {
            return "unavailable";
        }
    }

    private static boolean visible(JsonNode v, Employee e, String employeeId) {
        if (v == null || !v.path("companyIds").isArray() || !v.path("schemeIds").isArray()) return false;
        JsonNode who = v.get("employeeIds");
        return contains(v.get("companyIds"), e.companyId()) && contains(v.get("schemeIds"), e.schemeId())
                && who != null && (who.isNull() || who.isArray() && contains(who, employeeId));
    }

    private static boolean contains(JsonNode array, String value) {
        for (JsonNode x : array) if (x.isTextual() && x.asText().equals(value)) return true;
        return false;
    }

    // ---- unmet demand ----

    /** The gates of every brief with no eligible car, in brief order. */
    private Map<Brief, List<String>> unmet(DemandScope scope, Instant asOf, Snapshot s, Map<String, Brief> byEmployee,
            Set<String> reasonCodes) {
        Map<Brief, List<String>> out = new LinkedHashMap<>();
        for (Brief b : s.briefs()) {
            Employee e = s.owners().get(b.employeeId());
            if (e == null || e.companyId() == null || e.schemeId() == null) throw new Unavailable("brief-owner-unavailable");
        }
        Set<String> allocated = new HashSet<>();
        Set<String> held = new HashSet<>();
        for (Hold h : s.holds()) {
            if ("allocated".equals(h.state())) allocated.add(h.orderUuid());
            else if (OCCUPYING.contains(h.state())) held.add(h.orderUuid());
        }
        // Cars grouped by distinct visibility, so the per-employee check costs distinct visibilities, not cars.
        Map<JsonNode, List<CarCandidate>> byVisibility = new LinkedHashMap<>();
        for (Car car : s.cars()) {
            byVisibility.computeIfAbsent(car.visibility() == null ? Demand.M.nullNode() : car.visibility(), x -> new ArrayList<>())
                    .add(new CarCandidate(car.orderUuid(), "available".equals(status(car, allocated, held, asOf)) ? "available" : "unavailable"));
        }
        List<BriefCandidate> candidates = new ArrayList<>();
        Map<String, Brief> evaluated = new LinkedHashMap<>();
        Map<String, Set<String>> expected = new HashMap<>();
        for (Brief b : s.briefs()) {
            Employee e = s.owners().get(b.employeeId());
            List<CarCandidate> cars = new ArrayList<>();
            byVisibility.forEach((v, list) -> {
                if (visible(v, e, b.employeeId())) cars.addAll(list);
            });
            if (cars.isEmpty()) {
                out.put(b, List.of(s.cars().isEmpty() ? "no-released-stock" : "stock-not-visible"));
                continue;
            }
            candidates.add(new BriefCandidate(b.employeeId(), b.version(), b.content(), e.companyId(), e.schemeId(), cars));
            evaluated.put(b.employeeId(), b);
            Set<String> uuids = new HashSet<>();
            cars.forEach(c -> uuids.add(c.orderUuid()));
            expected.put(b.employeeId(), uuids);
        }
        if (candidates.isEmpty()) return out;
        Evaluation evaluation;
        try {
            evaluation = unmet.evaluate(scope, candidates, asOf);
        } catch (RuntimeException ex) {
            throw new Unavailable("evaluation-unavailable");
        }
        if (!(evaluation instanceof Evaluation.Ok ok)) throw new Unavailable("evaluation-unavailable");
        Map<String, Set<String>> declinedCars = declinedCars(s);
        for (Brief b : s.briefs()) {
            if (!evaluated.containsKey(b.employeeId())) continue;
            List<CarDecision> decisions = ok.byEmployee() == null ? null : ok.byEmployee().get(b.employeeId());
            if (!wellFormed(decisions, expected.get(b.employeeId()))) throw new Unavailable("evaluation-unavailable");
            Set<String> gates = new TreeSet<>();
            boolean eligible = false;
            for (CarDecision d : decisions) {
                List<Gate> blockers = new ArrayList<>(d.blockers() == null ? List.of() : d.blockers());
                String status = d.gateStatus();
                if (blocked(b, d.orderUuid(), declinedCars, s)) {
                    status = "ineligible";
                    blockers.add(new Gate("declined-unchanged", null));
                }
                if ("eligible".equals(status)) eligible = true;
                for (Gate g : blockers) gates.add(gate(g));
                if (d.unknowns() != null) d.unknowns().forEach(g -> gates.add(gate(g)));
            }
            if (!eligible) out.put(b, new ArrayList<>(gates));
        }
        return out;
    }

    /** One decision with a status for every candidate car, and none for any other. */
    private static boolean wellFormed(List<CarDecision> decisions, Set<String> cars) {
        if (decisions == null) return false;
        Set<String> seen = new HashSet<>();
        for (CarDecision d : decisions) {
            if (d == null || d.gateStatus() == null || !cars.contains(d.orderUuid()) || !seen.add(d.orderUuid())) return false;
            if (hasNull(d.blockers()) || hasNull(d.unknowns())) return false;
        }
        return seen.size() == cars.size();
    }

    private static boolean hasNull(List<Gate> gates) {
        return gates != null && gates.stream().anyMatch(g -> g == null || g.code() == null);
    }

    private static String gate(Gate g) {
        return g.field() == null || g.field().isEmpty() ? g.code() : g.code() + ":" + g.field();
    }

    /** employeeId|orderUuid keys of cars the employee declined, to the decision versions in play. */
    private static Map<String, Set<String>> declinedCars(Snapshot s) {
        Map<String, OfferRow> offerById = new HashMap<>();
        s.offers().offers().forEach(o -> offerById.put(o.offerId(), o));
        Map<String, Set<String>> out = new HashMap<>();
        for (DecisionRow d : s.offers().decisions()) {
            OfferRow o = offerById.get(d.offerId());
            if (!"decline".equals(d.decision()) || o == null) continue;
            out.computeIfAbsent(d.employeeId() + "|" + o.orderUuid(), x -> new HashSet<>())
                    .add(d.briefVersion() == null ? "" : String.valueOf(d.briefVersion()));
        }
        return out;
    }

    /** Blocked unless every decline of this car was made on a brief whose intent differs from the current one. */
    private static boolean blocked(Brief current, String orderUuid, Map<String, Set<String>> declined, Snapshot s) {
        Set<String> versions = declined.get(current.employeeId() + "|" + orderUuid);
        if (versions == null) return false;
        String now = Canonical.digest(intent(current.content()));
        for (String v : versions) {
            JsonNode previous = v.isEmpty() ? null : v.equals(String.valueOf(current.version())) ? current.content()
                    : s.priorBriefs().get(current.employeeId() + "|" + v);
            if (previous == null || Canonical.digest(intent(previous)).equals(now)) return true;
        }
        return false;
    }

    /** What a pause, resume or timestamp change cannot alter: values, importances, states, operators and units. */
    static ObjectNode intent(JsonNode content) {
        ObjectNode out = Demand.obj();
        ObjectNode prefs = out.putObject("preferences");
        for (var e : content.path("preferences").properties()) {
            JsonNode p = e.getValue();
            ObjectNode o = prefs.putObject(e.getKey());
            JsonNode v = p.get("value");
            if (v != null) o.set("value", v.isArray() && v.size() == 1 ? v.get(0) : v);
            for (String f : List.of("importance", "valueState", "importanceState")) if (p.has(f)) o.set(f, p.get(f));
        }
        ObjectNode essentials = out.putObject("essentials");
        for (var e : content.path("essentials").properties()) {
            JsonNode r = e.getValue();
            ObjectNode o = essentials.putObject(e.getKey());
            if (r.has("value")) o.set("value", requirementValue(r));
            for (String f : List.of("operator", "unit", "state")) if (r.has(f)) o.set(f, r.get(f));
        }
        return out;
    }
}
