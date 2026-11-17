package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.EligibleCandidates.Car;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Request;
import gcsp.api.allocation.EligibleCandidates.Subject;
import gcsp.api.persistence.Canonical;
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

/** Native-PG producer checks with real canonical candidates; the scripted remote is not full journey evidence. */
class CanonicalCandidatesPgTest {

    private AllocationFixture f;
    private PolicyService policy;
    private RecommendationCandidates candidates;
    private ScriptedRemote remote;

    @BeforeEach
    void setUp() throws Exception {
        f = AllocationFixture.create();
        policy = new PolicyService(new RetainedFilePolicySource());
        candidates = new RecommendationCandidates(policy);
        remote = new ScriptedRemote();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    @Test
    void canonicalPreparationProducesAClaimAndSameInstantAcknowledgementCreatesAnOffer() throws Exception {
        Request request = seed();
        JsonNode expected = first(request).quote();
        JsonNode[] referencedQuote = new JsonNode[1];
        remote.onExecute(op -> {
            assertEquals(request.cars().get(0).orderUuid(), op.orderUuid());
            assertEquals(request.subject().employeeId(), op.employeeId());
            assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
            assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
            assertFalse(op.payload().has("quote"), "the existing remote contract carries a quote reference");
            referencedQuote[0] = quote(op.payload().path("quoteId").asText());
            assertQuote(expected, referencedQuote[0]);
            return ScriptedRemote.confirmed().apply(op);
        });

        AllocationResult.Completed done = allocate(request, "canonical-same-instant");

        assertNotNull(referencedQuote[0]);
        assertEquals(List.of(request.subject().employeeId() + ":" + request.cars().get(0).orderUuid()),
                f.contenders(done.allocationId()));
        assertEquals(1, f.count("SELECT contender_count FROM allocation_runs"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_quotes"));
        assertEquals(1, f.count("SELECT count(*) FROM allocation_attempts WHERE status = 'claim-pending'"));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals("active", f.text("SELECT state FROM buddy_offers"));
        assertEquals(request.subject().employeeId(), f.text("SELECT employee_id FROM buddy_offers"));
        assertEquals(request.cars().get(0).orderUuid(), f.text("SELECT order_uuid FROM buddy_offers"));
        assertEquals("acknowledged", f.text("SELECT state FROM pending_operations WHERE operation_type = 'buddy-claim'"));
        assertEquals("offered", f.text("SELECT outcome->>'state' FROM pending_operations WHERE operation_type = 'buddy-claim'"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        assertEquals(List.of("execute:buddy-claim"), remote.calls);
        assertQuote(expected, AllocationFixture.json(f.text("SELECT quote::text FROM buddy_quotes")));
        JsonNode decision = AllocationFixture.json(f.text("SELECT evaluation::text FROM allocation_evaluations"))
                .path("decisions").get(0);
        assertEquals("eligible", decision.path("gateStatus").asText());
        assertEquals(100, decision.path("score").asInt());
        assertEquals("gcsp-policy-v1", decision.path("versions").path("policy").asText());
    }

    @Test
    void laterClockReevaluationExposesChangedTermsAndLeavesTheOriginalQuotePinned() throws Exception {
        Request request = seed();
        remote.onExecute(ScriptedRemote.lost());
        allocate(request, "canonical-later-instant");
        String operation = f.text("SELECT operation_id FROM pending_operations WHERE operation_type = 'buddy-claim'");
        assertEquals("pending", f.text("SELECT state FROM pending_operations WHERE operation_id = ?", operation));
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        JsonNode original = AllocationFixture.json(f.text("SELECT quote::text FROM buddy_quotes"));
        Car first = request.cars().get(0);
        Car held = new Car(first.orderUuid(), first.configurationId(),
                f.count("SELECT version FROM stock_cars WHERE order_uuid = ?", first.orderUuid()), first.attributes());
        Instant later = request.asOf().plusSeconds(1);
        Request reevaluation = new Request(request.environmentId(), request.runId(), request.policyVersion(), later,
                request.clockVersion() + 1, request.subject(), List.of(held));
        EligibleCandidates.Decision recalculated = first(reevaluation);
        assertEquals("eligible", recalculated.gateStatus());
        assertEquals(original.get("snapshot"), recalculated.quote().get("snapshot"));
        assertNotEquals(original.get("terms"), recalculated.quote().get("terms"));
        assertNotEquals(original.path("terms").get("termsVersion"), recalculated.quote().path("terms").get("termsVersion"));
        assertNotEquals(original.path("terms").get("validUntil"), recalculated.quote().path("terms").get("validUntil"));

        remote.onReconcile(ScriptedRemote.confirmed());
        DriveResult.Settled result = assertInstanceOf(DriveResult.Settled.class,
                new BuddyRemoteLifecycle(f.pool(), policy, candidates, remote).drive(scope(reevaluation), operation));

        // This characterizes current full-terms equality; it does not claim successful later-clock recovery.
        assertEquals("acknowledged", result.state());
        assertEquals("release-pending", result.outcome().path("state").asText());
        assertEquals("release-pending", f.text("SELECT state FROM custody_holds"));
        assertEquals("prerequisites-changed", f.text("SELECT attributes->>'releaseReason' FROM custody_holds"));
        assertEquals(1, f.count("SELECT count(*) FROM pending_operations WHERE operation_type = 'buddy-release'"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        assertEquals(original, AllocationFixture.json(f.text("SELECT quote::text FROM buddy_quotes")));
        assertEquals(List.of("execute:buddy-claim", "reconcile:buddy-claim"), remote.calls);
    }

    private AllocationResult.Completed allocate(Request request, String event) throws Exception {
        return assertInstanceOf(AllocationResult.Completed.class,
                new AllocationService(f.pool(), policy, candidates, remote).allocate(scope(request),
                        new Trigger("stock-released", event, List.of(), List.of())));
    }

    private EligibleCandidates.Decision first(Request request) {
        Evaluated evaluated = assertInstanceOf(Evaluated.class, candidates.evaluate(request));
        assertEquals(1, evaluated.decisions().size());
        return evaluated.decisions().get(0);
    }

    private JsonNode quote(String quoteId) throws Exception {
        String stored = f.text("SELECT quote::text FROM buddy_quotes WHERE quote_id = ?", quoteId);
        assertNotNull(stored);
        return AllocationFixture.json(stored);
    }

    private static void assertQuote(JsonNode expected, JsonNode stored) {
        for (String key : List.of("orderUuid", "configurationId", "snapshot", "terms", "employeeFacts", "reasons",
                "tradeOffs", "versions")) assertEquals(Canonical.json(expected.get(key)), Canonical.json(stored.get(key)), key);
        assertEquals("exact-stock", stored.path("snapshot").path("identityKind").asText());
        assertEquals(stored.get("orderUuid"), stored.path("snapshot").path("sourceKeys").get("stockId"));
        assertEquals("gcsp-policy-v1", stored.path("versions").path("policy").asText());
        assertTrue(stored.path("employeeFacts").path("driverEligible").path("value").asBoolean());
    }

    private static AllocationScope scope(Request request) {
        return new AllocationScope(request.environmentId(), request.runId(), request.policyVersion(), request.asOf(),
                request.clockVersion());
    }

    private Request seed() throws Exception {
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
                        + "VALUES (?, ?, ?, 1, NULL, 'confirmed', ?::jsonb, ?::jsonb, ?, ?, 'canonical-test', "
                        + "?::timestamptz, 'canonical-brief-v1')", AllocationFixture.ENV, AllocationFixture.RUN, employeeId,
                brief.toString(), buddy.toString(), AllocationFixture.digest("canonical-brief-v1"),
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
                AllocationFixture.T0, 1, new Subject(employeeId, slotId, employeeVersion, attributes, account, 1, brief), List.of(car));
        assertEquals("eligible", first(request).gateStatus());
        return request;
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream input = CanonicalCandidatesPgTest.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("Missing retained fixture " + name);
            return AllocationFixture.JSON.readTree(input);
        }
    }
}
