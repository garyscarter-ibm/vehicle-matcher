package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.BuddyExpiry;
import gcsp.api.allocation.ExpiryResult;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.allocation.ScriptedRemote;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickKind;
import gcsp.api.clock.TickRequest;
import gcsp.api.clock.bound.OfferDecisionTickHandler;
import gcsp.api.persistence.RunContext;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** Remote offer decline over real Postgres: intent before I/O, one finalization, truthful custody while unknown. */
class RemoteOfferDeclinePgTest {

    private static final String DECLINE = "execute:offer-decline-release";
    private static final String RECONCILE = "reconcile:offer-decline-release";

    private static DecisionEnv open(ScriptedRemote remote) throws SQLException {
        DecisionEnv env = DecisionEnv.open(true);
        env.makeRemoteOffered(remote);
        return env;
    }

    private static String op(DecisionEnv env, String column) throws SQLException {
        return env.text("SELECT " + column + " FROM pending_operations WHERE operation_type = 'offer-decline-release'");
    }

    private static void assertPending(DecisionEnv env, String lastKnown) throws SQLException {
        assertEquals("release-pending", env.text("SELECT state FROM custody_holds"));
        assertEquals("release-pending", env.text("SELECT state FROM buddy_offers"));
        assertEquals("released", env.text("SELECT state FROM stock_cars"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        assertEquals("pending", op(env, "state"));
        assertEquals(lastKnown, op(env, "outcome->>'lastKnownState'"));
    }

    private static void assertDeclined(DecisionEnv env) throws SQLException {
        assertEquals("released", env.text("SELECT state FROM custody_holds"));
        assertEquals("offer-declined", env.text("SELECT attributes->>'releaseReason' FROM custody_holds"));
        assertEquals("declined", env.text("SELECT state FROM buddy_offers"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'decline' AND reason_code = 'size'"));
        assertEquals("cmd-1", env.text("SELECT command_id FROM offer_decisions"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined' "
                + "AND event_id = 'offer-declined:' || (SELECT hold_id FROM custody_holds)"));
        assertEquals("acknowledged", op(env, "state"));
        assertEquals(3, env.count("SELECT version FROM stock_cars"));
    }

    @Test
    void confirmedDeclinePersistsIntentBeforeTheCallThenFinalizesOnce() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(op -> {
                try {
                    seen.set(env.text("SELECT h.state || '|' || o.state || '|' || p.state FROM custody_holds h, buddy_offers o, "
                            + "pending_operations p WHERE p.operation_type = 'offer-decline-release'"));
                } catch (SQLException e) {
                    seen.set(e.getMessage());
                }
                return ScriptedRemote.confirmed().apply(op);
            });
            OfferOutcome o = env.decideOk();
            assertEquals("release-pending|release-pending|pending", seen.get());
            assertEquals(202, o.http(), o.code());
            assertEquals("pending", o.status());
            assertEquals("release-pending", o.code());
            JsonNode v = o.value();
            assertEquals("pending", v.get("state").textValue());
            assertEquals("release-pending", v.get("reason").textValue());
            assertTrue(v.get("reconciliationRequired").booleanValue());
            assertEquals(2, v.get("offerVersion").asLong());
            assertEquals(2, v.get("holdVersion").asLong());
            assertEquals(0, v.get("availableActions").size());
            assertEquals(op(env, "operation_id"), v.get("operationId").textValue());
            assertDeclined(env);
            assertEquals(List.of(DECLINE), remote.calls);
        }
    }

    @Test
    void aLostResponseIsFinalizedAfterARestartByReconcileWithoutASecondExecute() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, env.decideOk().http());
            assertPending(env, "unknown");
            assertEquals(1, env.count("SELECT attempts FROM pending_operations WHERE operation_type = 'offer-decline-release'"));

            OfferDecisions restarted = env.service(DecisionEnv.policy(true));
            OfferDecisionTickHandler handler = new OfferDecisionTickHandler(() -> true, () -> remote, () -> restarted);
            assertTrue(handler.enabled());
            HandlerOutcome out = handler.handle(new TickRequest(new RunContext(OffersPg.ENV, "run-1", "system:clock"),
                    "tick-1", DecisionEnv.NOW, 1, DecisionEnv.POLICY, "op-1", TickKind.STARTUP));
            JsonNode counts = assertInstanceOf(HandlerOutcome.Ok.class, out).value();
            assertEquals(1, counts.get("driven").asInt());
            assertEquals(1, counts.get("settled").asInt());
            assertDeclined(env);
            assertEquals(List.of(DECLINE, RECONCILE), remote.calls);
            assertEquals(0, restarted.reconcileRemote(OffersPg.ENV, "run-1", 100).driven());
        }
    }

    @Test
    void aRejectedReleaseKeepsCustodyUntilALaterConfirmation() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.answer("rejected")).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, env.decideOk().http());
            assertPending(env, "rejected");
            ReconcileResult first = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertEquals(1, first.settled());
            assertDeclined(env);
            assertEquals(List.of(DECLINE, RECONCILE), remote.calls);
        }
    }

    @Test
    void malformedOrMismatchedAcknowledgementsLeaveTheDeclinePendingUnknown() throws Exception {
        List<ScriptedRemote.Step> bad = List.of(
                op -> new RemoteBuddy.Ack("confirmed", op.operationId(), op.runId(), "other-order"),
                op -> new RemoteBuddy.Ack("confirmed", "other-op", op.runId(), op.orderUuid()),
                op -> new RemoteBuddy.Ack("confirmed", op.operationId(), "other-run", op.orderUuid()),
                ScriptedRemote.answer("ok"),
                op -> null);
        for (ScriptedRemote.Step step : bad) {
            ScriptedRemote remote = new ScriptedRemote();
            try (DecisionEnv env = open(remote)) {
                remote.onExecute(step);
                assertEquals(202, env.decideOk().http());
                assertPending(env, "unknown");
                assertEquals(List.of(DECLINE), remote.calls);
            }
        }
    }

    @Test
    void notFoundAfterAReconcileRetriesExecuteOnce() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost(), ScriptedRemote.confirmed()).onReconcile(ScriptedRemote.answer("not-found"));
            assertEquals(202, env.decideOk().http());
            assertPending(env, "unknown");
            ReconcileResult r = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertEquals(1, r.settled());
            assertDeclined(env);
            assertEquals(List.of(DECLINE, RECONCILE, DECLINE), remote.calls);
        }
    }

    @Test
    void aNotFoundAfterExecuteIsUnknownNotAnAnswer() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.answer("not-found"));
            assertEquals(202, env.decideOk().http());
            assertPending(env, "unknown");
            assertEquals(List.of(DECLINE), remote.calls);
        }
    }

    @Test
    void replaysAndConflictsKeepTheOriginalPendingReceipt() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.confirmed());
            OfferOutcome first = env.decideOk();
            assertDeclined(env);
            long rows = env.written();

            OfferOutcome again = env.decideOk();
            assertEquals(202, again.http(), again.code());
            assertTrue(again.value().get("replayed").booleanValue());
            assertEquals("pending", again.value().get("state").textValue());
            assertEquals(first.value().get("operationId"), again.value().get("operationId"));
            assertEquals(first.value().get("decidedAt"), again.value().get("decidedAt"));

            OfferOutcome other = env.decide(DecisionEnv.decline("cmd-2", "size", 1, 1));
            assertEquals(409, other.http());
            assertEquals("offer-no-longer-pending", other.code());
            OfferOutcome changed = env.decide(DecisionEnv.decline("cmd-1", "fuel", 1, 1));
            assertEquals(409, changed.http());
            assertEquals("command-input-changed", changed.code());
            assertEquals(rows, env.written());
            assertEquals(List.of(DECLINE), remote.calls);
        }
    }

    @Test
    void whileReleasePendingAnotherCommandSeesAPendingOffer() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost());
            assertEquals(202, env.decideOk().http());
            OfferOutcome other = env.decide(DecisionEnv.decline("cmd-2", "size", 2, 2));
            assertEquals(409, other.http());
            assertEquals("offer-no-longer-pending", other.code());
            assertEquals("pending", other.current().get("state").textValue());
            assertEquals(202, env.decideOk().http());
            assertPending(env, "unknown");
        }
    }

    @Test
    void twoConcurrentDeclinesRecordOneIntentAndOneExecute() throws Exception {
        for (int i = 0; i < 10; i++) {
            ScriptedRemote remote = new ScriptedRemote();
            try (DecisionEnv env = open(remote)) {
                remote.onExecute(ScriptedRemote.confirmed());
                var a = DecisionEnv.decline("cmd-a", "size", 1, 1);
                var b = DecisionEnv.decline("cmd-b", "size", 1, 1);
                List<OfferOutcome> out = race(() -> env.decide(a), () -> env.decide(b));
                assertEquals(1, out.stream().filter(o -> o.http() == 202).count(), out.toString());
                assertEquals("offer-no-longer-pending", out.stream().filter(o -> o.http() != 202).findFirst().orElseThrow().code());
                assertEquals(1, env.count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-decline-release'"));
                assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
                assertEquals(List.of(DECLINE), remote.calls);
            }
        }
    }

    @Test
    void aPassedDeadlineNeverExpiresOrRefusesAnAuthorisedPendingDecline() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, env.decideOk().http());
            Instant due = DecisionEnv.NOW.plusSeconds(3600);
            BuddyExpiry expiry = new BuddyExpiry(env.pg.pool(), DecisionEnv.policy(true), remote);
            ExpiryResult r = expiry.expire(new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, due.plusSeconds(60), 1));
            ExpiryResult.Done done = assertInstanceOf(ExpiryResult.Done.class, r);
            assertTrue(done.expired().isEmpty() && done.releases().isEmpty());
            assertEquals(0, env.count("SELECT count(*) FROM buddy_operations WHERE operation_type = 'buddy-release'"));
            assertPending(env, "unknown");

            env.now[0] = due.plusSeconds(60);
            env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertDeclined(env);
            assertEquals("declined", env.text("SELECT state FROM buddy_offers"));
        }
    }

    @Test
    void aRetiredRunWritesNothingAndTheNewRunDrivesNothing() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(op -> {
                env.pg.rollRun("run-1", "run-2");
                return ScriptedRemote.confirmed().apply(op);
            });
            assertEquals(202, env.decideOk().http());
            assertPending(env, "release-pending");
            assertEquals(1, env.count("SELECT attempts FROM pending_operations WHERE operation_type = 'offer-decline-release'"));
            ReconcileResult r = env.decisions.reconcileRemote(OffersPg.ENV, "run-2", 100);
            assertEquals(0, r.driven());
            assertEquals(List.of(DECLINE), remote.calls);
            assertEquals("release-pending", env.text("SELECT state FROM custody_holds"));
            assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        }
    }

    @Test
    void misalignedRowsStayPendingAndFinalizeNothing() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, env.decideOk().http());
            env.pg.update("UPDATE stock_cars SET version = version + 1");
            ReconcileResult r = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertEquals(1, r.pending());
            assertEquals(List.of(DECLINE), remote.calls);
            assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
            assertEquals("release-pending", env.text("SELECT state FROM custody_holds"));
        }
    }

    @Test
    void remoteModeWithoutAnOfferedClaimIsInconsistentAndAcceptStaysRefused() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            env.pg.update("UPDATE pending_operations SET outcome = '{\"state\":\"released\"}'::jsonb");
            OfferOutcome o = env.decideOk();
            assertEquals(503, o.http());
            assertEquals("offer-authority-inconsistent", o.code());
            assertEquals(0, env.count("SELECT count(*) FROM offer_decision_operations"));
            assertEquals("active", env.text("SELECT state FROM custody_holds"));
            assertEquals("remote-decision-protocol-required", env.decide(env.accept("cmd-9", 1, 1, null)).code());
            assertTrue(remote.calls.isEmpty());
        }
    }

    @Test
    void theTickHandlerIsDisabledOutsideRemoteMode() throws Exception {
        try (DecisionEnv env = DecisionEnv.open(true)) {
            assertFalse(new OfferDecisionTickHandler(() -> true, LocalSyntheticBuddy::new, () -> env.decisions).enabled());
            assertTrue(new OfferDecisionTickHandler(() -> true, ScriptedRemote::new, () -> env.decisions).enabled());
            assertFalse(new OfferDecisionTickHandler(() -> false, ScriptedRemote::new, () -> env.decisions).enabled());
            assertNull(env.text("SELECT operation_id FROM pending_operations"));
        }
    }

    @SafeVarargs
    private static <T> List<T> race(Callable<T>... jobs) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(jobs.length);
        try {
            CountDownLatch ready = new CountDownLatch(jobs.length);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<T>> futures = new ArrayList<>();
            for (Callable<T> job : jobs) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return job.call();
                }));
            }
            ready.await();
            go.countDown();
            List<T> out = new ArrayList<>();
            for (Future<T> f : futures) out.add(f.get());
            return out;
        } finally {
            pool.shutdownNow();
        }
    }
}
