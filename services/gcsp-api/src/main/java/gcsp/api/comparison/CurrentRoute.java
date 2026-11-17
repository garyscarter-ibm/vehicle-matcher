package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.claims.ClaimResult;
import gcsp.api.claims.ClaimScope;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;

/** Port of server/gcsp/comparison/routes/current.js: today's first-come-first-served release for the whole cohort. */
final class CurrentRoute {

    private static final String ROUTE_KEY = "comparison.manualRoute.v1";
    private static final String THRESHOLD_KEY = "comparison.acceptableFitThreshold";
    private static final String HOLD_KEY = "hold.cart.durationSeconds";
    private static final String REVIEW_KEY = "hold.cart.orderReview.durationSeconds";
    static final int RELEASE = 0;
    static final int EXPIRY = 1;
    static final int ACCESS = 2;
    static final int CLAIM = 3;
    static final int DECISION = 4;
    // The route rules this replay implements; any other policy value is refused, never approximated.
    private static final Map<String, String> SUPPORTED = Map.ofEntries(
            Map.entry("accessEvent", "once-per-release-at-generated-accessSeconds-until-taken-or-renewal"),
            Map.entry("accessTies", "employeeId-ascending"),
            Map.entry("candidateGate", "stated-brief-eligible-and-fit-at-or-above-threshold"),
            Map.entry("candidateOrder", "stated-fit-descending-then-orderUuid"),
            Map.entry("conflict", "refresh-listing-and-claim-next-candidate"),
            Map.entry("acceptance", "underlying-gates-and-fit-at-or-above-threshold"),
            Map.entry("acceptedHold", "order-review-then-allocate"),
            Map.entry("unacceptableHold", "expire-without-taking"),
            Map.entry("abandonedCar", "not-claimed-again-by-that-employee"),
            Map.entry("expiryReentry", "next-modelled-access-event"),
            Map.entry("renewalDeadline", "inclusive"));
    private static final List<String> EVENT_ORDER = List.of("release", "expiry", "access", "claim", "decision");

    record Rules(long listingToClaimSeconds, long decisionSeconds, double threshold, List<JsonNode> rows) {}

    @FunctionalInterface
    interface Step {
        void run(long at);
    }

    /** Runs once a release has applied, before anyone acts on it (Node's afterRelease). */
    @FunctionalInterface
    interface AfterRelease {
        void run(JsonNode release, long at);
    }

    private record Event(long at, int rank, String employeeId, long seq, Step apply) {}

    private static final class Session {
        final Set<String> attempted = new HashSet<>();
        Map<String, ObjectNode> listing = new HashMap<>();
    }

    private static final class Hold {
        String holdId;
        String employeeId;
        String orderUuid;
        long claimedAt;
        long expiresAt;
        String status = "active";
    }

    static final class Person {
        JsonNode employee;
        String id;
        long renewalMs;
        ClaimScope scope;
        String takenOrderUuid;
        long takenAt;
        Double statedFit;
        Double underlyingFit;
        int claims;
        int retries;
        int expiries;
        int sessions;
        int claimSeq;
        final Set<String> abandoned = new HashSet<>();
        Session session;
        Hold hold;
        List<String> stated;
        String orderingClosedAt;
    }

    static final class Car {
        String releaseId;
        boolean released;
        String allocatedTo;
        String allocatedAt;
        int holdsNotTaken;
        long heldSeconds;
        boolean everHeld;
        long untilMs;
    }

    private final ReplayRun run;
    private final SeedEvaluation evaluation;
    private final ReplaySelection selection;
    private final String route;
    private final Rules rules;
    private final Set<String> actors;
    private AfterRelease afterRelease = (release, at) -> {};
    final Map<String, Person> people = new LinkedHashMap<>();
    final Map<String, Car> cars = new HashMap<>();
    private final Map<String, Hold> holds = new LinkedHashMap<>();
    private final PriorityQueue<Event> queue = new PriorityQueue<>(Comparator.comparingLong(Event::at)
            .thenComparingInt(Event::rank).thenComparing(Event::employeeId).thenComparingLong(Event::seq));
    private long now;
    private long seq;
    private int ticks;

    private CurrentRoute(ReplayRun run, SeedEvaluation evaluation, ReplaySelection selection, String route, Rules rules,
            Set<String> actors) {
        this.run = run;
        this.evaluation = evaluation;
        this.selection = selection;
        this.route = route;
        this.rules = rules;
        this.actors = actors;
    }

