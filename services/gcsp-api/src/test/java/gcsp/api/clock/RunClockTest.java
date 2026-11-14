package gcsp.api.clock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.TextNode;
import gcsp.api.clock.ClockResult.Failure;
import gcsp.api.clock.ClockResult.Status;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RunClockTest {

    ClockFixture f;
    RunContext ctx;

    @BeforeEach
    void setUp() throws Exception {
        f = ClockFixture.create();
        ctx = f.ctx();
        FakeHandler.LOG.clear();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    static JsonNode value(ClockResult r) {
        assertTrue(r.ok(), () -> "expected ok but got " + r);
        return ((ClockResult.Ok) r).value();
    }

    static Failure failure(ClockResult r, Status status, String code) {
        Failure failure = assertInstanceOf(Failure.class, r, () -> "expected failure but got " + r);
        assertEquals(status, failure.status(), failure::toString);
        assertEquals(code, failure.code(), failure::toString);
        return failure;
    }

    static FakeHandler handler(String id, String stage) {
        return new FakeHandler(id, stage);
    }

    // configuration and initialize

    @Test
    void initializeDatesTheClockFromTheTemplateAndIsIdempotent() throws Exception {
        RunClock clock = f.clock(List.of());
        assertEquals(Optional.empty(), clock.now(ClockFixture.ENV, "run-1"));
        assertTrue(value(clock.initialize(ClockFixture.ENV, "run-1")).get("initialized").asBoolean());
        assertFalse(value(clock.initialize(ClockFixture.ENV, "run-1")).get("initialized").asBoolean());
        ClockReading reading = clock.now(ClockFixture.ENV, "run-1").orElseThrow();
        assertEquals(ClockFixture.START, reading.now());
        assertEquals(1, reading.clockVersion());
        assertEquals(1, f.count("SELECT count(*) FROM run_clocks"));
        JsonNode state = value(clock.state(ctx));
        assertEquals("2026-11-14T09:30:00.000Z", state.at("/namedTimes/release").asText());
        assertEquals("gcsp-clock-scenario-v1", state.get("scenarioVersion").asText());
        assertTrue(state.get("lastTick").isNull());
    }

    @Test
    void nowIsEmptyForARetiredRunAndForARunWithoutAClock() throws Exception {
        RunClock clock = f.started();
        retireAndReplace();
        assertEquals(Optional.empty(), clock.now(ClockFixture.ENV, "run-1"));
        assertEquals(Optional.empty(), clock.now(ClockFixture.ENV, "run-2"));
        failure(clock.state(ctx), Status.STALE_RUN, "stale-run");
        failure(clock.initialize(ClockFixture.ENV, "run-1"), Status.STALE_RUN, "stale-run");
        assertTrue(clock.initialize(ClockFixture.ENV, "run-2").ok());
        assertTrue(clock.now(ClockFixture.ENV, "run-2").isPresent());
    }

    @Test
    void aMissingPolicyKeyMakesTheClockUnavailableAndWritesNothing() throws Exception {
        for (String key : List.of(ClockConfiguration.SCENARIO, ClockConfiguration.COMMANDS, ClockConfiguration.STAGES,
                ClockConfiguration.STEP)) {
            RunClock clock = f.clock(ClockFixture.policyWithout(key), List.of());
            Failure failed = failure(clock.initialize(ClockFixture.ENV, "run-1"), Status.UNAVAILABLE,
                    "clock-policy-unavailable");
            assertTrue(failed.retryable());
            assertEquals(0, f.count("SELECT count(*) FROM run_clocks"));
        }
    }

    @Test
    void entriesFromDifferentPolicyVersionsAreRefused() throws Exception {
        // Version 2 replaces only the step entry, so the four entries resolve to two versions.
        var v1 = new gcsp.api.policy.RetainedFilePolicySource().loadVersions("run-1").get(0);
        var v2 = v1.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) v2).put("policyVersion", "gcsp-policy-v2");
        ((com.fasterxml.jackson.databind.node.ObjectNode) v2).put("effectiveFrom", "2026-11-05T00:00:00.000Z");
        var kept = ((com.fasterxml.jackson.databind.node.ObjectNode) v2).arrayNode();
        v2.get("assumptions").forEach(row -> {
            if (row.path("key").asText().equals(ClockConfiguration.STEP)) kept.add(rowFor(row, "gcsp-policy-v2"));
        });
        ((com.fasterxml.jackson.databind.node.ObjectNode) v2).set("assumptions", kept);
        PolicyService mixed = new PolicyService(runId -> List.of(v1, v2));
        ClockConfiguration.Loaded loaded = ClockConfiguration.read(mixed, "run-1", Instant.parse("2026-11-14T09:00:00Z"));
        assertFalse(loaded.ok(), () -> "expected refusal: " + loaded);
    }

    private static JsonNode rowFor(JsonNode row, String version) {
        var copy = row.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) copy).put("policyVersion", version);
        ((com.fasterxml.jackson.databind.node.ObjectNode) copy).put("effectiveFrom", "2026-11-05T00:00:00.000Z");
        return copy;
    }

    @Test
    void invalidPolicyFieldsAreRefused() throws Exception {
        record Edit(String key, String path, Object bad) {}
        List<Edit> edits = List.of(
                new Edit(ClockConfiguration.SCENARIO, "startsAt", "not-a-time"),
                new Edit(ClockConfiguration.SCENARIO, "scenarioVersion", ""),
                new Edit(ClockConfiguration.COMMANDS, "initialClockVersion", "0"),
                new Edit(ClockConfiguration.COMMANDS, "forwardOnly", false),
                new Edit(ClockConfiguration.COMMANDS, "startupStages", List.of("no-such-stage")),
                new Edit(ClockConfiguration.STAGES, null, List.of("a", "a")),
                new Edit(ClockConfiguration.STEP, "unit", "minutes"),
                new Edit(ClockConfiguration.STEP, "value", 0));
        for (Edit edit : edits) {
            PolicyService policy = new PolicyService(ClockFixture.editing(doc -> doc.withArray("assumptions").forEach(row -> {
                if (!edit.key().equals(row.path("key").asText())) return;
                var node = (com.fasterxml.jackson.databind.node.ObjectNode) row;
                var mapper = ClockRows.JSON;
                if (edit.path() == null) node.set("value", mapper.valueToTree(edit.bad()));
                else if (edit.key().equals(ClockConfiguration.STEP) || edit.key().equals(ClockConfiguration.STAGES)) {
                    node.set(edit.path(), mapper.valueToTree(edit.bad()));
                } else {
                    ((com.fasterxml.jackson.databind.node.ObjectNode) node.get("value")).set(edit.path(),
                            mapper.valueToTree(edit.bad()));
                }
            })));
            ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, "run-1", ClockFixture.START);
            assertFalse(loaded.ok(), () -> "expected refusal for " + edit);
        }
    }

    @Test
    void theRetainedPolicyYieldsTheSeededConfiguration() {
        ClockConfiguration.Loaded loaded = ClockConfiguration.read(new PolicyService(
                new gcsp.api.policy.RetainedFilePolicySource()), "run-1", ClockFixture.START);
        assertTrue(loaded.ok(), loaded::toString);
        ClockConfiguration c = loaded.configuration();
        assertEquals("gcsp-policy-v1", c.policyVersion());
        assertEquals(60, c.stepSeconds());
        assertEquals(List.of("manual-expiry", "buddy-expiry", "pending-reconciliation"), c.startupStages());
        assertEquals(6, c.stages().size());
        assertEquals(1, c.initialClockVersion());
    }

    // advance

    @Test
    void advanceBySecondsToANamedTimeAndToAnInstant() throws Exception {
        RunClock clock = f.started();
        JsonNode first = value(clock.advance(ctx, "a1", 1, 600L, null));
        assertEquals("2026-11-14T09:10:00.000Z", first.get("now").asText());
        assertEquals(2, first.get("clockVersion").asLong());
        JsonNode second = value(clock.advance(ctx, "a2", 2, null, "release"));
        assertEquals("2026-11-14T09:30:00.000Z", second.get("now").asText());
        JsonNode third = value(clock.advance(ctx, "a3", 3, null, "2026-11-14T12:00:00Z"));
        assertEquals("2026-11-14T12:00:00.000Z", third.get("now").asText());
        assertEquals(4, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
    }

    @Test
    void advanceRefusesBackwardsEqualMalformedAndBothOrNeither() throws Exception {
        RunClock clock = f.started();
        failure(clock.advance(ctx, "b1", 1, null, "2026-11-14T08:00:00Z"), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b2", 1, null, "2026-11-14T09:00:00Z"), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b3", 1, null, "tomorrow"), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b4", 1, 0L, null), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b5", 1, -5L, null), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b6", 1, 5L, "release"), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, "b7", 1, null, null), Status.INVALID, "invalid-clock-command");
        failure(clock.advance(ctx, " ", 1, 5L, null), Status.INVALID, "invalid-clock-command");
        assertEquals(1, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts WHERE command_type = 'clock.advance'"));
    }

    @Test
    void advanceWithAStaleVersionConflictsAndReportsTheCurrentVersion() throws Exception {
        RunClock clock = f.started();
        assertTrue(clock.advance(ctx, "c1", 1, 60L, null).ok());
        Failure stale = failure(clock.advance(ctx, "c2", 1, 60L, null), Status.CONFLICT, "stale-version");
        assertEquals(2L, stale.currentVersion());
        assertEquals(2, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
    }

    @Test
    void advanceReplaysTheSameCommandAndRefusesChangedInput() throws Exception {
        RunClock clock = f.started();
        JsonNode first = value(clock.advance(ctx, "d1", 1, 60L, null));
        JsonNode again = value(clock.advance(ctx, "d1", 1, 60L, null));
        assertEquals(gcsp.api.persistence.Canonical.json(first), gcsp.api.persistence.Canonical.json(again));
        assertEquals(2, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
        failure(clock.advance(ctx, "d1", 1, 120L, null), Status.CONFLICT, "command-input-changed");
    }

    @Test
    void advanceOnARetiredRunIsStale() throws Exception {
        RunClock clock = f.started();
        retireAndReplace();
        failure(clock.advance(ctx, "e1", 1, 60L, null), Status.STALE_RUN, "stale-run");
    }

    @Test
    void theClockNeverMovesBackwardInTheDatabase() throws Exception {
        f.started();
        assertThrows(SQLException.class, () -> f.update("UPDATE run_clocks SET clock_version = 0 + 1 - 1 "
                + "WHERE run_id = 'run-1'"));
        assertThrows(SQLException.class, () -> f.update("UPDATE run_clocks SET clock_instant = clock_instant - interval '1 second'"));
        assertThrows(SQLException.class, () -> f.update("DELETE FROM run_clocks"));
    }

    // tick

    @Test
    void tickOrdersHandlersByStageThenIdAndRecordsMissingStages() throws Exception {
        FakeHandler pull = handler("zz-pull", "release-pull");
        FakeHandler expiryB = handler("b-expiry", "manual-expiry");
        FakeHandler expiryA = handler("a-expiry", "manual-expiry");
        FakeHandler dispatch = handler("dispatch", "outbox-dispatch");
        RunClock clock = f.started(dispatch, expiryB, pull, expiryA);
        JsonNode tick = value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals(List.of("zz-pull", "a-expiry", "b-expiry", "dispatch"), FakeHandler.LOG);
        assertEquals("completed", tick.get("state").asText());
        List<String> order = new ArrayList<>();
        tick.get("handlerOrder").forEach(e -> order.add(e.get("handlerId").asText()));
        assertEquals(List.of("zz-pull", "a-expiry", "b-expiry", "dispatch"), order);
        List<String> missing = new ArrayList<>();
        tick.get("missingStages").forEach(s -> missing.add(s.asText()));
        assertEquals(List.of("buddy-expiry", "pending-reconciliation", "buddy-allocation"), missing);
        assertEquals(4, tick.get("outcomes").size());
        assertEquals(1, tick.get("clockVersion").asLong());
        assertEquals("t1", value(clock.state(ctx)).at("/lastTick/tickId").asText());
        assertEquals(4, f.count("SELECT count(*) FROM clock_handler_receipts"));
        // The request carries a stable operation id and the tick's own clock.
        TickRequest request = pull.requests.get(0);
        assertEquals(ClockFixture.START, request.now());
        assertEquals("gcsp-policy-v1", request.policyVersion());
        assertTrue(request.operationId().startsWith("clock:tick:handler:"));
    }

    @Test
    void aCompletedTickReplaysItsStoredViewWithoutCallingHandlers() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        RunClock clock = f.started(h);
        JsonNode first = value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals(1, h.calls());
        JsonNode again = value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals(first, again);
        assertEquals(1, h.calls());
    }

    @Test
    void aTickIdReusedWithChangedInputConflicts() throws Exception {
        RunClock clock = f.started(handler("expiry", "manual-expiry"));
        assertTrue(clock.tick(ctx, "t1", 1, TickKind.PRESENTER).ok());
        failure(clock.tick(ctx, "t1", 1, TickKind.STARTUP), Status.CONFLICT, "tick-input-changed");
        failure(clock.tick(ctx, "t1", 7, TickKind.PRESENTER), Status.CONFLICT, "tick-input-changed");
    }

    @Test
    void aTickAtAStaleClockVersionIsRefusedAndStoresNothing() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        RunClock clock = f.started(h);
        assertTrue(clock.advance(ctx, "a", 1, 60L, null).ok());
        Failure stale = failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.CONFLICT, "stale-version");
        assertEquals(2L, stale.currentVersion());
        assertEquals(0, h.calls());
        assertEquals(0, f.count("SELECT count(*) FROM clock_ticks"));
    }

    @Test
    void aFailingHandlerInterruptsAndTheRetryResumesWithoutRerunningEarlierHandlers() throws Exception {
        FakeHandler first = handler("a-first", "manual-expiry");
        FakeHandler flaky = handler("b-flaky", "buddy-expiry");
        FakeHandler last = handler("c-last", "outbox-dispatch");
        flaky.then(r -> new HandlerOutcome.Failed("unavailable", "provider-down", true));
        RunClock clock = f.started(first, flaky, last);
        Failure down = failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-interrupted");
        assertTrue(down.retryable());
        assertEquals("t1", down.detail().get("tickId").asText());
        assertEquals("b-flaky", down.detail().get("handlerId").asText());
        assertEquals("provider-down", down.detail().at("/handlerOutcome/code").asText());
        assertEquals("interrupted", f.text("SELECT state FROM clock_ticks WHERE tick_id = 't1'"));
        assertEquals(0, last.calls());
        flaky.then(r -> new HandlerOutcome.Ok(TextNode.valueOf("fine")));
        JsonNode done = value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals("completed", done.get("state").asText());
        assertEquals(1, first.calls());
        assertEquals(2, flaky.calls());
        assertEquals(1, last.calls());
        assertEquals(3, done.get("outcomes").size());
        assertEquals(3, f.count("SELECT count(*) FROM clock_handler_receipts"));
        // The operation id is stable across the retry.
        assertEquals(flaky.requests.get(0).operationId(), flaky.requests.get(1).operationId());
    }

    @Test
    void aThrowingHandlerIsRecordedByClassNameOnly() throws Exception {
        FakeHandler boom = handler("boom", "manual-expiry");
        boom.then(r -> {
            throw new IllegalStateException("secret detail");
        });
        RunClock clock = f.started(boom);
        Failure down = failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-interrupted");
        assertEquals("handler-threw", down.detail().at("/handlerOutcome/code").asText());
        assertEquals("IllegalStateException", down.detail().at("/handlerOutcome/exception").asText());
        assertFalse(down.toString().contains("secret detail"));
        assertFalse(f.text("SELECT outcomes::text FROM clock_ticks").contains("secret detail"));
    }

    @Test
    void anInvalidPendingOutcomeInterruptsTheTick() throws Exception {
        FakeHandler h = handler("slow", "manual-expiry");
        h.then(r -> new HandlerOutcome.Pending("op-1", " ", "waiting"));
        RunClock clock = f.started(h);
        Failure down = failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-interrupted");
        assertEquals("handler-outcome-invalid", down.detail().at("/handlerOutcome/code").asText());
        assertEquals(0, f.count("SELECT count(*) FROM clock_handler_receipts"));
    }

    @Test
    void aPendingOutcomeLeavesTheTickPendingAndFinal() throws Exception {
        FakeHandler pending = handler("a-slow", "manual-expiry");
        pending.then(r -> new HandlerOutcome.Pending("op-1", "email", "queued"));
        FakeHandler later = handler("b-later", "outbox-dispatch");
        RunClock clock = f.started(pending, later);
        JsonNode tick = value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals("pending", tick.get("state").asText());
        assertEquals(1, later.calls());
        assertEquals("pending", f.text("SELECT state FROM clock_handler_receipts WHERE handler_id = 'a-slow'"));
        assertEquals("pending", value(clock.tick(ctx, "t1", 1, TickKind.PRESENTER)).get("state").asText());
        assertEquals(1, pending.calls());
    }

    @Test
    void aHandlerThatIsNoLongerRegisteredInterruptsTheResume() throws Exception {
        FakeHandler first = handler("a-first", "manual-expiry");
        FakeHandler flaky = handler("b-flaky", "buddy-expiry");
        flaky.then(r -> new HandlerOutcome.Failed("unavailable", "down", true));
        RunClock clock = f.started(first, flaky);
        failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-interrupted");
        RunClock restarted = f.clock(List.of(first));
        Failure gone = failure(restarted.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-interrupted");
        assertEquals("handler-not-registered", gone.detail().at("/handlerOutcome/code").asText());
        assertEquals(1, first.calls());
    }

    @Test
    void aCrashAfterAReceiptLeavesARunningTickThatAFreshClockResumesFromTheReceipt() throws Exception {
        FakeHandler a = handler("a-first", "manual-expiry");
        FakeHandler b = handler("b-second", "buddy-expiry");
        RunClock clock = f.started(a, b);
        // An Error escapes the handler guard, as a process crash would: a has its receipt, the tick is still running.
        b.then(r -> {
            throw new AssertionError("crash");
        });
        assertThrows(AssertionError.class, () -> clock.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals("running", f.text("SELECT state FROM clock_ticks WHERE tick_id = 't1'"));
        assertEquals(1, f.count("SELECT count(*) FROM clock_handler_receipts"));
        b.then(r -> new HandlerOutcome.Ok(TextNode.valueOf("fine")));
        RunClock fresh = f.clock(List.of(a, b));
        JsonNode done = value(fresh.tick(ctx, "t1", 1, TickKind.PRESENTER));
        assertEquals("completed", done.get("state").asText());
        assertEquals(1, a.calls(), "the earlier handler must not run again");
        assertEquals(2, done.get("outcomes").size());
    }

    @Test
    void aRunRetiredBetweenHandlersIsStaleAndLaterHandlersAreNotCalled() throws Exception {
        FakeHandler a = handler("a-first", "manual-expiry");
        FakeHandler b = handler("b-second", "buddy-expiry");
        a.then(r -> {
            try {
                retireAndReplace();
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
            return new HandlerOutcome.Ok(TextNode.valueOf("done"));
        });
        RunClock clock = f.started(a, b);
        ClockResult result = clock.tick(ctx, "t1", 1, TickKind.PRESENTER);
        failure(result, Status.STALE_RUN, "stale-run");
        assertEquals(0, b.calls());
        assertNotEquals("interrupted", f.text("SELECT state FROM clock_ticks WHERE tick_id = 't1'"));
    }

    @Test
    void aStartupTickRunsOnlyTheStartupStages() throws Exception {
        FakeHandler pull = handler("pull", "release-pull");
        FakeHandler expiry = handler("expiry", "manual-expiry");
        FakeHandler dispatch = handler("dispatch", "outbox-dispatch");
        RunClock clock = f.started(pull, expiry, dispatch);
        JsonNode tick = value(clock.tick(new RunContext(ClockFixture.ENV, "run-1", RunClock.SYSTEM_ACTOR), "startup-1", 1,
                TickKind.STARTUP));
        assertEquals(List.of("expiry"), FakeHandler.LOG);
        assertEquals("startup", tick.get("kind").asText());
        assertEquals(2, tick.get("missingStages").size());
    }

    @Test
    void reconcileStartupInitializesThenTicksOnceAndKeepsTheResult() throws Exception {
        FakeHandler expiry = handler("expiry", "manual-expiry");
        RunClock clock = f.clock(List.of(expiry));
        ClockResult first = clock.reconcileStartup(ClockFixture.ENV, "run-1");
        assertTrue(first.ok(), first::toString);
        assertEquals(1, expiry.calls());
        assertSame(first, clock.reconcileStartup(ClockFixture.ENV, "run-1"));
        assertEquals(1, expiry.calls());
        assertEquals(1, f.count("SELECT count(*) FROM clock_ticks WHERE kind = 'startup'"));
    }

    private static void assertSame(Object a, Object b) {
        org.junit.jupiter.api.Assertions.assertSame(a, b);
    }

    @Test
    void reconcileStartupNeverThrowsWhenThePolicyIsMissing() throws Exception {
        RunClock clock = f.clock(ClockFixture.policyWithout(ClockConfiguration.STEP), List.of());
        failure(clock.reconcileStartup(ClockFixture.ENV, "run-1"), Status.UNAVAILABLE, "clock-policy-unavailable");
    }

    @Test
    void aHandlerWithAnUnknownStageStopsVerification() throws Exception {
        RunClock clock = f.clock(List.of(handler("odd", "no-such-stage")));
        clock.initialize(ClockFixture.ENV, "run-1");
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> clock.verifyHandlers(ClockFixture.ENV, "run-1"));
        assertTrue(e.getMessage().contains("odd"));
        failure(clock.tick(ctx, "t1", 1, TickKind.PRESENTER), Status.UNAVAILABLE, "handler-stage-unknown");
    }

    @Test
    void handlerRegistrationRejectsBadAndDuplicateIds() {
        assertThrows(IllegalArgumentException.class, () -> HandlerRegistry.of(List.of(handler("Bad_Id", "manual-expiry"))));
        assertThrows(IllegalArgumentException.class, () -> HandlerRegistry.of(List.of(handler("-x", "manual-expiry"))));
        assertThrows(IllegalArgumentException.class, () -> HandlerRegistry.of(List.of(handler("same", "manual-expiry"),
                handler("same", "buddy-expiry"))));
        assertTrue(HandlerRegistry.of(List.of()).order(List.of("a"), List.of("a")).isEmpty());
    }

    // presenter tick

    @Test
    void presenterTickStepsAdvancesAndTicksInOneCall() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        RunClock clock = f.started(h);
        JsonNode out = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null));
        assertEquals("2026-11-14T09:01:00.000Z", out.at("/advance/now").asText());
        assertEquals(2, out.at("/advance/clockVersion").asLong());
        assertEquals("completed", out.at("/tick/state").asText());
        assertEquals(2, out.at("/tick/clockVersion").asLong());
        assertTrue(out.at("/tick/tickId").asText().matches("presenter-[0-9a-f]{32}"));
        assertEquals(1, h.calls());
    }

    @Test
    void presenterTickToANamedTimeAndNextRelease() throws Exception {
        RunClock clock = f.started();
        JsonNode toNamed = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.TO, "expiry"));
        assertEquals("2026-11-14T11:00:00.000Z", toNamed.at("/advance/now").asText());
        // The release cue (09:30) is now in the past, so next-release has no target.
        Failure none = failure(clock.presenterTick(ctx, "p2", 2, PresenterMode.NEXT_RELEASE, null), Status.UNAVAILABLE,
                "no-future-release");
        assertFalse(none.retryable());
        assertEquals(2, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
    }

    @Test
    void presenterTickNextReleaseJumpsToTheReleaseCue() throws Exception {
        RunClock clock = f.started();
        JsonNode out = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.NEXT_RELEASE, null));
        assertEquals("2026-11-14T09:30:00.000Z", out.at("/advance/now").asText());
    }

    @Test
    void presenterTickRefusesBadInputAndStaleVersion() throws Exception {
        RunClock clock = f.started();
        failure(clock.presenterTick(ctx, "p1", 1, PresenterMode.TO, null), Status.INVALID, "invalid-presenter-tick");
        failure(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, "release"), Status.INVALID, "invalid-presenter-tick");
        failure(clock.presenterTick(ctx, "p1", 1, null, null), Status.INVALID, "invalid-presenter-tick");
        failure(clock.presenterTick(ctx, "p1", 1, PresenterMode.TO, "2026-11-14T08:00:00Z"), Status.INVALID,
                "invalid-clock-command");
        Failure stale = failure(clock.presenterTick(ctx, "p2", 9, PresenterMode.STEP, null), Status.CONFLICT, "stale-version");
        assertEquals(1L, stale.currentVersion());
        assertEquals(0, f.count("SELECT count(*) FROM clock_ticks"));
    }

    @Test
    void aLostResponseReplayReturnsTheSameTargetAndTickEvenIfThePolicyChanged() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        RunClock clock = f.started(h);
        JsonNode first = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null));
        // A new process, and the step policy now missing: the stored plan still answers.
        RunClock fresh = f.clock(ClockFixture.policyWithout(ClockConfiguration.STEP), List.of(h));
        assertEquals(first.at("/advance/now"),
                value(fresh.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null)).at("/advance/now"));
        assertTrue(failure(fresh.presenterTick(ctx, "p9", 2, PresenterMode.STEP, null), Status.UNAVAILABLE,
                "clock-policy-unavailable").retryable());
        RunClock same = f.clock(List.of(h));
        JsonNode replay = value(same.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null));
        assertEquals(gcsp.api.persistence.Canonical.json(first.at("/advance")),
                gcsp.api.persistence.Canonical.json(replay.at("/advance")));
        assertEquals(first.at("/tick/tickId"), replay.at("/tick/tickId"));
        assertEquals(1, h.calls());
        assertEquals(2, same.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
        failure(same.presenterTick(ctx, "p1", 1, PresenterMode.TO, "expiry"), Status.CONFLICT, "command-input-changed");
    }

    @Test
    void aPresenterTickInterruptedByAHandlerResumesOnTheSameTickId() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        h.then(r -> new HandlerOutcome.Failed("unavailable", "down", true));
        RunClock clock = f.started(h);
        Failure down = failure(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null), Status.UNAVAILABLE,
                "handler-interrupted");
        assertEquals(2, down.detail().at("/advance/clockVersion").asLong());
        h.then(r -> new HandlerOutcome.Ok(TextNode.valueOf("ok")));
        JsonNode out = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null));
        assertEquals("completed", out.at("/tick/state").asText());
        assertEquals(2, out.at("/advance/clockVersion").asLong());
        assertEquals(1, f.count("SELECT count(*) FROM clock_ticks"));
    }

    // restart

    @Test
    void aNewClockOverANewPoolKeepsTheClockAndTicks() throws Exception {
        FakeHandler h = handler("expiry", "manual-expiry");
        RunClock clock = f.started(h);
        JsonNode first = value(clock.presenterTick(ctx, "p1", 1, PresenterMode.STEP, null));
        RunClock restarted = f.clock(List.of(h));
        ClockReading reading = restarted.now(ClockFixture.ENV, "run-1").orElseThrow();
        assertEquals(2, reading.clockVersion());
        assertEquals(Instant.parse("2026-11-14T09:01:00Z"), reading.now());
        JsonNode state = value(restarted.state(ctx));
        assertEquals(first.at("/tick/tickId"), state.at("/lastTick/tickId"));
        assertFalse(value(restarted.initialize(ClockFixture.ENV, "run-1")).get("initialized").asBoolean());
        assertEquals(first.get("tick"), value(restarted.tick(ctx, first.at("/tick/tickId").asText(), 2, TickKind.PRESENTER)));
        assertEquals(1, h.calls());
    }

    @Test
    void anAdvanceAndATickAreSmallCommands() throws Exception {
        RunClock clock = f.started(handler("expiry", "manual-expiry"));
        long before = f.count("SELECT revision FROM runs WHERE run_id = 'run-1'");
        assertTrue(clock.advance(ctx, "s1", 1, 60L, null).ok());
        assertEquals(before + 1, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
        assertTrue(clock.advance(ctx, "s1", 1, 60L, null).ok());
        assertEquals(before + 1, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
    }

    /** Retires run-1 and activates run-2, as a reset would. */
    private void retireAndReplace() throws SQLException {
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE environment_id = ? AND run_id = 'run-1'",
                ClockFixture.ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-2', 'active')", ClockFixture.ENV);
    }
}
