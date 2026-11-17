package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.AllocationService;
import gcsp.api.allocation.BuddyExpiry;
import gcsp.api.allocation.ExpiryResult;
import gcsp.api.allocation.Trigger;
import gcsp.api.brief.BriefResult;
import gcsp.api.brief.BriefScope;
import gcsp.api.brief.BriefService;
import gcsp.api.identity.Principal;
import gcsp.api.notify.CapturedTransport;
import gcsp.api.notify.DispatchResult;
import gcsp.api.notify.NotificationDispatcher;
import gcsp.api.notify.PolicyDeliveryRules;
import gcsp.api.offers.ComparisonOfferPorts;
import gcsp.api.offers.OfferAccess;
import gcsp.api.offers.OfferOutcome;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Port of server/gcsp/comparison/routes/buddy.js: participants through allocation, offers and decisions; the rest as today. */
final class BuddyRoute {

    private static final String ROUTE_KEY = "comparison.buddyRoute.v1";
    private static final String HOLD_KEY = "hold.buddy.durationSeconds";
    private static final String REASONS_KEY = "offer.declineReasons.v1";
    private static final String SLIDER_KEY = "brief.slider.maximum";
    private static final List<String> EXTRA_KEYS = List.of(HOLD_KEY, REASONS_KEY, SLIDER_KEY, "allocation.tieBreak.rule",
            "offer.declinedCar.exclusion");
    // The route rules this replay implements; any other policy value is refused, never approximated.
    private static final Map<String, String> SUPPORTED = Map.ofEntries(
            Map.entry("participation", "generated-buddyParticipation"),
            Map.entry("consent", "search-and-hold-given-through-brief-service-with-stated-brief"),
            Map.entry("allocation", "at-each-release-through-allocation-service"),
            Map.entry("orderingWindow", "participant-pauses-when-manual-ordering-closes"),
            Map.entry("response", "offer-creation-plus-generated-responseSeconds"),
            Map.entry("offerExpiry", "buddy-hold-deadline"),
            Map.entry("acceptance", "underlying-gates-and-fit-at-or-above-threshold"),
            Map.entry("declineReason", "registered-reason-for-largest-importance-weighted-shortfall"),
            Map.entry("afterDeclineOrExpiry", "no-trigger-until-next-release-or-brief-change"),
            Map.entry("nonParticipants", "comparison.manualRoute.v1"));

    private record Assumptions(List<JsonNode> reasons, String fallback, double sliderMaximum, ObjectNode holdDuration,
            List<JsonNode> rows) {}

    private static final class Entry {
        String offerId;
        String employeeId;
        String orderUuid;
        long createdAt;
        long deadline;
        String status = "active";
    }

    private static final class Participant {
        CurrentRoute.Person person;
        JsonNode employee;
        BriefScope scope;
        Principal principal;
        long briefVersion;
        Entry active;
        boolean closed;
        int offers;
        int declines;
        int offerExpiries;
        int termsLapsed;
    }

    private static final class Counts {
        int offers;
        int declines;
        int offerExpiries;
        long declinedSeconds;
        long expiredSeconds;
    }

    private final ReplayRun run;
    private final SeedEvaluation evaluation;
    private final ReplaySelection selection;
    private final CurrentRoute route;
    private final Assumptions buddy;
    private final Map<String, Participant> participants = new LinkedHashMap<>();
    private final List<Entry> entries = new ArrayList<>();
    private final Map<String, Counts> counts = new HashMap<>();
    private final Map<String, Integer> declinesByReason = new LinkedHashMap<>();
    private final BriefService brief;
    /** Timing counters read by RouteReplayFullSizeTest: allocate calls, claimed contenders and time inside allocate. */
    static final java.util.concurrent.atomic.AtomicLong allocations = new java.util.concurrent.atomic.AtomicLong();
    static final java.util.concurrent.atomic.AtomicLong contenders = new java.util.concurrent.atomic.AtomicLong();
    static final java.util.concurrent.atomic.AtomicLong allocateNanos = new java.util.concurrent.atomic.AtomicLong();