    /** Replays the whole cohort through Java claims and returns the outcome record (Node replayCurrentRoute). */
    static ObjectNode replay(ReplayRun run, SeedEvaluation evaluation, ReplaySelection selection, String codeRevision) {
        Rules rules = readRules(run, evaluation);
        CurrentRoute route = open(run, evaluation, selection, "current", null, rules);
        route.play();
        return route.record(codeRevision, rules.rows(), out -> {});
    }

    /** Sets up every employee and car; only the actor ids (null: everyone) get access events. */
    static CurrentRoute open(ReplayRun run, SeedEvaluation evaluation, ReplaySelection selection, String route,
            Set<String> actors, Rules rules) {
        CurrentRoute out = new CurrentRoute(run, evaluation, selection, route, rules, actors);
        out.start();
        return out;
    }

    void afterRelease(AfterRelease hook) {
        this.afterRelease = hook;
    }

    void play() {
        scheduleReleases();
        drain();
    }

    // ---- assumptions ----

    private static boolean posInt(JsonNode value) {
        return value != null && value.isIntegralNumber() && value.canConvertToLong() && value.longValue() > 0
                && value.longValue() <= 9007199254740991L;
    }

    static Rules readRules(ReplayRun run, SeedEvaluation evaluation) {
        PolicyRead read = new PolicyRead(run.runId, run.inputs.manifest().get("startsAt").textValue(), run.policyVersion);
        Map<String, JsonNode> rows = new HashMap<>();
        for (String key : List.of(HOLD_KEY, REVIEW_KEY, ROUTE_KEY, THRESHOLD_KEY)) {
            rows.put(key, ComparisonExperiments.assumption(run.policy, key, read));
        }
        JsonNode route = rows.get(ROUTE_KEY).get("value");
        JsonNode hold = rows.get(HOLD_KEY).get("value");
        JsonNode threshold = rows.get(THRESHOLD_KEY).get("value");
        boolean ok = route != null && route.isObject() && posInt(route.get("schemaVersion")) && route.get("schemaVersion").intValue() == 1
                && posInt(route.get("listingToClaimSeconds")) && posInt(route.get("decisionSeconds")) && posInt(hold)
                && route.get("decisionSeconds").longValue() < hold.longValue() && route.get("eventOrder") != null
                && route.get("eventOrder").isArray() && route.get("eventOrder").size() == EVENT_ORDER.size();
        if (ok) {
            for (int i = 0; i < EVENT_ORDER.size(); i++) ok &= EVENT_ORDER.get(i).equals(ReplayRecords.text(route.get("eventOrder").get(i)));
            for (Map.Entry<String, String> rule : SUPPORTED.entrySet()) ok &= rule.getValue().equals(ReplayRecords.text(route.get(rule.getKey())));
        }
        if (!ok) throw refuse("invalid-input", ROUTE_KEY);
        if (!posInt(rows.get(REVIEW_KEY).get("value"))) throw refuse("invalid-input", REVIEW_KEY);
        if (threshold == null || !threshold.isNumber() || !Double.isFinite(threshold.doubleValue())
                || threshold.doubleValue() != evaluation.threshold) throw refuse("invalid-input", THRESHOLD_KEY);
        List<JsonNode> sorted = new ArrayList<>(rows.values());
        sorted.sort((a, b) -> a.get("key").textValue().compareTo(b.get("key").textValue()));
        return new Rules(route.get("listingToClaimSeconds").longValue(), route.get("decisionSeconds").longValue(),
                threshold.doubleValue(), sorted);
    }

    // ---- setup ----

    private void start() {
        for (JsonNode employee : run.inputs.employees()) {
            Person person = new Person();
            person.employee = employee;
            person.id = employee.get("employeeId").textValue();
            person.renewalMs = ComparisonValidation.parseInstant(employee.get("renewalAt").textValue()).getAsLong();
            person.scope = run.scope(person.id);
            people.put(person.id, person);
            selection.checkReady(person.id);
        }
        for (ReplayStock.Row row : run.stock) {
            Car car = new Car();
            car.releaseId = row.releaseId();
            car.untilMs = row.untilMs();
            cars.put(row.orderUuid(), car);
        }
        run.installClaims(selection);
        now = run.clock.now().toEpochMilli();
    }

    void schedule(long at, int rank, String employeeId, Step apply) {
        queue.add(new Event(at, rank, employeeId, ++seq, apply));
    }

