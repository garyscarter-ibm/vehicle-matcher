package gcsp.api.demand;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.AllocationRecordsPort.RecordedDecision;
import gcsp.api.demand.DemandPolicyPort.DemandPolicy;
import gcsp.api.demand.DemandStore.Car;
import gcsp.api.demand.SuitabilityStore.Buddy;
import gcsp.api.demand.SuitabilityStore.PageCar;
import gcsp.api.demand.SuitabilityStore.PageHold;
import gcsp.api.demand.SuitabilityStore.Person;
import java.sql.Connection;
import java.text.Collator;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import javax.sql.DataSource;

/**
 * The presenter suitability view over native PostgreSQL (port of server/gcsp/presenter-suitability). It shows recorded
 * allocation decisions only: opening it never evaluates, claims or writes, and every read is one read-only snapshot.
 */
public final class SuitabilityService {

    static final int CAR_PAGE = 8;
    static final int BUDDY_PAGE = 4;
    private static final Set<String> RULES = Set.of("renewalDueThenFitThenSeededLottery", "fitThenRenewalDueThenSeededLottery");
    private static final Set<String> GATES = Set.of("eligible", "ineligible", "needs-confirmation");
    private static final Set<String> OCCUPYING = Set.of("active", "claim-pending", "release-pending", "selection-pending");
    private static final List<String> SCALARS = List.of("field", "desired", "observed", "score", "allowance", "monthlyPoints",
            "availableFrom", "requiredBy", "maximum", "actual");
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final DataSource dataSource;
    private final DemandPolicyPort policy;
    private final AllocationRecordsPort records;
    private final Clock clock;