    private final AllocationService allocation;
    private final BuddyExpiry expiry;
    private final NotificationDispatcher dispatcher;
    private final OfferAccess access;
    private final ComparisonOfferPorts.Decisions decisions;
    private int ticks;

    private BuddyRoute(ReplayRun run, SeedEvaluation evaluation, ReplaySelection selection, CurrentRoute route, Assumptions buddy) {
        this.run = run;
        this.evaluation = evaluation;
        this.selection = selection;
        this.route = route;
        this.buddy = buddy;
        BuddyBriefPorts ports = new BuddyBriefPorts(run, selection);
        PolicyClock clock = context -> run.clock.now();
        this.brief = new BriefService(run.pool(), ports, ports, ports, run.clock.asClock());
        this.allocation = new AllocationService(run.pool(), run.policy, new BuddyCandidates(run.policy));
        this.expiry = new BuddyExpiry(run.pool(), run.policy);
        this.dispatcher = new NotificationDispatcher(run.pool(), new PolicyDeliveryRules(run.policy),
                ComparisonOfferPorts.facts(run.pool()), new CapturedTransport(), run.clock.asClock(), run.environmentId,
                Optional.empty());
        this.access = ComparisonOfferPorts.access(run.pool(), clock);
        this.decisions = ComparisonOfferPorts.decisions(run.pool(), access, run.policy, clock);
        for (ReplayStock.Row row : run.stock) counts.put(row.orderUuid(), new Counts());
        for (JsonNode reason : buddy.reasons()) declinesByReason.put(reason.get("code").textValue(), 0);
    }

    // ---- assumptions ----

    private static Assumptions read(ReplayRun run, CurrentRoute.Rules manual) {
        PolicyRead read = new PolicyRead(run.runId, run.inputs.manifest().get("startsAt").textValue(), run.policyVersion);
        Map<String, JsonNode> rows = new LinkedHashMap<>();
        for (String key : concat(ROUTE_KEY, EXTRA_KEYS)) rows.put(key, ComparisonExperiments.assumption(run.policy, key, read));
        JsonNode route = rows.get(ROUTE_KEY).get("value");
        JsonNode registry = rows.get(REASONS_KEY).get("value");
        JsonNode holdSeconds = rows.get(HOLD_KEY).get("value");
        JsonNode maximum = rows.get(SLIDER_KEY).get("value");
        boolean ok = route != null && route.isObject() && route.path("schemaVersion").isIntegralNumber()
                && route.get("schemaVersion").longValue() == 1 && registry != null && registry.isObject()
                && registry.path("schemaVersion").isIntegralNumber() && registry.get("schemaVersion").longValue() == 1
                && registry.path("reasons").isArray();
        if (ok) {
            for (Map.Entry<String, String> rule : SUPPORTED.entrySet()) ok &= rule.getValue().equals(ReplayRecords.text(route.get(rule.getKey())));
            String fallback = ReplayRecords.text(route.get("declineReasonFallback"));
            boolean found = false;
            for (JsonNode reason : registry.get("reasons")) found |= fallback != null && fallback.equals(ReplayRecords.text(reason.get("code")));
            ok &= found;
        }
        if (!ok) throw refuse("invalid-input", ROUTE_KEY);
        if (holdSeconds == null || !holdSeconds.isIntegralNumber() || !holdSeconds.canConvertToLong() || holdSeconds.longValue() <= 0
                || holdSeconds.longValue() > 9007199254740991L) throw refuse("invalid-input", HOLD_KEY);
        if (maximum == null || !maximum.isNumber() || !Double.isFinite(maximum.doubleValue()) || maximum.doubleValue() <= 0) {
            throw refuse("invalid-input", SLIDER_KEY);
        }
        JsonNode hold = rows.get(HOLD_KEY);
        boolean overlay = hold.path("overlay").asBoolean(false);
        ObjectNode duration = JSON.objectNode();
        duration.put("key", HOLD_KEY);
        duration.set("holdDurationSeconds", holdSeconds);
        duration.put("overlay", overlay);
        duration.set("baselineValue", overlay ? hold.get("baselineValue") : holdSeconds);
        List<JsonNode> all = new ArrayList<>(manual.rows());
        all.addAll(rows.values());
        all.sort((a, b) -> a.get("key").textValue().compareTo(b.get("key").textValue()));
        List<JsonNode> reasons = new ArrayList<>();
        registry.get("reasons").forEach(reasons::add);
        return new Assumptions(reasons, ReplayRecords.text(route.get("declineReasonFallback")), maximum.doubleValue(), duration, all);
    }