    private void scheduleReleases() {
        for (JsonNode release : run.inputs.releaseSchedule()) {
            long at = ComparisonValidation.parseInstant(release.get("at").textValue()).getAsLong();
            schedule(at, RELEASE, "", when -> {
                if (run.clock.now().toEpochMilli() < at) throw refuse("invalid-input", "release-not-due");
                List<String> ids = new ArrayList<>();
                release.get("orderUuids").forEach(id -> ids.add(id.textValue()));
                run.release(release.get("releaseId").textValue(), ids);
                for (String id : ids) cars.get(id).released = true;
                afterRelease.run(release, when);
                List<Person> byId = new ArrayList<>(people.values());
                byId.sort((a, b) -> a.id.compareTo(b.id));
                for (Person person : byId) {
                    if (actors != null && !actors.contains(person.id)) continue;
                    long access = when + (long) person.employee.get("accessSeconds").doubleValue() * 1000;
                    if (person.takenOrderUuid == null && access <= person.renewalMs) schedule(access, ACCESS, person.id, t -> access(person, t));
                }
            });
        }
    }

    // ---- events ----

    void drain() {
        while (!queue.isEmpty()) {
            if (Thread.interrupted()) throw new ComparisonInterrupted();
            Event event = queue.poll();
            advance(event.at());
            if (event.rank() > RELEASE) settle();
            event.apply().run(event.at());
        }
        long last = now;
        for (Hold hold : holds.values()) if (hold.status.equals("active")) last = Math.max(last, hold.expiresAt);
        advance(last);
        settle();
    }

    private void advance(long at) {
        if (at < now) throw refuse("invalid-input", "event-order");
        if (at > now) {
            run.clock.advanceTo(java.time.Instant.ofEpochMilli(at));
            now = at;
        }
    }

    // Node's tick: the manual-expiry handler expires every due hold, then each is read back.
    private void settle() {
        List<Hold> due = new ArrayList<>();
        for (Hold hold : holds.values()) if (hold.status.equals("active") && hold.expiresAt <= now) due.add(hold);
        if (due.isEmpty()) return;
        ticks++;
        run.expireDue();
        Map<String, String> states = run.holdStates(due.stream().map(h -> h.holdId).toList());
        for (Hold hold : due) {
            if (!"expired".equals(states.get(hold.holdId))) throw refuse("expiry-not-applied", hold.holdId);
            Person person = people.get(hold.employeeId);
            hold.status = "expired";
            person.hold = null;
            person.expiries++;
            Car car = cars.get(hold.orderUuid);
            car.holdsNotTaken++;
            car.heldSeconds += (hold.expiresAt - hold.claimedAt) / 1000;
        }
    }

    private List<String> listing(Person person, Session session) {
        if (person.stated == null) person.stated = evaluation.statedCandidates(person.id);
        List<String> open = new ArrayList<>();
        for (String id : person.stated) {
            Car car = cars.get(id);
            if (!person.abandoned.contains(id) && !session.attempted.contains(id) && car.released && car.allocatedTo == null) open.add(id);
        }
        if (open.isEmpty()) return List.of();
        ReplaySelection.Browse browse = selection.browse(person.id);
        // FUCQ-66 refuses ordering once no collection date fits its lead time before the contract end.
        if (List.of("ordering-closed", "not-yet-eligible").contains(browse.state())) {
            if (person.orderingClosedAt == null) person.orderingClosedAt = PolicyClock.iso(java.time.Instant.ofEpochMilli(now));
            return List.of();
        }
        if (!"ready".equals(browse.state())) throw refuse("conflict", "browse-stock");
        // One set read for the listing's stock versions; a car a hold occupies is not offered.
        session.listing = new HashMap<>();
        List<String> offered = new ArrayList<>();
        for (ReplayRun.CarState state : run.carStates(open)) {
            if (!state.state().equals("released") || state.holder() != null) continue;
            ObjectNode input = selection.claimInput(browse, state.orderUuid(), state.version());
            if (input == null) continue;
            session.listing.put(state.orderUuid(), input);
            offered.add(state.orderUuid());
        }
        List<String> out = new ArrayList<>();
        for (String id : open) if (session.listing.containsKey(id)) out.add(id);
        return out;
    }

    private void access(Person person, long at) {
        if (person.takenOrderUuid != null || person.session != null || person.hold != null || person.orderingClosedAt != null) return;
        person.sessions++;
        Session session = person.session = new Session();
        List<String> first = listing(person, session);
        if (!first.isEmpty()) {
            String id = first.get(0);
            schedule(at + rules.listingToClaimSeconds() * 1000, CLAIM, person.id, when -> claim(person, id, when));
        } else {
            person.session = null;
        }
    }

