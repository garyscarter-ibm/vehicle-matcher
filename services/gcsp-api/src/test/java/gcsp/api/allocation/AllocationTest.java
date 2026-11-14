package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Custody;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AllocationTest {

    AllocationFixture f;
    ScriptedCandidates candidates;
    PolicyService policy;
    AllocationService service;

    @BeforeEach
    void setUp() throws Exception {
        f = AllocationFixture.create();
        candidates = new ScriptedCandidates();
        policy = new PolicyService(new RetainedFilePolicySource());
        service = new AllocationService(f.pool(), policy, candidates);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    static Trigger released(String id) {
        return new Trigger("stock-released", id, List.of(), List.of());
    }

    static String idOf(Trigger t) {
        return "allocation:" + gcsp.api.persistence.Canonical.digest(
                AllocationFixture.JSON.createArrayNode().add(t.type()).add(t.sourceEventId()));
    }

    AllocationResult.Completed run(Trigger t) {
        return assertInstanceOf(AllocationResult.Completed.class, service.allocate(AllocationFixture.scope(), t));
    }

    @Test
    void lotteryMatchesTheNodeTestVector() {
        assertEquals("62abd784beced863a48a142a58375bed6d7f9044ca982e424664e0f33223f25b",
                Lottery.of("gcsp-v1", "run-1", "emp-a", "car-1"));
    }

    @Test
    void fitFirstRuleOrdersByScoreBeforeRenewal() {
        Instant early = Instant.parse("2027-01-01T00:00:00Z");
        Instant late = Instant.parse("2027-03-01T00:00:00Z");
        Contender lowFitEarly = new Contender("a", "s", null, "c", early, 10.0, "0", null, null, null);
        Contender highFitLate = new Contender("b", "s", null, "c", late, 90.0, "0", null, null, null);
        List<Contender> both = new ArrayList<>(List.of(lowFitEarly, highFitLate));
        both.sort(Contender.ranking(Assumptions.RULE_FIT_FIRST));
        assertEquals("b", both.get(0).employeeId());
        both.sort(Contender.ranking(Assumptions.RULE_RENEWAL_FIRST));
        assertEquals("a", both.get(0).employeeId());
    }

    @Test
    void ranksRenewalDueThenFitThenSeededLottery() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-03-01");
        f.employee("e-b", "2027-01-01");
        f.employee("e-c", "2027-01-01");
        f.employee("e-d", "2027-02-01");
        f.employee("e-e", "2027-02-01");
        candidates.eligible("e-a", "car-1", 99).eligible("e-b", "car-1", 70).eligible("e-c", "car-1", 90)
                .eligible("e-d", "car-1", 50).eligible("e-e", "car-1", 50);
        Trigger t = released("evt-rank");
        AllocationResult.Completed done = run(t);

        String d = Lottery.of("gcsp-v1", "run-1", "e-d", "car-1");
        String e = Lottery.of("gcsp-v1", "run-1", "e-e", "car-1");
        List<String> tied = d.compareTo(e) < 0 ? List.of("e-d:car-1", "e-e:car-1") : List.of("e-e:car-1", "e-d:car-1");
        List<String> expected = new ArrayList<>(List.of("e-c:car-1", "e-b:car-1"));
        expected.addAll(tied);
        expected.add("e-a:car-1");
        assertEquals(expected, f.contenders(idOf(t)));
        assertEquals(List.of("e-c:car-1"), f.occupying());
        assertEquals("allocated", done.outcome().get("state").textValue());
        assertEquals(1, done.outcome().get("assignments").size());
        assertEquals(1, f.count("SELECT count(*) FROM allocation_attempts WHERE status = 'claimed'"));
        // Later contenders skip without an attempt row: the car is taken (and the others' ranks are kept).
        assertEquals(5, f.count("SELECT count(*) FROM allocation_contenders"));
        assertEquals(5, f.count("SELECT contender_count FROM allocation_runs"));
        assertEquals(5, f.count("SELECT next_index FROM allocation_runs"));
    }

    @Test
    void fallsBackToTheNextEligibleCarAndKeepsEveryContender() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50).eligible("e-b", "car-1", 80)
                .eligible("e-b", "car-2", 70);
        Trigger t = released("evt-fallback");
        run(t);

        assertEquals(List.of("e-a:car-1", "e-a:car-2", "e-b:car-1", "e-b:car-2"), f.contenders(idOf(t)));
        assertEquals(List.of("e-a:car-1", "e-b:car-2"), f.occupying());
        assertEquals(2, f.count("SELECT count(*) FROM allocation_attempts WHERE status = 'claimed'"));
        assertEquals(2, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
    }

    @Test
    void employeeAndSlotLimitsSkipHolders() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.car("car-7");
        f.car("car-8");
        f.car("car-9");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        f.employee("e-c", "2027-01-01");
        f.employee("e-d", "2027-01-01");
        f.employee("e-e", "2027-01-01");
        f.hold("h-9", "car-9", "e-a", 1, "claim-pending");
        f.hold("h-8", "car-8", "e-c", 1, "allocated");
        f.update("UPDATE employees SET attributes = attributes || '{\"renewalId\":\"ren-1\"}'::jsonb "
                + "WHERE employee_id = 'e-d'");
        f.hold("h-ren", "car-7", "e-e", 1, "allocated", "{\"renewalId\":\"ren-1\"}");
        for (String e : List.of("e-a", "e-b", "e-c", "e-d", "e-e")) {
            candidates.eligible(e, "car-1", 90).eligible(e, "car-2", 80);
        }
        Trigger t = released("evt-limits");
        run(t);

        List<String> evaluated = f.column("SELECT employee_id FROM allocation_evaluations ORDER BY 1");
        assertEquals(List.of("e-b"), evaluated);
        assertEquals(List.of("e-b:car-1", "e-b:car-2"), f.contenders(idOf(t)));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE employee_id = 'e-b'"));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds WHERE employee_id = 'e-d'"));
    }

    @Test
    void aDuplicateReleaseCreatesNothingNewAndChangedInputIsRefused() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        Trigger t = released("evt-dup");
        AllocationResult.Completed first = run(t);
        assertFalse(first.replayed());
        long holds = f.count("SELECT count(*) FROM custody_holds");
        long receipts = f.count("SELECT count(*) FROM command_receipts");
        long revision = f.count("SELECT revision FROM runs");

        AllocationResult.Completed second = run(t);
        assertTrue(second.replayed());
        assertEquals(first.outcome(), second.outcome());
        assertEquals(holds, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(receipts, f.count("SELECT count(*) FROM command_receipts"));
        assertEquals(revision, f.count("SELECT revision FROM runs"));

        Trigger changed = new Trigger("stock-released", "evt-dup", List.of(), List.of("car-1"));
        AllocationResult.Refused refused = assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(AllocationFixture.scope(), changed));
        assertEquals("command-input-changed", refused.code());
    }

    @Test
    void differentTriggersContendingForOneCarYieldOneOccupyingHolder() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50).eligible("e-b", "car-1", 80)
                .eligible("e-b", "car-2", 70);
        AllocationService other = new AllocationService(f.pool(), policy, candidates);
        List<AllocationResult> results = twoThreads(
                () -> service.allocate(AllocationFixture.scope(), released("evt-1")),
                () -> other.allocate(AllocationFixture.scope(), released("evt-2")));
        results.forEach(r -> assertInstanceOf(AllocationResult.Completed.class, r));

        assertEquals(0, f.count("SELECT count(*) FROM (SELECT order_uuid FROM custody_holds WHERE state IN "
                + "('active','claim-pending','release-pending','selection-pending') GROUP BY order_uuid "
                + "HAVING count(*) > 1) x"));
        assertEquals(List.of("e-a:car-1", "e-b:car-2"), f.occupying());
        assertEquals(2, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
        List<String> codes = f.column("SELECT code FROM allocation_attempts WHERE status = 'refused'");
        for (String code : codes) {
            assertTrue(List.of("stale-version", "stock-unavailable", "release-required", "car-held", "slot-occupied")
                    .contains(code), code);
        }
        assertEquals(2, f.count("SELECT count(*) FROM allocation_runs WHERE state = 'completed'"));
    }

    @Test
    void twoCallersOnTheSameAllocationMakeOneSetOfHolds() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50).eligible("e-b", "car-1", 80)
                .eligible("e-b", "car-2", 70);
        AllocationService other = new AllocationService(f.pool(), policy, candidates);
        Trigger t = released("evt-same");
        List<AllocationResult> results = twoThreads(() -> service.allocate(AllocationFixture.scope(), t),
                () -> other.allocate(AllocationFixture.scope(), t));
        results.forEach(r -> assertInstanceOf(AllocationResult.Completed.class, r));

        assertEquals(List.of("e-a:car-1", "e-b:car-2"), f.occupying());
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(2, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(2, f.count("SELECT count(*) FROM allocation_attempts"));
        assertEquals(1, f.count("SELECT count(*) FROM allocation_runs"));
    }

    @Test
    void aCartHoldOnACarKeepsItOutOfThePool() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-z", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50);
        TransactionRunner runner = new TransactionRunner(f.pool());
        Outcome held = runner.execute(f.ctx(), new gcsp.api.persistence.Command("cart.hold", "cart-1",
                AllocationFixture.json("{}")), tx -> {
                    Custody.acquireHold(tx, "h-cart", "car-1", Custody.carVersion(tx, "car-1"), "slot-e-z", "e-z", 1,
                            Instant.parse("2026-11-14T10:00:00Z"));
                    return WorkResult.ok(null);
                });
        assertInstanceOf(Outcome.Committed.class, held);
        run(released("evt-cart"));

        ScriptedCandidates.class.cast(candidates).requests.forEach(r -> assertEquals(List.of("car-2"),
                r.cars().stream().map(EligibleCandidates.Car::orderUuid).toList()));
        assertEquals(List.of("e-a:car-2", "e-z:car-1"), f.occupying());
    }

    @Test
    void aCarVersionChangeBetweenPrepareAndClaimIsRefusedAndTheFallbackContinues() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50);
        FlakyCommits late = new FlakyCommits(f.pool(), 0, false).afterCommit(1, () -> {
            try {
                f.update("UPDATE stock_cars SET version = version + 1 WHERE order_uuid = 'car-1'");
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
        AllocationService racing = new AllocationService(late, policy, candidates);
        Trigger t = released("evt-stale");
        assertInstanceOf(AllocationResult.Completed.class, racing.allocate(AllocationFixture.scope(), t));

        assertEquals("stale-version", f.text("SELECT code FROM allocation_attempts WHERE status = 'refused'"));
        assertEquals(List.of("e-a:car-2"), f.occupying());
        assertEquals(2, f.count("SELECT count(*) FROM allocation_contenders"));
    }

    @Test
    void aCustodyCollisionInsideTheClaimRecordsCarHeldAndContinues() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-z", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-a", "car-2", 50);
        // A concurrent writer's hold lands after the claim's checks: the unique index decides.
        f.update("CREATE FUNCTION race_hold() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
                + "IF NEW.order_uuid = 'car-1' THEN INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, "
                + "employee_id, slot_id, slot_unit, hold_type, state, expires_at) VALUES (NEW.environment_id, NEW.run_id, "
                + "'h-race', 'car-1', 'e-z', 'slot-e-z', 1, 'cart', 'active', now() + interval '1 hour'); END IF; "
                + "RETURN NEW; END $$");
        f.update("CREATE TRIGGER race_hold BEFORE INSERT ON buddy_quotes FOR EACH ROW EXECUTE FUNCTION race_hold()");
        run(released("evt-race"));

        assertEquals("car-held", f.text("SELECT code FROM allocation_attempts WHERE status = 'refused'"));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds WHERE hold_id = 'h-race'"));
        assertEquals(List.of("e-a:car-2"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_quotes"));
    }

    @Test
    void anEmployeeWithoutARenewalDateIsExcludedAndTheBatchContinues() throws Exception {
        f.car("car-1");
        f.employee("e-a", null);
        f.employee("e-b", "2027-01-01");
        candidates.eligible("e-a", "car-1", 99).eligible("e-b", "car-1", 10);
        Trigger t = released("evt-excluded");
        AllocationResult.Completed done = run(t);

        assertEquals(List.of("e-b:car-1"), f.occupying());
        JsonNode excluded = done.outcome().get("excluded");
        assertEquals(1, excluded.size());
        assertEquals("e-a", excluded.get(0).get("employeeId").textValue());
        assertEquals("renewal-deadline-unknown", excluded.get(0).get("code").textValue());
        assertEquals("renewal-deadline-unknown",
                f.text("SELECT excluded_code FROM allocation_evaluations WHERE employee_id = 'e-a'"));
        assertTrue(f.text("SELECT evaluation::text FROM allocation_evaluations WHERE employee_id = 'e-a'")
                .contains("renewal-deadline-unknown"));
        assertEquals(1, f.count("SELECT count(*) FROM allocation_contenders"));
    }

    @Test
    void quotesAndExplanationsAreRetained() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        f.employee("e-c", "2027-03-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-b", "car-2", 60).eligible("e-c", "car-1", 10);
        Trigger t = released("evt-quotes");
        AllocationResult.Completed done = run(t);

        assertEquals(3, f.count("SELECT count(*) FROM allocation_evaluations"));
        assertEquals(2, f.count("SELECT count(*) FROM buddy_quotes"));
        String stored = f.text("SELECT quote::text FROM buddy_quotes WHERE employee_id = 'e-a'");
        ObjectNode quote = (ObjectNode) AllocationFixture.json(stored);
        assertEquals("eligible", quote.remove("gateStatus").textValue());
        assertNotNull(quote.remove("decision"));
        assertEquals(ScriptedCandidates.quote(new EligibleCandidates.Car("car-1", "cfg-car-1", 1, null)), quote);
        assertEquals("Car car-1", f.text("SELECT vehicle_name FROM buddy_quotes WHERE employee_id = 'e-a'"));
        assertEquals("/img/car-1.jpg", f.text("SELECT image_path FROM buddy_quotes WHERE employee_id = 'e-a'"));
        assertEquals("480", f.text("SELECT monthly_points::text FROM buddy_quotes WHERE employee_id = 'e-a'"));
        assertEquals("2026-11-14T12:00:00Z",
                f.text("SELECT to_char(valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM buddy_quotes "
                        + "WHERE employee_id = 'e-a'"));
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'allocation-completed'"));
        assertEquals("2026-11-14T11:00:00Z", f.text("SELECT to_char(expires_at AT TIME ZONE 'UTC', "
                + "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM custody_holds WHERE employee_id = 'e-a'"));
        assertEquals("buddy-offer", f.text("SELECT hold_type FROM custody_holds WHERE employee_id = 'e-a'"));
        assertEquals(f.text("SELECT quote_id FROM buddy_offers WHERE employee_id = 'e-a'"),
                f.text("SELECT attributes->>'quoteId' FROM custody_holds WHERE employee_id = 'e-a'"));
        assertEquals(2, done.outcome().get("assignments").size());
        // e-c's contender is skipped (its car is taken), which writes no attempt row.
        assertEquals(2, done.outcome().get("attempts").size());
        assertEquals(done.outcome(), service.read(AllocationFixture.scope(), idOf(t)).orElseThrow().get("outcome"));
    }

    @Test
    void aDeclinedCarStaysExcludedUntilTheBriefChanges() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.declinedOffer("e-a", "car-1", 1);
        candidates.eligible("e-a", "car-1", 90);
        AllocationResult.Completed first = run(released("evt-declined-1"));

        assertEquals("no-assignment", first.outcome().get("state").textValue());
        assertTrue(f.text("SELECT evaluation::text FROM allocation_evaluations WHERE allocation_id = ?",
                idOf(released("evt-declined-1"))).contains("declined-unchanged"));
        assertEquals(List.of(), f.occupying());

        f.brief("e-a", 2, AllocationFixture.digest("e-a-changed"), true);
        AllocationResult.Completed second = run(new Trigger("brief-changed", "evt-brief-2", List.of(), List.of()));
        assertEquals("allocated", second.outcome().get("state").textValue());
        assertEquals(List.of("e-a:car-1"), f.occupying());
    }

    @Test
    void aLapsedHolderSitsOutWhenItsHoldIsReturned() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        f.hold("h-lapsed", "car-1", "e-a", 1, "expired", "{\"releaseReason\":\"buddy-expired\"}");
        candidates.eligible("e-a", "car-1", 99).eligible("e-b", "car-1", 10);
        run(new Trigger("buddy-expired", "evt-expired", List.of("h-lapsed"), List.of("car-1")));

        assertEquals(List.of("e-b"), f.column("SELECT employee_id FROM allocation_evaluations"));
        assertEquals(List.of("e-b:car-1"), f.occupying());
    }

    @Test
    void anUncertainCommitIsInspectedNotAssumed() throws Exception {
        for (boolean committed : new boolean[] {true, false}) {
            try (AllocationFixture g = AllocationFixture.create()) {
                g.car("car-1");
                g.car("car-2");
                g.employee("e-a", "2027-01-01");
                g.employee("e-b", "2027-02-01");
                ScriptedCandidates c = new ScriptedCandidates();
                c.eligible("e-a", "car-1", 90).eligible("e-b", "car-2", 80);
                // Commit 1 is prepare and 2 the first claim: it commits (or not) and then the connection "drops".
                AllocationService flaky = new AllocationService(new FlakyCommits(g.pool(), 2, committed), policy, c);
                Trigger t = released("evt-uncertain-" + committed);
                assertInstanceOf(AllocationResult.Completed.class, flaky.allocate(AllocationFixture.scope(), t));

                assertEquals(List.of("e-a:car-1", "e-b:car-2"), g.occupying());
                assertEquals(2, g.count("SELECT count(*) FROM custody_holds"));
                assertEquals(2, g.count("SELECT count(*) FROM buddy_offers"));
                assertEquals(2, g.count("SELECT count(*) FROM allocation_attempts"));
            }
        }
    }

    @Test
    void anUnreachableDatabaseIsPendingAndRetryable() throws Exception {
        org.postgresql.ds.PGSimpleDataSource dead = AllocationFixture.plain("jdbc:postgresql://localhost:1/none?user=x");
        dead.setLoginTimeout(2);
        AllocationResult r = new AllocationService(dead, policy, candidates).allocate(AllocationFixture.scope(),
                released("evt-dead"));
        AllocationResult.Pending pending = assertInstanceOf(AllocationResult.Pending.class, r);
        assertEquals("database-unavailable", pending.code());
        assertTrue(pending.retryable());
    }

    @Test
    void aCarALapsedHolderLetGoIsNotHandedBackToThemButOtherCarsAre() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.car("car-3");
        f.employee("e-a", "2027-01-01");
        f.employee("e-x", "2027-02-01");
        f.hold("h-old", "car-1", "e-a", 1, "expired", "{\"releaseReason\":\"buddy-expired\"}");
        f.hold("h-other", "car-3", "e-x", 1, "expired", "{\"releaseReason\":\"buddy-expired\"}");
        candidates.eligible("e-a", "car-1", 99).eligible("e-a", "car-2", 40);
        run(new Trigger("buddy-expired", "evt-letlapse", List.of("h-other"), List.of("car-3")));

        assertEquals(List.of("e-a:car-2"), f.occupying());
        assertEquals(List.of("e-a:car-2"), f.contenders(idOf(new Trigger("buddy-expired", "evt-letlapse", List.of(), List.of()))));
    }

    @Test
    void unavailableCandidatesOrPolicyRefuseWithoutWriting() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        candidates.override = new EligibleCandidates.Unavailable("recommendation-unavailable");
        AllocationResult.Refused down = assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(AllocationFixture.scope(), released("evt-down")));
        assertEquals("candidates-unavailable", down.code());

        candidates.override = null;
        AllocationScope missing = new AllocationScope("test-env", "run-1", "gcsp-policy-v0", AllocationFixture.T0, 1);
        AllocationResult.Refused noPolicy = assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(missing, released("evt-nopolicy")));
        assertEquals("policy-unavailable", noPolicy.code());

        for (String table : List.of("allocation_runs", "allocation_contenders", "allocation_evaluations",
                "allocation_attempts", "buddy_quotes", "buddy_offers", "custody_holds", "command_receipts",
                "outbox_events")) {
            assertEquals(0, f.count("SELECT count(*) FROM " + table), table);
        }
        assertEquals(0, f.count("SELECT revision FROM runs"));
    }

    @Test
    void anEmployeeBriefWithoutItsOwnerIsRefused() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.update("DELETE FROM custody_holds");
        f.update("UPDATE employees SET attributes = '{\"companyId\":\"co-1\",\"schemeId\":\"scheme-1\","
                + "\"entitlementSlotId\":\"slot-missing\"}'::jsonb WHERE employee_id = 'e-a'");
        AllocationResult.Refused refused = assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(AllocationFixture.scope(), released("evt-owner")));
        assertEquals("brief-owner-unavailable", refused.code());
        assertEquals(0, f.count("SELECT count(*) FROM allocation_runs"));
    }

    @Test
    void invalidTriggersAreRefused() {
        assertEquals("invalid-trigger", assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(AllocationFixture.scope(), new Trigger("nope", "e", List.of(), List.of()))).code());
        assertEquals("invalid-trigger", assertInstanceOf(AllocationResult.Refused.class,
                service.allocate(AllocationFixture.scope(), new Trigger("buddy-expired", "e", List.of(), List.of()))).code());
    }

    private static List<AllocationResult> twoThreads(java.util.concurrent.Callable<AllocationResult> a,
            java.util.concurrent.Callable<AllocationResult> b) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<AllocationResult>> futures = new ArrayList<>();
            for (java.util.concurrent.Callable<AllocationResult> work : List.of(a, b)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return work.call();
                }));
            }
            start.countDown();
            List<AllocationResult> out = new ArrayList<>();
            for (Future<AllocationResult> future : futures) out.add(future.get(60, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }
}