    private static List<String> concat(String first, List<String> rest) {
        List<String> out = new ArrayList<>();
        out.add(first);
        out.addAll(rest);
        return out;
    }

    // ---- replay ----

    /** Replays the cohort with participants through Java allocation and offers; returns the outcome record. */
    static ObjectNode replay(ReplayRun run, SeedEvaluation evaluation, ReplaySelection selection, String codeRevision) {
        CurrentRoute.Rules manual = CurrentRoute.readRules(run, evaluation);
        Assumptions buddy = read(run, manual);
        Set<String> others = new java.util.HashSet<>();
        List<String> flagged = new ArrayList<>();
        for (JsonNode employee : run.inputs.employees()) {
            String id = employee.get("employeeId").textValue();
            if (employee.path("buddyParticipation").isBoolean() && employee.get("buddyParticipation").booleanValue()) flagged.add(id);
            else others.add(id);
        }
        CurrentRoute route = CurrentRoute.open(run, evaluation, selection, "buddy", others, manual);
        BuddyRoute buddyRoute = new BuddyRoute(run, evaluation, selection, route, buddy);
        return buddyRoute.play(flagged, codeRevision);
    }

    private ObjectNode play(List<String> flagged, String codeRevision) {
        run.onTick(() -> {
            ExpiryResult result = expiry.expire(new AllocationScope(run.environmentId, run.runId, run.policyVersion,
                    run.clock.now(), run.clock.version()));
            if (!(result instanceof ExpiryResult.Done)) throw refuse("tick-incomplete", "tick");
        });
        for (String id : flagged) {
            if (Thread.interrupted()) throw new ComparisonInterrupted();
            Participant p = new Participant();
            p.person = route.people.get(id);
            p.employee = run.employees.get(id);
            p.scope = new BriefScope(run.environmentId, run.runId, id, "comparison:" + id, run.policyVersion);
            p.principal = new Principal("comparison:" + id, List.of("employee"), run.environmentId, run.runId, id,
                    run.policyVersion, List.of());
            participants.put(id, p);
            confirmBrief(p);
        }
        route.afterRelease(this::afterRelease);
        route.play();
        for (Entry entry : entries) if (entry.status.equals("active")) throw refuse("offer-unsettled", "drain");
        ReplayRun.Notifications notified = run.notifications();
        if (notified.raised() != entries.size() || notified.captured() != notified.raised()) {
            throw refuse("notification-not-captured", "outbox");
        }
        return route.record(codeRevision, buddy.rows(), out -> extend(out, notified));
    }

    private static void must(BriefResult result, String boundary) {
        if (!(result instanceof BriefResult.Ok)) {
            throw refuse(result instanceof BriefResult.Refusal r ? r.status() : "unavailable", boundary);
        }
    }

