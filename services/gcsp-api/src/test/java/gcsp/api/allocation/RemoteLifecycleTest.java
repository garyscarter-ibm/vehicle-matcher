package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RemoteLifecycleTest {

    AllocationFixture f;
    ScriptedCandidates candidates;
    PolicyService policy;
    ScriptedRemote remote;

    @BeforeEach
    void setUp() throws Exception {
        f = AllocationFixture.create();
        candidates = new ScriptedCandidates();
        policy = new PolicyService(new RetainedFilePolicySource());
        remote = new ScriptedRemote();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    AllocationService service() throws Exception {
        return new AllocationService(f.pool(), policy, candidates, remote);
    }

    BuddyRemoteLifecycle lifecycle(DataSource pool) {
        return new BuddyRemoteLifecycle(pool, policy, candidates, remote);
    }

    AllocationResult.Completed allocate(String eventId) throws Exception {
        return assertInstanceOf(AllocationResult.Completed.class,
                service().allocate(AllocationFixture.scope(), AllocationTest.released(eventId)));
    }

    DriveResult drive(String operationId) throws Exception {
        return lifecycle(f.pool()).drive(AllocationFixture.scope(), operationId);
    }

    String claimOp() throws Exception {
        return f.text("SELECT operation_id FROM pending_operations WHERE operation_type = 'buddy-claim' "
                + "ORDER BY created_at, operation_id LIMIT 1");
    }

    String releaseOp() throws Exception {
        return f.text("SELECT operation_id FROM pending_operations WHERE operation_type = 'buddy-release' "
                + "ORDER BY created_at, operation_id LIMIT 1");
    }

    String op(String operationId) throws Exception {
        return f.text("SELECT state || '|' || attempts || '|' || coalesce(outcome->>'lastKnownState', '') "
                + "FROM pending_operations WHERE operation_id = ?", operationId);
    }

    long offers() throws Exception {
        return f.count("SELECT count(*) FROM buddy_offers WHERE state IN ('active', 'release-pending')");
    }

    long notifications() throws Exception {
        return f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'");
    }

    @Test
    void aRemoteClaimWaitsPendingThenAConfirmationMakesTheOfferAndOneNotification() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-b", "car-1", 40);
        String[] seen = new String[1];
        remote.onExecute(op -> {
            seen[0] = f.text("SELECT h.state || '|' || (SELECT count(*) FROM buddy_offers) || '|' || p.state || '|' "
                    + "|| p.attempts || '|' || (SELECT count(*) FROM outbox_events WHERE event_type = "
                    + "'notification.offer.v1') FROM custody_holds h, pending_operations p");
            return ScriptedRemote.confirmed().apply(op);
        });

        AllocationResult.Completed done = allocate("evt-1");

        assertEquals("claim-pending|0|pending|1|0", seen[0]);
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM allocation_attempts"));
        assertEquals("claim-pending", f.text("SELECT status FROM allocation_attempts"));
        assertEquals("allocated", done.outcome().path("state").asText());
        String claim = claimOp();
        assertEquals("acknowledged|1", op(claim).substring(0, 14));
        assertEquals("active|2", f.text("SELECT state || '|' || version FROM custody_holds"));
        assertEquals("active", f.text("SELECT state FROM buddy_offers"));
        assertEquals(claim, f.text("SELECT operation_id FROM buddy_offers"));
        assertEquals(1, notifications());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_operations WHERE operation_type = 'buddy-claim'"));
        assertEquals("offered", f.text("SELECT outcome->>'state' FROM pending_operations WHERE operation_id = ?", claim));
        assertEquals(List.of("execute:buddy-claim"), remote.calls);
        assertEquals("2", f.text("SELECT version::text FROM stock_cars"));
        assertEquals(2, AllocationFixture.json(f.text("SELECT payload::text FROM buddy_operations"))
                .path("expectedStockVersion").asInt());

        // A second drive of a closed operation settles without another remote call or notification.
        DriveResult again = drive(claim);
        assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, again).state());
        assertEquals(1, remote.calls.size());
        assertEquals(1, notifications());
    }

    @Test
    void aRejectedClaimReleasesTheHoldRefusesTheOperationAndFreesTheCar() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        remote.onExecute(ScriptedRemote.answer("rejected"));

        allocate("evt-1");

        String claim = claimOp();
        assertEquals("refused|1|", op(claim));
        assertEquals("released", f.text("SELECT state FROM custody_holds"));
        assertEquals("buddy-claim-rejected", f.text("SELECT attributes->>'releaseReason' FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(0, notifications());
        assertEquals(List.of(), f.occupying());
        assertEquals("3", f.text("SELECT version::text FROM stock_cars"));

        remote.onExecute(ScriptedRemote.confirmed());
        allocate("evt-2");
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
        assertEquals(2, f.count("SELECT count(*) FROM buddy_operations"));
    }

    @Test
    void aLostResponseKeepsTheCarOccupiedAndTheNextDriveReconciles() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-b", "car-1", 60);

        allocate("evt-1");
        String claim = claimOp();
        assertEquals("pending|1|unknown", op(claim));
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
        assertEquals(0, offers());

        AllocationResult.Completed second = allocate("evt-2");
        assertEquals("no-assignment", second.outcome().path("state").asText());
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));

        remote.onReconcile(ScriptedRemote.confirmed());
        DriveResult r = drive(claim);
        assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, r).state());
        assertEquals(List.of("execute:buddy-claim", "reconcile:buddy-claim"), remote.calls);
        assertEquals("acknowledged|2|", op(claim).substring(0, 15));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals(1, offers());
        assertEquals(1, notifications());
    }

    @Test
    void notFoundFromExecuteStaysUnknownAndOnlyAReconcileAbsenceAllowsAnotherExecute() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        remote.onExecute(ScriptedRemote.answer("not-found"), ScriptedRemote.confirmed());
        remote.onReconcile(ScriptedRemote.answer("not-found"));

        allocate("evt-1");
        String claim = claimOp();
        assertEquals("pending|1|unknown", op(claim));
        assertEquals(List.of("execute:buddy-claim"), remote.calls);

        DriveResult r = drive(claim);
        assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, r).state());
        assertEquals(List.of("execute:buddy-claim", "reconcile:buddy-claim", "execute:buddy-claim"), remote.calls);
        assertEquals("acknowledged|3|", op(claim).substring(0, 15));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals(1, offers());
        assertEquals(1, notifications());
    }

    @Test
    void aMismatchedAcknowledgementStaysPendingAndUnknown() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        remote.onExecute(op -> new RemoteBuddy.Ack("confirmed", "someone-else", op.runId(), op.orderUuid()));
        remote.onReconcile(op -> new RemoteBuddy.Ack("confirmed", op.operationId(), op.runId(), "car-9"),
                op -> new RemoteBuddy.Ack("confirmed", op.operationId(), "run-2", op.orderUuid()));

        allocate("evt-1");
        String claim = claimOp();
        assertEquals("pending|1|unknown", op(claim));
        DriveResult second = drive(claim);
        assertEquals("unknown", assertInstanceOf(DriveResult.Pending.class, second).lastKnownState());
        DriveResult third = drive(claim);
        assertEquals("unknown", assertInstanceOf(DriveResult.Pending.class, third).lastKnownState());
        assertEquals("pending|3|unknown", op(claim));
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
        assertEquals(0, offers());
        assertEquals(0, notifications());
        assertEquals(List.of("e-a:car-1"), f.occupying());
    }

    @Test
    void aConfirmedClaimWhoseCarChangedStartsARemoteReleaseAndFreesTheCarOnlyWhenItConfirms() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90);
        remote.onExecute(op -> {
            f.update("UPDATE stock_cars SET version = version + 1");
            return ScriptedRemote.confirmed().apply(op);
        });

        allocate("evt-1");
        String claim = claimOp();
        String release = releaseOp();
        assertEquals("acknowledged", f.text("SELECT state FROM pending_operations WHERE operation_id = ?", claim));
        assertEquals("release-pending", f.text("SELECT outcome->>'state' FROM pending_operations WHERE operation_id = ?", claim));
        assertEquals("release-pending|prerequisites-changed", f.text("SELECT state || '|' || (attributes->>'releaseReason') "
                + "FROM custody_holds"));
        assertEquals(release, f.text("SELECT operation_id FROM custody_holds"));
        assertEquals(claim, f.text("SELECT source_claim_operation_id FROM buddy_operations WHERE operation_id = ?", release));
        assertEquals("intent|0|", op(release));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(0, notifications());
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals("released", AllocationFixture.json(f.text("SELECT payload::text FROM buddy_operations "
                + "WHERE operation_id = ?", release)).path("target").asText());

        // Until the release is confirmed another allocation gets nothing.
        candidates.eligible("e-b", "car-1", 50);
        assertEquals("no-assignment", allocate("evt-2").outcome().path("state").asText());
        assertEquals(List.of("e-a:car-1"), f.occupying());

        remote.onExecute(ScriptedRemote.confirmed());
        DriveResult r = drive(release);
        assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, r).state());
        assertEquals("released|prerequisites-changed", f.text("SELECT state || '|' || (attributes->>'releaseReason') "
                + "FROM custody_holds"));
        assertEquals(List.of(), f.occupying());
        assertEquals("4", f.text("SELECT version::text FROM stock_cars"));
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired'"));
    }

    @Test
    void remoteExpiryStartsAReleaseKeepsTheCarAndOnlyAConfirmedReleaseLapsesIt() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90);
        remote.onExecute(ScriptedRemote.confirmed());
        allocate("evt-1");
        String claim = claimOp();
        assertEquals("active", f.text("SELECT state FROM custody_holds"));

        Instant later = Instant.parse("2026-11-14T11:30:00Z");
        AllocationScope scope = new AllocationScope(AllocationFixture.ENV, AllocationFixture.RUN,
                AllocationFixture.POLICY, later, 2);
        BuddyExpiry expiry = new BuddyExpiry(f.pool(), policy, remote);
        ExpiryResult.Done done = assertInstanceOf(ExpiryResult.Done.class, expiry.expire(scope));
        assertEquals(List.of(), done.expired());
        assertEquals(List.of(), done.retained());
        assertEquals(1, done.releases().size());
        String release = releaseOp();
        assertEquals(release, done.releases().get(0).operationId());
        assertEquals("release-pending|buddy-expired", f.text("SELECT state || '|' || (attributes->>'releaseReason') "
                + "FROM custody_holds"));
        assertEquals("release-pending", f.text("SELECT state FROM buddy_offers"));
        assertEquals(List.of("e-a:car-1"), f.occupying());
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired'"));
        ExpiryResult.Done replay = assertInstanceOf(ExpiryResult.Done.class, expiry.expire(scope));
        assertTrue(replay.replayed());
        assertEquals(1, f.count("SELECT count(*) FROM buddy_operations WHERE operation_type = 'buddy-release'"));

        // The release call is lost: the hold keeps occupying the car.
        DriveResult lost = lifecycle(f.pool()).drive(scope, release);
        assertEquals("unknown", assertInstanceOf(DriveResult.Pending.class, lost).lastKnownState());
        assertEquals("pending|1|unknown", op(release));
        assertEquals(List.of("e-a:car-1"), f.occupying());

        remote.onReconcile(ScriptedRemote.confirmed());
        DriveResult r = lifecycle(f.pool()).drive(scope, release);
        assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, r).state());
        assertEquals("expired", f.text("SELECT state FROM custody_holds"));
        assertEquals("expired", f.text("SELECT state FROM buddy_offers"));
        assertEquals(List.of(), f.occupying());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_id = 'buddy-expired:"
                + f.text("SELECT hold_id FROM custody_holds") + "'"));
        assertEquals("acknowledged", f.text("SELECT state FROM pending_operations WHERE operation_id = ?", claim));

        // The lapse trigger now allocates the car to the next contender.
        candidates.eligible("e-b", "car-1", 50);
        remote.onExecute(ScriptedRemote.confirmed());
        AllocationService svc = service();
        TriggerResult.Consumed consumed = assertInstanceOf(TriggerResult.Consumed.class,
                new AllocationTriggers(f.pool(), svc).consume(scope, 5));
        assertEquals(1, consumed.allocations().size());
        assertEquals("allocated", consumed.allocations().get(0).state());
        assertEquals(List.of("e-b:car-1"), f.occupying());
        assertEquals("active", f.text("SELECT state FROM custody_holds WHERE employee_id = 'e-b'"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers WHERE employee_id = 'e-b' AND state = 'active'"));
    }

    @Test
    void localHoldsAndUnconfirmedRemoteHoldsAreRetainedNotReleased() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90);
        f.buddyHold("h-local", "car-2", "e-b", 1, "2026-11-14T09:30:00Z");
        allocate("evt-1");
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds WHERE employee_id = 'e-a'"));
        AllocationScope scope = new AllocationScope(AllocationFixture.ENV, AllocationFixture.RUN,
                AllocationFixture.POLICY, Instant.parse("2026-11-14T12:30:00Z"), 2);
        ExpiryResult.Done done = assertInstanceOf(ExpiryResult.Done.class,
                new BuddyExpiry(f.pool(), policy, remote).expire(scope));
        assertEquals(List.of(), done.releases());
        assertEquals(List.of("h-local"), done.expired().stream().map(ExpiryResult.Lapse::holdId).toList());
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds WHERE employee_id = 'e-a'"));
        assertEquals(0, f.count("SELECT count(*) FROM buddy_operations WHERE operation_type = 'buddy-release'"));
    }

    @Test
    void restartReconcilesEveryOpenOperationWithoutDuplicates() throws Exception {
        f.car("car-1");
        f.car("car-2");
        f.employee("e-a", "2027-01-01");
        f.employee("e-b", "2027-02-01");
        candidates.eligible("e-a", "car-1", 90).eligible("e-b", "car-2", 80);

        allocate("evt-1");
        assertEquals(2, f.count("SELECT count(*) FROM pending_operations WHERE state = 'pending'"));
        assertEquals(0, offers());

        remote.calls.clear();
        remote.fallback = ScriptedRemote.confirmed();
        ReconcileResult r = lifecycle(f.pool()).reconcile(AllocationFixture.scope());
        assertEquals(2, r.driven());
        assertEquals(2, r.settled());
        assertEquals(0, r.pending());
        assertNull(r.firstPendingId());
        assertEquals(List.of("reconcile:buddy-claim", "reconcile:buddy-claim"), remote.calls);
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds WHERE state = 'active'"));
        assertEquals(2, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(2, notifications());

        ReconcileResult again = lifecycle(f.pool()).reconcile(AllocationFixture.scope());
        assertEquals(0, again.driven());
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(2, notifications());
    }

    @Test
    void reconcileReportsTheFirstOperationThatIsStillPending() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        allocate("evt-1");
        ReconcileResult r = lifecycle(f.pool()).reconcile(AllocationFixture.scope());
        assertEquals(1, r.pending());
        assertEquals(claimOp(), r.firstPendingId());
        assertEquals("claim-pending", f.text("SELECT state FROM custody_holds"));
    }

    @Test
    void twoWorkersDrivingTheSameOperationMakeOneOfferAndOneNotification() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        allocate("evt-1");
        String claim = claimOp();
        remote.fallback = ScriptedRemote.confirmed();

        CountDownLatch go = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<DriveResult>> results = new java.util.ArrayList<>();
            for (int i = 0; i < 2; i++) {
                results.add(pool.submit(() -> {
                    go.await();
                    return lifecycle(f.pool()).drive(AllocationFixture.scope(), claim);
                }));
            }
            go.countDown();
            for (Future<DriveResult> r : results) r.get(60, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(1, notifications());
        assertEquals("acknowledged|2|", op(claim).substring(0, 15));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE state = 'active'"));
        // Allocation's own drive (attempt, lost ack) is versions 1 to 3; the raced drive adds attempt and ack once.
        assertEquals("5", f.text("SELECT version::text FROM pending_operations WHERE operation_id = ?", claim));
    }

    @Test
    void anUncertainCommitOnTheAcknowledgementIsInspectedNotDuplicated() throws Exception {
        for (boolean commitFirst : new boolean[] {true, false}) {
            try (AllocationFixture g = AllocationFixture.create()) {
                g.car("car-1");
                g.employee("e-a", "2027-01-01");
                ScriptedCandidates cands = new ScriptedCandidates().eligible("e-a", "car-1", 90);
                ScriptedRemote lost = new ScriptedRemote();
                new AllocationService(g.pool(), policy, cands, lost).allocate(AllocationFixture.scope(),
                        AllocationTest.released("evt-1"));
                String claim = g.text("SELECT operation_id FROM pending_operations");
                lost.fallback = ScriptedRemote.confirmed();
                // Attempt is the first commit, the acknowledgement the second.
                DataSource flaky = new FlakyCommits(g.pool(), 2, commitFirst);
                DriveResult r = new BuddyRemoteLifecycle(flaky, policy, cands, lost).drive(AllocationFixture.scope(), claim);
                assertEquals("acknowledged", assertInstanceOf(DriveResult.Settled.class, r).state(), "commitFirst=" + commitFirst);
                assertEquals(1, g.count("SELECT count(*) FROM buddy_offers"));
                assertEquals(1, g.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
                assertEquals("active", g.text("SELECT state FROM custody_holds"));
                assertEquals("acknowledged", g.text("SELECT state FROM pending_operations WHERE operation_id = ?", claim));
            }
        }
    }

    @Test
    void localSyntheticModeIsUnchangedAndNeverCallsARemote() throws Exception {
        f.car("car-1");
        f.employee("e-a", "2027-01-01");
        candidates.eligible("e-a", "car-1", 90);
        AllocationResult r = new AllocationService(f.pool(), policy, candidates)
                .allocate(AllocationFixture.scope(), AllocationTest.released("evt-1"));
        assertInstanceOf(AllocationResult.Completed.class, r);
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM pending_operations"));
        assertEquals(1, f.count("SELECT count(*) FROM buddy_offers"));
        assertEquals("buddy-remote-unavailable", assertInstanceOf(DriveResult.Refused.class,
                new BuddyRemoteLifecycle(f.pool(), policy, candidates, new LocalSyntheticBuddy())
                        .drive(AllocationFixture.scope(), "x")).code());
    }
}
