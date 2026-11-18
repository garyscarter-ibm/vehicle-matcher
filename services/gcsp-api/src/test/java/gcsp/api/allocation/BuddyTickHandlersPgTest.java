package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.EligibleCandidates.Car;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Request;
import gcsp.api.allocation.EligibleCandidates.Subject;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickKind;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import gcsp.api.recommendation.RecommendationCandidates;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The Buddy tick handlers over native PostgreSQL: registration, outcomes and the restart and later-tick paths. */
class BuddyTickHandlersPgTest {

    private AllocationFixture f;
    private PolicyService policy;

    @BeforeEach
    void setUp() throws Exception {
        f = AllocationFixture.create();
        policy = new PolicyService(new RetainedFilePolicySource());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    @Test
    void handlersRegisterOnlyWithPersistenceAndAConfiguredCandidatesProvider() {
        RemoteBuddy remote = new ScriptedRemote();
        RemoteBuddy local = new LocalSyntheticBuddy();
        for (String provider : new String[] {"none", "", "  ", " none ", null}) {
            assertFalse(allocation(true, provider).enabled(), provider);
            assertFalse(expiry(true, provider).enabled(), provider);
            assertFalse(pending(true, provider, remote).enabled(), provider);
        }
        for (String provider : new String[] {"recommendation", " recommendation "}) {
            assertTrue(allocation(true, provider).enabled());
            assertTrue(expiry(true, provider).enabled());
            assertTrue(pending(true, provider, remote).enabled());
            assertFalse(pending(true, provider, local).enabled());
            assertFalse(allocation(false, provider).enabled());
            assertFalse(expiry(false, provider).enabled());
            assertFalse(pending(false, provider, remote).enabled());
        }
        assertEquals("buddy-allocation", allocation(true, "x").handlerId());
        assertEquals("buddy-allocation", allocation(true, "x").stage());
        assertEquals("buddy-expiry", expiry(true, "x").handlerId());
        assertEquals("buddy-expiry", expiry(true, "x").stage());
        assertEquals("buddy-pending-operations", pending(true, "x", remote).handlerId());
        assertEquals("pending-reconciliation", pending(true, "x", remote).stage());
    }

    @Test
    void aStockReleaseAllocatesOnceAndTheNextTickFindsNothing() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        ScriptedCandidates candidates = new ScriptedCandidates().eligible("e-a", "car-1", 90);
        AllocationTriggers triggers = new AllocationTriggers(f.pool(), new AllocationService(f.pool(), policy, candidates));
        BuddyAllocationTickHandler handler = new BuddyAllocationTickHandler(() -> true, () -> "recommendation", () -> triggers);
        f.emit("stock-released", "rel-1", "{}");

        JsonNode first = ok(handler.handle(tick(AllocationFixture.T0, 1, TickKind.PRESENTER)));
        assertEquals(1, first.path("allocations").asInt());
        assertEquals(1, first.path("states").size());
        assertTrue(first.path("cursorRevision").asLong() > 0);
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));

        JsonNode again = ok(handler.handle(tick(AllocationFixture.T0.plusSeconds(1), 2, TickKind.PRESENTER)));
        assertEquals(0, again.path("allocations").asInt());
        assertEquals(1, f.count("SELECT count(*) FROM allocation_runs"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers"));
    }

    @Test
    void aDueLocalHoldLapsesOnTheExpiryTick() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.buddyHold("h-1", "car-1", "e-a", 1, "2026-11-14T09:00:00Z");
        BuddyExpiry service = new BuddyExpiry(f.pool(), policy);
        BuddyExpiryTickHandler handler = new BuddyExpiryTickHandler(() -> true, () -> "recommendation", () -> service);

        JsonNode counts = ok(handler.handle(tick(AllocationFixture.T0, 1, TickKind.STARTUP)));
        assertEquals(1, counts.path("expired").asInt());
        assertEquals(0, counts.path("retained").asInt());
        assertEquals(0, counts.path("releases").asInt());
        assertFalse(counts.path("replayed").asBoolean());
        assertEquals("expired", f.text("SELECT state FROM custody_holds WHERE hold_id = 'h-1'"));
        assertEquals("expired", f.text("SELECT state FROM buddy_offers WHERE hold_id = 'h-1'"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
    }

    @Test
    void aLaterTickConfirmsALostClaimAndALostReconcileKeepsTheCarOccupied() throws Exception {
        RecommendationCandidates candidates = new RecommendationCandidates(policy);
        ScriptedRemote remote = new ScriptedRemote();
        Request request = seed(candidates);
        remote.onExecute(ScriptedRemote.lost());
        assertInstanceOf(AllocationResult.Completed.class, new AllocationService(f.pool(), policy, candidates, remote)
                .allocate(scope(request), new Trigger("stock-released", "tick-1", List.of(), List.of())));
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
        BuddyRemoteLifecycle lifecycle = new BuddyRemoteLifecycle(f.pool(), policy, candidates, remote);
        BuddyPendingOperationsTickHandler handler = new BuddyPendingOperationsTickHandler(() -> true,
                () -> "recommendation", () -> remote, () -> lifecycle);

        remote.onReconcile(ScriptedRemote.lost());
        JsonNode lost = ok(handler.handle(tick(request.asOf().plusSeconds(30), 2, TickKind.STARTUP)));
        assertEquals(1, lost.path("pending").asInt());
        assertEquals(0, lost.path("settled").asInt());
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(1, f.occupying().size());

        remote.onReconcile(ScriptedRemote.confirmed());
        JsonNode confirmed = ok(handler.handle(tick(request.asOf().plusSeconds(60), 3, TickKind.PRESENTER)));
        assertEquals(1, confirmed.path("settled").asInt());
        assertEquals(0, confirmed.path("pending").asInt());
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
        assertEquals(0, f.count("SELECT count(*) FROM pending_operations WHERE operation_type = 'buddy-release'"));
    }

    @Test
    void everyResultTypeMapsToAnOutcome() {
        TriggerResult.Consumed consumed = new TriggerResult.Consumed(List.of(
                new TriggerResult.Item("a1", "stock-released", "e1", "completed"),
                new TriggerResult.Item("a2", "brief-changed", "e2", "completed"),
                new TriggerResult.Item("a3", "buddy-expired", "e3", "no-contenders")), 7, "e3");
        JsonNode value = ok(BuddyAllocationTickHandler.map(consumed));
        assertEquals(3, value.path("allocations").asInt());
        assertEquals(7, value.path("cursorRevision").asLong());
        assertEquals(2, value.path("states").path("completed").asInt());
        assertEquals(1, value.path("states").path("no-contenders").asInt());
        assertEquals(new HandlerOutcome.Failed("unavailable", "database-unavailable", true),
                BuddyAllocationTickHandler.map(new TriggerResult.Pending("database-unavailable", true)));
        assertEquals(new HandlerOutcome.Failed("refused", "invalid-scope", false),
                BuddyAllocationTickHandler.map(new TriggerResult.Refused("invalid-scope", "m")));

        ExpiryResult.Done done = new ExpiryResult.Done(
                List.of(new ExpiryResult.Lapse("h", "o", "c", "e", "x", "y")),
                List.of(new ExpiryResult.Retained("h2", "r"), new ExpiryResult.Retained("h3", "r")),
                List.of(new ExpiryResult.Release("h4", "op")), true);
        JsonNode counts = ok(BuddyExpiryTickHandler.map(done));
        assertEquals(1, counts.path("expired").asInt());
        assertEquals(2, counts.path("retained").asInt());
        assertEquals(1, counts.path("releases").asInt());
        assertTrue(counts.path("replayed").asBoolean());
        assertEquals(new HandlerOutcome.Failed("unavailable", "database-unavailable", true),
                BuddyExpiryTickHandler.map(new ExpiryResult.Pending("database-unavailable", true)));
        assertEquals(new HandlerOutcome.Failed("refused", "invalid-scope", false),
                BuddyExpiryTickHandler.map(new ExpiryResult.Refused("invalid-scope", "m")));

        JsonNode drove = ok(BuddyPendingOperationsTickHandler.map(new ReconcileResult(4, 3, 1, 2, "op")));
        assertEquals(4, drove.path("driven").asInt());
        assertEquals(3, drove.path("settled").asInt());
        assertEquals(1, drove.path("pending").asInt());
        assertEquals(2, drove.path("refused").asInt());
    }

    @Test
    void anUnexpectedExceptionFailsRetryably() {
        TickRequest request = tick(AllocationFixture.T0, 1, TickKind.PRESENTER);
        assertEquals(new HandlerOutcome.Failed("unavailable", "buddy-allocation-unavailable", true),
                new BuddyAllocationTickHandler(() -> true, () -> "recommendation", () -> {
                    throw new IllegalStateException("down");
                }).handle(request));
        assertEquals(new HandlerOutcome.Failed("unavailable", "buddy-expiry-unavailable", true),
                new BuddyExpiryTickHandler(() -> true, () -> "recommendation", () -> {
                    throw new IllegalStateException("down");
                }).handle(request));
        assertEquals(new HandlerOutcome.Failed("unavailable", "buddy-pending-operations-unavailable", true),
                new BuddyPendingOperationsTickHandler(() -> true, () -> "recommendation", ScriptedRemote::new, () -> {
                    throw new IllegalStateException("down");
                }).handle(request));
    }

    private static BuddyAllocationTickHandler allocation(boolean persistence, String provider) {
        return new BuddyAllocationTickHandler(() -> persistence, () -> provider, () -> null);
    }

    private static BuddyExpiryTickHandler expiry(boolean persistence, String provider) {
        return new BuddyExpiryTickHandler(() -> persistence, () -> provider, () -> null);
    }

    private static BuddyPendingOperationsTickHandler pending(boolean persistence, String provider, RemoteBuddy remote) {
        return new BuddyPendingOperationsTickHandler(() -> persistence, () -> provider, () -> remote, () -> null);
    }

    private static JsonNode ok(HandlerOutcome outcome) {
        return assertInstanceOf(HandlerOutcome.Ok.class, outcome).value();
    }

    private static TickRequest tick(Instant now, long clockVersion, TickKind kind) {
        return new TickRequest(new RunContext(AllocationFixture.ENV, AllocationFixture.RUN, "system:clock"),
                "tick-" + clockVersion, now, clockVersion, AllocationFixture.POLICY, "op-" + clockVersion, kind);
    }

    private static AllocationScope scope(Request request) {
        return new AllocationScope(request.environmentId(), request.runId(), request.policyVersion(), request.asOf(),
                request.clockVersion());
    }

    /** The canonical Paula brief, account and released car, as CanonicalCandidatesPgTest seeds them. */
    private Request seed(RecommendationCandidates candidates) throws Exception {
        JsonNode golden = resource("/account/node-baseline/paula.json");
        JsonNode context = golden.get("context");
        String employeeId = context.get("employeeId").asText();
        String slotId = context.get("entitlementSlotId").asText();
        long employeeVersion = golden.path("input").path("employeeVersion").asLong();
        ObjectNode attributes = AllocationFixture.JSON.createObjectNode();
        for (String key : List.of("companyId", "schemeId", "gradeId", "entitlementSlotId")) attributes.set(key, context.get(key));
        f.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, ?, ?::jsonb, ?)",
                AllocationFixture.ENV, AllocationFixture.RUN, employeeId, attributes.toString(), employeeVersion);
        JsonNode slot = golden.path("input").path("slots").get(0);
        ObjectNode slotAttributes = slot.deepCopy();
        slotAttributes.remove(List.of("employeeId", "entitlementSlotId", "capacity", "runId", "version", "createdAt", "updatedAt"));
        f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, version) "
                        + "VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)", AllocationFixture.ENV, AllocationFixture.RUN, slotId,
                employeeId, slot.path("capacity").asInt(), slotAttributes.toString(), slot.path("version").asLong());
        JsonNode account = golden.path("input").get("manualContext").deepCopy();
        f.update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record, version) "
                        + "VALUES (?, ?, ?, ?, ?::jsonb, ?)", AllocationFixture.ENV, AllocationFixture.RUN, employeeId,
                account.path("recordSetId").asText(), account.toString(), employeeVersion);
        ObjectNode brief = AllocationFixture.JSON.createObjectNode().put("schemaVersion", 1);
        brief.putObject("preferences").putObject("body").put("value", "estate").put("importance", 100)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee")
                .put("confirmedAt", "2026-11-05T09:00:00.000Z");
        brief.putObject("essentials");
        ObjectNode buddy = AllocationFixture.JSON.createObjectNode().put("searchConsent", true).put("holdConsent", true)
                .put("paused", false).put("permissionVersion", 1);
        f.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 1)",
                AllocationFixture.ENV, AllocationFixture.RUN, employeeId);
        f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, "
                        + "operation, content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                        + "VALUES (?, ?, ?, 1, NULL, 'confirmed', ?::jsonb, ?::jsonb, ?, ?, 'tick-test', "
                        + "?::timestamptz, 'tick-brief-v1')", AllocationFixture.ENV, AllocationFixture.RUN, employeeId,
                brief.toString(), buddy.toString(), AllocationFixture.digest("tick-brief-v1"),
                context.path("policyVersion").asText(), "2026-11-05T09:00:00.000Z");
        JsonNode row = resource("/recommendation-source/source-cases.json").path("cases").get(0).path("rows").get(0);
        ObjectNode carAttributes = row.deepCopy();
        carAttributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
        Car car = new Car(row.path("orderUuid").asText(), row.path("configurationId").asText(), row.path("version").asLong(),
                carAttributes);
        f.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes, version) "
                        + "VALUES (?, ?, ?, ?, 'released', ?::jsonb, ?)", AllocationFixture.ENV, AllocationFixture.RUN,
                car.orderUuid(), car.configurationId(), carAttributes.toString(), car.version());
        Request request = new Request(AllocationFixture.ENV, AllocationFixture.RUN, context.path("policyVersion").asText(),
                AllocationFixture.T0, 1, new Subject(employeeId, slotId, employeeVersion, attributes, account, 1, brief),
                List.of(car));
        Evaluated evaluated = assertInstanceOf(Evaluated.class, candidates.evaluate(request));
        assertEquals("eligible", evaluated.decisions().get(0).gateStatus());
        return request;
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream input = BuddyTickHandlersPgTest.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("Missing retained fixture " + name);
            return AllocationFixture.JSON.readTree(input);
        }
    }
}