    private void confirmBrief(Participant p) {
        String id = p.person.id;
        ObjectNode content = JSON.objectNode();
        content.put("schemaVersion", 1);
        JsonNode stated = p.employee.get("statedBrief");
        content.set("preferences", stated.get("preferences").deepCopy());
        content.set("essentials", stated.get("essentials").deepCopy());
        ObjectNode draft = JSON.objectNode();
        draft.put("commandId", "buddy:" + id + ":draft").put("expectedBriefVersion", 0).put("expectedDraftVersion", 0);
        draft.set("brief", content);
        must(brief.saveDraft(p.scope, draft), "brief-draft");
        ObjectNode confirm = JSON.objectNode();
        confirm.put("commandId", "buddy:" + id + ":confirm").put("expectedBriefVersion", 0).put("expectedDraftVersion", 1);
        confirm.putObject("consent").put("search", true).put("hold", true);
        must(brief.confirmWithoutGate(p.scope, confirm), "brief-confirm");
        p.briefVersion = 1;
    }

    // ---- events ----

    // The clock's buddy-expiry handler retires lapsed offers; this only triggers it and checks the result.
    private void expireDue(long now) {
        List<Entry> due = new ArrayList<>();
        for (Entry entry : entries) if (entry.status.equals("active") && entry.deadline <= now) due.add(entry);
        if (due.isEmpty()) return;
        List<String> ids = due.stream().map(e -> e.offerId).toList();
        Map<String, String> states = run.offerStates(ids);
        if (states.containsValue("active")) {
            // A manual-route tick at this instant may already have run the handler.
            ticks++;
            run.expireDue();
            states = run.offerStates(ids);
        }
        for (Entry entry : due) {
            if (!"expired".equals(states.get(entry.offerId))) throw refuse("expiry-not-applied", entry.offerId);
            Participant p = participants.get(entry.employeeId);
            entry.status = "expired";
            p.active = null;
            p.offerExpiries++;
            CurrentRoute.Car car = route.cars.get(entry.orderUuid);
            car.holdsNotTaken++;
            car.heldSeconds += (entry.deadline - entry.createdAt) / 1000;
            Counts count = counts.get(entry.orderUuid);
            count.offerExpiries++;
            count.expiredSeconds += (entry.deadline - entry.createdAt) / 1000;
        }
    }

    // A participant whose manual ordering window has closed (or renewal has passed) stops searching.
    private void closeOrdering(long at) {
        for (Participant p : participants.values()) {
            if (p.person.takenOrderUuid != null || p.active != null || p.closed) continue;
            var account = selection.account(p.person.id);
            if (!account.isOk()) throw refuse(account.status(), "account");
            String state = account.value().get("state").textValue();
            if (state.equals("ready")) continue;
            if (!List.of("ordering-closed", "not-yet-eligible").contains(state)) throw refuse("account-state", state);
            ObjectNode pause = JSON.objectNode();
            pause.put("commandId", "buddy:" + p.person.id + ":pause").put("expectedBriefVersion", p.briefVersion)
                    .put("expectedDraftVersion", 1);
            must(brief.pauseSearch(p.scope, pause), "brief-pause");
            p.briefVersion++;
            p.closed = true;
            p.person.orderingClosedAt = PolicyClock.iso(Instant.ofEpochMilli(at));
        }
    }

    // The same method the clock's buddy-allocation stage calls per trigger; the harness release writes no stock-release receipt.
    private void afterRelease(JsonNode release, long at) {
        expireDue(at);
        closeOrdering(at);
        List<String> orders = new ArrayList<>();
        release.get("orderUuids").forEach(id -> orders.add(id.textValue()));
        String releaseId = release.get("releaseId").textValue();
        long began = System.nanoTime();
        AllocationResult result = allocation.allocate(new AllocationScope(run.environmentId, run.runId, run.policyVersion,
                Instant.ofEpochMilli(at), run.clock.version()), new Trigger("stock-released", releaseId, List.of(), orders));
        allocateNanos.addAndGet(System.nanoTime() - began);
        allocations.incrementAndGet();
        if (!(result instanceof AllocationResult.Completed done)) throw refuse("unavailable", "allocation");
        contenders.addAndGet(done.outcome().path("attempts").size());
        JsonNode assignments = done.outcome().path("assignments");
        List<String> holdIds = new ArrayList<>();
        for (JsonNode a : assignments) holdIds.add(a.path("holdId").asText());
        Map<String, Long> deadlines = assignments.isEmpty() ? Map.of() : run.holdDeadlines(holdIds);
        for (JsonNode assignment : assignments) offerMade(assignment, at, deadlines);
        // The offer emails go to the captured transport only; nothing is sent.
        // A drain handles a bounded batch, so repeat until nothing more is due.
        while (!assignments.isEmpty()) {
            if (!(dispatcher.dispatchPending() instanceof DispatchResult.Counts counts) || counts.sent() + counts.retrying() + counts.failed() == 0) {
                break;
            }
        }
    }