    private void claim(Person person, String orderUuid, long at) {
        Session session = person.session;
        session.attempted.add(orderUuid);
        person.claimSeq++;
        ObjectNode input = session.listing.get(orderUuid).deepCopy();
        input.put("commandId", route + ":" + person.id + ":claim:" + person.claimSeq);
        ClaimResult outcome = run.claims().claim(person.scope, input);
        if (outcome instanceof ClaimResult.Ok ok) {
            JsonNode held = ok.value().get("hold");
            if (parse(ok.value().get("now")) != at || !orderUuid.equals(held.get("orderUuid").textValue())) {
                throw refuse("invalid-input", "claim-mismatch");
            }
            person.claims++;
            Hold hold = new Hold();
            hold.holdId = held.get("holdId").textValue();
            hold.employeeId = person.id;
            hold.orderUuid = orderUuid;
            hold.claimedAt = parse(ok.value().get("now"));
            hold.expiresAt = parse(held.get("expiresAt"));
            holds.put(hold.holdId, hold);
            person.hold = hold;
            cars.get(orderUuid).everHeld = true;
            schedule(hold.expiresAt, EXPIRY, "", t -> settle());
            schedule(at + rules.decisionSeconds() * 1000, DECISION, person.id, when -> decide(person, hold, when));
            return;
        }
        if (!(outcome instanceof ClaimResult.Conflict)) throw refuse(statusOf(outcome), "claim");
        person.retries++;
        List<String> next = listing(person, session);
        if (!next.isEmpty()) {
            String id = next.get(0);
            schedule(at + rules.listingToClaimSeconds() * 1000, CLAIM, person.id, when -> claim(person, id, when));
        } else {
            person.session = null;
        }
    }

    private static String statusOf(ClaimResult result) {
        if (result instanceof ClaimResult.Invalid) return "invalid";
        if (result instanceof ClaimResult.NotFound) return "not-found";
        if (result instanceof ClaimResult.Forbidden) return "forbidden";
        if (result instanceof ClaimResult.Pending) return "pending";
        return "unavailable";
    }

    private static long parse(JsonNode instant) {
        return ComparisonValidation.parseInstant(instant.textValue()).getAsLong();
    }

    private ObjectNode step(Person person, String commandId) {
        ClaimResult current = run.claims().readClaim(person.scope);
        if (!(current instanceof ClaimResult.Ok ok)) throw refuse(statusOf(current), "read-claim");
        ObjectNode input = JSON.objectNode();
        input.put("commandId", commandId);
        input.set("holdId", ok.value().get("hold").get("holdId"));
        input.set("expectedHoldVersion", ok.value().get("hold").get("version"));
        input.set("expectedDraftVersion", ok.value().get("quote").get("draftVersion"));
        return input;
    }

    private void decide(Person person, Hold hold, long at) {
        person.session = null;
        if (!evaluation.acceptable(person.id, hold.orderUuid)) {
            person.abandoned.add(hold.orderUuid);
            return;
        }
        ClaimResult review = run.claims().beginReview(person.scope, step(person, route + ":" + person.id + ":review:" + person.claimSeq));
        if (!(review instanceof ClaimResult.Ok)) throw refuse(statusOf(review), "begin-review");
        ClaimResult allocated = run.claims().convertSelection(person.scope,
                step(person, route + ":" + person.id + ":allocate:" + person.claimSeq), tx -> WorkResult.ok(null));
        if (!(allocated instanceof ClaimResult.Ok)) throw refuse(allocated instanceof ClaimResult.Conflict c ? "conflict" : statusOf(allocated), "allocate");
        hold.status = "taken";
        person.hold = null;
        SeedEvaluation.GroupFit fit = evaluation.fit(person.id, hold.orderUuid);
        person.takenOrderUuid = hold.orderUuid;
        person.takenAt = at;
        person.statedFit = fit.stated().score();
        person.underlyingFit = fit.underlying().score();
        Car car = cars.get(hold.orderUuid);
        car.allocatedTo = person.id;
        car.allocatedAt = PolicyClock.iso(java.time.Instant.ofEpochMilli(at));
    }

    // ---- outcome record ----

    private static JsonNode number(Double value) {
        return value == null ? JSON.nullNode() : ReplayRecords.number(value);
    }