    public SuitabilityService(DataSource dataSource, DemandPolicyPort policy, AllocationRecordsPort records, Clock clock) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.records = records;
        this.clock = clock;
    }

    /** A failure inside the snapshot that the caller reports as the one retryable 503. */
    private static final class Broken extends RuntimeException {
        Broken() {
            super("suitability-unavailable", null, false, false);
        }
    }

    /** What one snapshot captured for the requested page. */
    private record Captured(List<String> ids, int total, List<Buddy> buddies, List<String> pageIds, Map<String, PageCar> cars,
            List<PageHold> holds, List<RecordedDecision> decisions, Map<String, Person> people) {}

    /** No role check here: the HTTP layer requires the presenter before calling. Pages are 1 or more; release is all or latest. */
    public DemandResult read(DemandScope scope, int page, int buddyPage, String release) {
        if (page < 1 || buddyPage < 1 || !"all".equals(release) && !"latest".equals(release)) {
            throw new IllegalArgumentException("page and buddyPage start at 1; release is all or latest");
        }
        Instant asOf = clock.instant();
        try {
            String rule = allocationRule(scope, asOf);
            Captured got = capture(scope, page, buddyPage, "latest".equals(release));
            if (got == null) return DemandResult.Refusal.staleRun();
            return project(scope, release, asOf, rule, page, buddyPage, got);
        } catch (Exception e) {
            return DemandResult.Refusal.suitabilityUnavailable();
        }
    }

    /** The policy's tie-break rule when it is one the view names, else null; missing policy is not a failure. */
    private String allocationRule(DemandScope scope, Instant asOf) {
        Optional<DemandPolicy> p = policy.read(scope.policyVersion(), asOf);
        if (p.isEmpty() || !scope.policyVersion().equals(p.get().policyVersion())) return null;
        JsonNode rule = p.get().allocationRule();
        return rule != null && rule.isTextual() && RULES.contains(rule.asText()) ? rule.asText() : null;
    }

    // ---- the snapshot: one connection, repeatable read, read only ----

    private Captured capture(DemandScope scope, int page, int buddyPage, boolean latest) throws Exception {
        try (Connection c = dataSource.getConnection()) {
            boolean auto = c.getAutoCommit();
            boolean readOnly = c.isReadOnly();
            int isolation = c.getTransactionIsolation();
            try {
                c.setAutoCommit(false);
                c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                c.setReadOnly(true);
                if (DemandStore.activeRevision(c, scope).isEmpty()) return null;
                List<String> ids = new ArrayList<>(new LinkedHashSet<>(SuitabilityStore.releasedIds(c, scope, latest)));
                if (!ids.isEmpty() && SuitabilityStore.existing(c, scope, ids) != ids.size()) throw new Broken();
                List<Buddy> engaged = new ArrayList<>(SuitabilityStore.engaged(c, scope));
                Collator collator = Collator.getInstance(Locale.ROOT);
                engaged.sort(Comparator.comparing(Buddy::name, collator).thenComparing(Buddy::employeeId, collator));
                List<String> pageIds = slice(ids, page, CAR_PAGE);
                List<Buddy> buddies = slice(engaged, buddyPage, BUDDY_PAGE);
                Map<String, PageCar> cars = pageIds.isEmpty() ? Map.of() : SuitabilityStore.cars(c, scope, pageIds);
                List<PageHold> holds = pageIds.isEmpty() ? List.of() : SuitabilityStore.holds(c, scope, pageIds);
                List<RecordedDecision> decisions = List.of();
                if (!pageIds.isEmpty() && !buddies.isEmpty()) {
                    decisions = records.read(c, scope, buddies.stream().map(Buddy::employeeId).toList(), pageIds).orElseThrow(Broken::new);
                }
                Set<String> known = new HashSet<>();
                engaged.forEach(b -> known.add(b.employeeId()));
                Set<String> unknown = new LinkedHashSet<>();
                holds.forEach(h -> unknown.add(h.employeeId()));
                decisions.forEach(d -> {
                    if (d.assignedEmployeeId() != null) unknown.add(d.assignedEmployeeId());
                });
                unknown.removeAll(known);
                Map<String, Person> people = unknown.isEmpty() ? Map.of()
                        : SuitabilityStore.people(c, scope, new ArrayList<>(unknown));
                c.commit();
                return new Captured(ids, ids.size(), engaged, pageIds, cars, holds, decisions, people);
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

    private static <T> List<T> slice(List<T> rows, int page, int size) {
        int pages = pages(rows.size(), size);
        int p = Math.min(page, pages);
        return rows.subList(Math.min((p - 1) * size, rows.size()), Math.min(p * size, rows.size()));
    }

    private static int pages(int total, int size) {
        return Math.max(1, (total + size - 1) / size);
    }

    // ---- the projection ----

    private DemandResult project(DemandScope scope, String release, Instant asOf, String rule, int page, int buddyPage, Captured g) {
        List<Buddy> all = g.buddies();
        List<Buddy> buddies = slice(all, buddyPage, BUDDY_PAGE);
        Map<String, RecordedDecision> cells = new HashMap<>();
        for (RecordedDecision d : g.decisions()) {
            if (d.gateStatus() == null || !GATES.contains(d.gateStatus())) throw new Broken();
            cells.putIfAbsent(d.orderUuid() + "\u0000" + d.employeeId(), d);
        }
        Map<String, Buddy> buddyById = new HashMap<>();
        all.forEach(b -> buddyById.put(b.employeeId(), b));
        Map<String, PageHold> held = new HashMap<>();
        for (PageHold h : g.holds()) {
            PageHold seen = held.get(h.orderUuid());
            if (seen == null || "allocated".equals(h.state())) held.put(h.orderUuid(), h);
        }
        Set<String> peopleIds = new LinkedHashSet<>();
        ArrayNode carsOut = Demand.arr();
        for (String id : g.pageIds()) {
            PageCar car = g.cars().get(id);
            if (car == null) throw new Broken();
            ObjectNode n = carsOut.addObject();
            String colour = text(car.colour());
            n.put("id", id).put("name", carName(car, colour));
            putText(n, "orderNumber", text(car.orderNumber()));
            putText(n, "colour", colour);
            n.set("availability", availability(car, held.get(id), g, asOf));
            ArrayNode cellsOut = n.putArray("cells");
            for (Buddy b : buddies) {
                RecordedDecision d = cells.get(id + "\u0000" + b.employeeId());
                ObjectNode cell = cellsOut.addObject().put("employeeId", b.employeeId());
                if (d == null) {
                    cell.put("state", "not-evaluated");
                    continue;
                }
                cell.put("state", "evaluated").put("gateStatus", d.gateStatus());
                cell.set("score", score(d.score()));
                cell.set("blockers", evidence(d.blockers()));
                cell.set("unknowns", evidence(d.unknowns()));
                cell.set("reasons", evidence(d.reasons()));
                ObjectNode rec = cell.putObject("recorded");
                putText(rec, "evaluatedAt", d.evaluatedAt());
                if (d.briefVersion() == null) rec.putNull("briefVersion");
                else rec.put("briefVersion", d.briefVersion());
                putText(rec, "policyVersion", d.policyVersion());
                putText(rec, "allocationRule", d.allocationRule() != null && RULES.contains(d.allocationRule()) ? d.allocationRule() : null);
                cell.put("outdated", !Objects.equals(d.briefVersion(), b.briefVersion())
                        || !scope.policyVersion().equals(d.policyVersion())
                        || !Objects.equals(d.inputPermissionVersion(), b.permissionVersion())
                        || !Objects.equals(d.inputEmployeeVersion(), b.employeeVersion()));
                ObjectNode outcome = cell.putObject("outcome");
                if (d.assignedEmployeeId() != null) {
                    outcome.put("state", "assigned").put("employeeId", d.assignedEmployeeId());
                    peopleIds.add(d.assignedEmployeeId());
                } else {
                    outcome.put("state", d.employeeAssignedOtherCar() ? "assigned-other-car" : "not-assigned");
                }
            }
        }
        ObjectNode out = Demand.obj();
        out.put("runId", scope.runId()).put("asOf", ISO.format(asOf.truncatedTo(ChronoUnit.MILLIS))).put("release", release);
        ObjectNode pol = out.putObject("policy");
        pol.put("version", scope.policyVersion()).putNull("minimumFit");
        putText(pol, "allocationRule", rule);
        ObjectNode paging = out.putObject("paging");
        paging.set("cars", paging(page, g.total(), CAR_PAGE));
        paging.set("buddies", paging(buddyPage, all.size(), BUDDY_PAGE));
        ArrayNode buddiesOut = out.putArray("buddies");
        for (Buddy b : buddies) buddiesOut.addObject().put("id", b.employeeId()).put("name", b.name()).put("briefVersion", b.briefVersion());
        out.set("cars", carsOut);
        ArrayNode peopleOut = out.putArray("people");
        for (String id : peopleIds) peopleOut.addObject().put("id", id).put("name", personName(id, buddyById, g.people()));
        return new DemandResult.Ok(out);
    }

    private static ObjectNode paging(int requested, int total, int size) {
        int pages = pages(total, size);
        return Demand.obj().put("page", Math.min(requested, pages)).put("pages", pages).put("total", total).put("size", size);
    }

    private static String personName(String id, Map<String, Buddy> buddies, Map<String, Person> people) {
        Buddy b = buddies.get(id);
        return b != null ? b.name() : nameOf(id, people.get(id));
    }

    /** name, else first and last name joined, else the id. */
    static String nameOf(String employeeId, Person p) {
        if (p == null) return employeeId;
        String name = text(p.name());
        if (name != null) return name;
        String first = text(p.firstName());
        String last = text(p.lastName());
        String joined = first == null ? (last == null ? "" : last) : last == null ? first : first + " " + last;
        return joined.isEmpty() ? employeeId : joined;
    }

    private static String text(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static void putText(ObjectNode n, String key, String value) {
        if (value == null) n.putNull(key);
        else n.put(key, value);
    }

    /** display name, else the model line, else a generic label, with a trailing " in <colour>" removed. */
    private static String carName(PageCar car, String colour) {
        String name = text(car.displayName());
        if (name == null) name = text(car.modelLine());
        if (name == null) name = "Released car";
        String suffix = colour == null ? null : " in " + colour;
        return suffix != null && name.endsWith(suffix) ? name.substring(0, name.length() - suffix.length()) : name;
    }

    private ObjectNode availability(PageCar car, PageHold hold, Captured g, Instant asOf) {
        ObjectNode a = Demand.obj();
        if (hold != null) {
            a.put("state", "allocated".equals(hold.state()) ? "allocated" : OCCUPYING.contains(hold.state()) ? "reserved" : "unavailable");
            a.put("employeeId", hold.employeeId());
            a.put("employeeName", personName(hold.employeeId(), Map.of(), mergedPeople(g)));
            a.put("route", "buddy-offer".equals(hold.type()) ? "buddy" : "manual");
            return a;
        }
        Car stock = new Car(car.orderUuid(), car.state(), null, null, car.availability(), null);
        boolean available = "released".equals(car.state()) && "available".equals(DemandService.status(stock, Set.of(), Set.of(), asOf));
        return a.put("state", available ? "available" : "unavailable");
    }

    /** Names of every employee the page can mention: the engaged buddies and the extra lookups. */
    private static Map<String, Person> mergedPeople(Captured g) {
        Map<String, Person> all = new HashMap<>(g.people());
        for (Buddy b : g.buddies()) all.put(b.employeeId(), new Person(b.name(), null, null));
        return all;
    }

    /** A finite 0 to 100 number is kept (zero included); anything else is null. */
    private static JsonNode score(JsonNode s) {
        return s != null && s.isNumber() && Double.isFinite(s.doubleValue()) && s.doubleValue() >= 0 && s.doubleValue() <= 100
                ? s : Demand.M.nullNode();
    }

    /** Only fields used by plain explanation copy leave the server; nested facts and inputs never pass. */
    static ArrayNode evidence(JsonNode entries) {
        ArrayNode out = Demand.arr();
        if (entries == null || !entries.isArray()) return out;
        for (JsonNode e : entries) {
            if (e == null || !e.isObject() || !e.path("code").isTextual() || e.get("code").asText().isBlank()) continue;
            ObjectNode o = out.addObject();
            o.set("code", e.get("code"));
            for (String key : SCALARS) if (scalar(e.get(key))) o.set(key, e.get(key));
            JsonNode req = e.get("requirement");
            if (req != null && req.isContainerNode()) {
                ObjectNode r = o.putObject("requirement");
                for (String key : List.of("operator", "value", "unit")) {
                    JsonNode v = req.get(key);
                    if (scalar(v) || "value".equals(key) && v != null && v.isArray() && allText(v)) r.set(key, v);
                }
            }
        }
        return out;
    }

    private static boolean scalar(JsonNode n) {
        return n != null && (n.isTextual() || n.isNumber() || n.isBoolean());
    }

    private static boolean allText(JsonNode array) {
        for (JsonNode x : array) if (!x.isTextual()) return false;
        return true;
    }
}