    private void offerMade(JsonNode assignment, long at, Map<String, Long> deadlines) {
        Participant p = participants.get(assignment.path("employeeId").asText());
        String orderUuid = assignment.path("orderUuid").asText();
        Long deadline = deadlines.get(assignment.path("holdId").asText());
        if (p == null || deadline == null || !assignment.path("offerId").isTextual()) throw refuse("allocation-mismatch", orderUuid);
        Entry entry = new Entry();
        entry.offerId = assignment.get("offerId").textValue();
        entry.employeeId = p.person.id;
        entry.orderUuid = orderUuid;
        entry.createdAt = at;
        entry.deadline = deadline;
        entries.add(entry);
        p.active = entry;
        p.offers++;
        counts.get(orderUuid).offers++;
        route.cars.get(orderUuid).everHeld = true;
        long respondAt = at + (long) p.employee.get("responseSeconds").doubleValue() * 1000;
        if (respondAt < entry.deadline) route.schedule(respondAt, CurrentRoute.DECISION, entry.employeeId, when -> respond(p, entry, when));
        route.schedule(entry.deadline, CurrentRoute.EXPIRY, entry.employeeId, when -> expireDue(when));
    }

    // The registered reason for the underlying component with the largest importance-weighted shortfall.
    private String declineReason(String employeeId, String orderUuid) {
        SeedEvaluation.Component worst = null;
        double worstShortfall = 0;
        for (SeedEvaluation.Component component : evaluation.fit(employeeId, orderUuid).underlying().components()) {
            double shortfall = (buddy.sliderMaximum() - component.score().doubleValue()) * component.importance().doubleValue();
            if (shortfall > 0 && (worst == null || shortfall > worstShortfall
                    || shortfall == worstShortfall && component.field().compareTo(worst.field()) < 0)) {
                worst = component;
                worstShortfall = shortfall;
            }
        }
        if (worst != null) {
            for (JsonNode reason : buddy.reasons()) if (worst.facts().contains(reason.get("attribute").textValue())) return reason.get("code").textValue();
        }
        return buddy.fallback();
    }

    private void respond(Participant p, Entry entry, long at) {
        if (!entry.status.equals("active")) return;
        String id = p.person.id;
        boolean accept = evaluation.acceptable(id, entry.orderUuid);
        String reasonCode = accept ? null : declineReason(id, entry.orderUuid);
        OfferOutcome opened = access.read(p.principal, entry.offerId);
        if (opened.http() != 200) throw refuse(opened.status(), "offer-access");
        JsonNode view = opened.value();
        // The pinned terms can lapse before the hold does; the employee can then only decline, so a keen one lets it lapse.
        if (accept && Instant.parse(view.get("serverNow").textValue()).toEpochMilli()
                >= Instant.parse(view.get("quote").get("validUntil").textValue()).toEpochMilli()) {
            p.termsLapsed++;
            return;
        }
        ObjectNode body = JSON.objectNode();
        body.put("commandId", "buddy:" + id + ":decision").put("decision", accept ? "accept" : "decline");
        if (!accept) body.put("reasonCode", reasonCode);
        body.set("expectedOfferVersion", view.get("offerVersion"));
        body.set("expectedHoldVersion", view.get("holdVersion"));
        OfferOutcome decided = decisions.decide(p.principal, entry.offerId, body);
        if (decided.http() != 200) throw refuse(decided.status(), "offer-decision");
        if (!(accept ? "accepted" : "declined").equals(decided.value().path("state").asText())) throw refuse("decision-mismatch", entry.offerId);
        CurrentRoute.Car car = route.cars.get(entry.orderUuid);
        p.active = null;
        if (accept) {
            SeedEvaluation.GroupFit fit = evaluation.fit(id, entry.orderUuid);
            entry.status = "accepted";
            p.person.takenOrderUuid = entry.orderUuid;
            p.person.takenAt = at;
            p.person.statedFit = fit.stated().score();
            p.person.underlyingFit = fit.underlying().score();
            car.allocatedTo = id;
            car.allocatedAt = PolicyClock.iso(Instant.ofEpochMilli(at));
            return;
        }
        entry.status = "declined";
        p.declines++;
        declinesByReason.merge(reasonCode, 1, Integer::sum);
        Counts count = counts.get(entry.orderUuid);
        count.declines++;
        count.declinedSeconds += (at - entry.createdAt) / 1000;
    }