    ObjectNode record(String codeRevision, List<JsonNode> assumptionRows, java.util.function.Consumer<ObjectNode> extend) {
        ObjectNode manifest = run.inputs.manifest();
        ReplayRun.Persisted persisted = run.persisted();
        List<Person> ordered = new ArrayList<>(people.values());
        ordered.sort((a, b) -> a.id.compareTo(b.id));
        ArrayNode employees = JSON.arrayNode();
        int taken = 0;
        long claims = 0;
        long retries = 0;
        long expiries = 0;
        for (Person person : ordered) {
            ObjectNode row = employees.addObject();
            boolean took = person.takenOrderUuid != null;
            String takenAt = took ? PolicyClock.iso(java.time.Instant.ofEpochMilli(person.takenAt)) : null;
            row.set("seed", manifest.get("seed"));
            row.put("policyVersion", run.policyVersion);
            row.put("route", route);
            row.put("employeeId", person.id);
            row.set("accessGroup", person.employee.get("accessGroup"));
            row.put("outcome", took ? "taken" : "none-by-renewal");
            row.put("orderUuid", person.takenOrderUuid);
            row.put("takenAt", takenAt);
            row.put("takenDate", took ? takenAt.substring(0, 10) : null);
            row.set("renewalAt", person.employee.get("renewalAt"));
            if (took) {
                ObjectNode fit = row.putObject("fit");
                fit.set("stated", number(person.statedFit));
                fit.set("underlying", number(person.underlyingFit));
            } else {
                row.putNull("fit");
            }
            row.put("orderingClosedAt", person.orderingClosedAt);
            row.put("claims", person.claims);
            row.put("retries", person.retries);
            row.put("expiries", person.expiries);
            row.put("sessions", person.sessions);
            if (took) taken++;
            claims += person.claims;
            retries += person.retries;
            expiries += person.expiries;
        }
        List<String> ids = new ArrayList<>(cars.keySet());
        ids.sort(String::compareTo);
        ArrayNode carRows = JSON.arrayNode();
        int allocatedCars = 0;
        int heldCars = 0;
        for (String orderUuid : ids) {
            Car car = cars.get(orderUuid);
            int expired = persisted.expired().getOrDefault(orderUuid, 0);
            if (persisted.allocated().contains(orderUuid) != (car.allocatedTo != null) || expired != car.holdsNotTaken) {
                throw refuse("outcome-mismatch", orderUuid);
            }
            String outcome = car.allocatedTo != null ? "allocated" : car.everHeld ? "held-not-taken" : "unused";
            ObjectNode row = carRows.addObject();
            row.set("seed", manifest.get("seed"));
            row.put("policyVersion", run.policyVersion);
            row.put("route", route);
            row.put("orderUuid", orderUuid);
            row.put("releaseId", car.releaseId);
            row.put("outcome", outcome);
            row.put("allocatedTo", car.allocatedTo);
            row.put("allocatedAt", car.allocatedAt);
            row.put("holdsNotTaken", car.holdsNotTaken);
            row.put("heldNotTakenSeconds", car.heldSeconds);
            row.set("heldNotTakenDays", ReplayRecords.number(ComparisonValidation.round(car.heldSeconds / 86400.0 * 1e6) / 1e6));
            if (outcome.equals("allocated")) allocatedCars++;
            if (outcome.equals("held-not-taken")) heldCars++;
        }
        ObjectNode out = JSON.objectNode();
        out.put("schemaVersion", 1);
        out.put("route", route);
        out.set("seed", manifest.get("seed"));
        out.put("policyVersion", run.policyVersion);
        out.put("inputHash", run.inputHash);
        out.set("generatorVersion", manifest.get("generatorVersion"));
        out.set("policyHash", manifest.get("policyHash"));
        out.put("codeRevision", codeRevision);
        out.set("threshold", ReplayRecords.number(rules.threshold()));
        out.put("thresholdKey", THRESHOLD_KEY);
        ArrayNode assumptions = out.putArray("assumptions");
        for (JsonNode row : assumptionRows) {
            ObjectNode a = assumptions.addObject();
            for (String name : List.of("key", "value", "unit", "status", "basis", "source", "policyVersion")) {
                if (row.get(name) != null) a.set(name, row.get(name).deepCopy());
            }
        }
        ArrayNode limitations = out.putArray("limitations");
        limitations.add("Calculated fit is not observed satisfaction.");
        limitations.add("People, cars and behaviour are fictional and assumed; not BMW employee data or observed BMW operations.");
        run.adapterRow.get("value").get("limitations").forEach(limitations::add);
        out.set("employees", employees);
        out.set("cars", carRows);
        ObjectNode totals = out.putObject("totals");
        totals.put("employees", employees.size());
        totals.put("taken", taken);
        totals.put("noneByRenewal", employees.size() - taken);
        totals.put("claims", claims);
        totals.put("retries", retries);
        totals.put("expiries", expiries);
        totals.put("carsAllocated", allocatedCars);
        totals.put("carsHeldNotTaken", heldCars);
        totals.put("carsUnused", carRows.size() - allocatedCars - heldCars);
        extend.accept(out);
        return out;
    }
}