    // ---- outcome record ----

    private static double hours(double seconds) {
        return ComparisonValidation.round(seconds / 3600.0 * 1e6) / 1e6;
    }

    private void extend(ObjectNode out, ReplayRun.Notifications notified) {
        out.set("holdDuration", buddy.holdDuration());
        long offersMade = 0;
        long declines = 0;
        long offerExpiries = 0;
        long termsLapsed = 0;
        for (JsonNode row : out.get("employees")) {
            ObjectNode employee = (ObjectNode) row;
            Participant p = participants.get(employee.get("employeeId").textValue());
            employee.put("participant", p != null);
            employee.put("offers", p == null ? 0 : p.offers);
            employee.put("declines", p == null ? 0 : p.declines);
            employee.put("offerExpiries", p == null ? 0 : p.offerExpiries);
            employee.put("termsLapsed", p == null ? 0 : p.termsLapsed);
            if (p != null) {
                offersMade += p.offers;
                declines += p.declines;
                offerExpiries += p.offerExpiries;
                termsLapsed += p.termsLapsed;
            }
        }
        double buddySeconds = 0;
        double held = 0;
        double declined = 0;
        for (JsonNode row : out.get("cars")) {
            ObjectNode car = (ObjectNode) row;
            Counts c = counts.get(car.get("orderUuid").textValue());
            double seconds = c.expiredSeconds + c.declinedSeconds;
            car.put("offers", c.offers);
            car.put("declines", c.declines);
            car.put("offerExpiries", c.offerExpiries);
            car.set("buddyHeldNotTakenSeconds", ReplayRecords.number(seconds));
            car.set("buddyHeldNotTakenHours", ReplayRecords.number(hours(seconds)));
            buddySeconds += seconds;
            held += car.get("heldNotTakenSeconds").doubleValue();
            declined += c.declinedSeconds;
        }
        ArrayNode limitations = (ArrayNode) out.get("limitations");
        limitations.add("Acceptance is recorded as a local offer decision; the ordering handoff is not replayed.");
        limitations.add("After an offer expires the live service re-offers its car at once (FUCQ-227); this replay leaves it for the next release.");
        ObjectNode totals = (ObjectNode) out.get("totals");
        totals.put("participants", participants.size());
        totals.put("offersMade", offersMade);
        totals.put("offersAccepted", entries.stream().filter(e -> e.status.equals("accepted")).count());
        totals.put("declines", declines);
        ObjectNode reasons = totals.putObject("declinesByReason");
        declinesByReason.forEach(reasons::put);
        totals.put("offerExpiries", offerExpiries);
        totals.put("termsLapsed", termsLapsed);
        totals.put("notificationsCaptured", notified.raised());
        totals.set("buddyHeldNotTakenHours", ReplayRecords.number(hours(buddySeconds)));
        totals.set("heldNotTakenHours", ReplayRecords.number(hours(held + declined)));
    }
}
