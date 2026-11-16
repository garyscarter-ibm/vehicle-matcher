package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.BuddyExpiry;
import gcsp.api.allocation.ExpiryResult;
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

/** Remote offer accept over real Postgres: intent before I/O, one conversion on confirmation, truthful custody otherwise. */
class RemoteOfferAcceptPgTest {

    private static final String EXECUTE = "execute:offer-selection";
    private static final String RECONCILE = "reconcile:offer-selection";
    private static final String TYPE = "operation_type = 'offer-selection'";

    private static DecisionEnv open(ScriptedRemote remote) throws SQLException {
        DecisionEnv env = DecisionEnv.open(true);
        env.makeRemoteOffered(remote);
        return env;
    }

    private static String op(DecisionEnv env, String column) throws SQLException {
        return env.text("SELECT " + column + " FROM pending_operations WHERE " + TYPE);
    }

    private static OfferOutcome accept(DecisionEnv env) throws SQLException {
        return env.decide(env.accept("cmd-1", 1, 1, null));
    }

    private static void assertPending(DecisionEnv env, String lastKnown) throws SQLException {
        assertEquals("selection-pending", env.text("SELECT state FROM custody_holds"));
        assertEquals("decision-pending", env.text("SELECT state FROM buddy_offers"));
        assertEquals("released", env.text("SELECT state FROM stock_cars"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals("pending", op(env, "state"));
        assertEquals(lastKnown, op(env, "outcome->>'lastKnownState'"));
    }

    private static void assertAccepted(DecisionEnv env) throws SQLException {
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals("accepted", env.text("SELECT state FROM buddy_offers"));
        assertEquals("allocated", env.text("SELECT state FROM stock_cars"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept' AND command_id = 'cmd-1'"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted' "
                + "AND event_id = 'offer-accepted:' || (SELECT hold_id FROM custody_holds)"));
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals("acknowledged", op(env, "state"));
        assertEquals(3, env.count("SELECT version FROM stock_cars"));
        assertEquals(3, env.count("SELECT version FROM custody_holds"));
        assertEquals(3, env.count("SELECT version FROM buddy_offers"));
    }

    private static void assertRestored(DecisionEnv env) throws SQLException {
        assertEquals("active", env.text("SELECT state FROM custody_holds"));
        assertEquals("claim-1", env.text("SELECT operation_id FROM custody_holds"));
        assertEquals("active", env.text("SELECT state FROM buddy_offers"));
        assertEquals("refused", op(env, "state"));
        assertEquals("selection-refused", op(env, "outcome->>'state'"));
        assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(DecisionEnv.NOW.plusSeconds(3600).toEpochMilli(),
                env.count("SELECT (extract(epoch FROM expires_at) * 1000)::bigint FROM custody_holds"));
        assertEquals(3, env.count("SELECT version FROM custody_holds"));
    }

    @Test
    void confirmedAcceptPersistsIntentBeforeTheCallThenConvertsOnce() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(op -> {
                try {
                    seen.set(env.text("SELECT h.state || '|' || o.state || '|' || p.state || '|' || "
                            + "(SELECT count(*) FROM selection_orders) || '|' || (SELECT count(*) FROM offer_decisions) "
                            + "FROM custody_holds h, buddy_offers o, pending_operations p WHERE p." + TYPE));
                } catch (SQLException e) {
                    seen.set(e.getMessage());
                }
                return ScriptedRemote.confirmed().apply(op);
            });
            OfferOutcome o = accept(env);
            assertEquals("selection-pending|decision-pending|pending|0|0", seen.get());
            assertEquals(202, o.http(), o.code());
            assertEquals("pending", o.status());
            assertEquals("decision-pending", o.code());
            JsonNode v = o.value();
            assertEquals("accept", v.get("decision").textValue());
            assertEquals("pending", v.get("state").textValue());
            assertEquals("decision-pending", v.get("reason").textValue());
            assertTrue(v.get("reconciliationRequired").booleanValue());
            assertEquals(2, v.get("offerVersion").asLong());
            assertEquals(2, v.get("holdVersion").asLong());
            assertEquals(op(env, "operation_id"), v.get("operationId").textValue());
            assertAccepted(env);
            assertEquals(List.of(EXECUTE), remote.calls);
        }
    }

    @Test
    void aLostResponseIsConvertedAfterARestartByReconcileWithoutASecondExecute() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, accept(env).http());
            assertPending(env, "unknown");

            OfferDecisions restarted = env.service(DecisionEnv.policy(true));
            OfferDecisionTickHandler handler = new OfferDecisionTickHandler(() -> true, () -> remote, () -> restarted);
            HandlerOutcome out = handler.handle(new TickRequest(new RunContext(OffersPg.ENV, "run-1", "system:clock"),
                    "tick-1", DecisionEnv.NOW, 1, DecisionEnv.POLICY, "op-1", TickKind.STARTUP));
            JsonNode counts = assertInstanceOf(HandlerOutcome.Ok.class, out).value();
            assertEquals(1, counts.get("driven").asInt());
            assertEquals(1, counts.get("settled").asInt());
            assertAccepted(env);
            assertEquals(List.of(EXECUTE, RECONCILE), remote.calls);
            assertEquals(0, restarted.reconcileRemote(OffersPg.ENV, "run-1", 100).driven());
        }
    }

    @Test
    void confirmedButOrderingUnavailableKeepsCustodyThenConvertsWithoutAnotherRemoteCall() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(op -> {
                env.orderingDown = true;
                return ScriptedRemote.confirmed().apply(op);
            });
            assertEquals(202, accept(env).http());
            assertPending(env, "confirmed");
            assertEquals(1, env.count("SELECT attempts FROM pending_operations WHERE " + TYPE));

            ReconcileResult still = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertEquals(1, still.pending());
            assertPending(env, "confirmed");

            env.orderingDown = false;
            env.now[0] = DecisionEnv.NOW.plusSeconds(7200);
            ReconcileResult r = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertEquals(1, r.settled());
            assertAccepted(env);
            assertEquals(List.of(EXECUTE), remote.calls);
        }
    }

    @Test
    void twoConcurrentReconcilersAfterConfirmationConvertOnce() throws Exception {
        for (int i = 0; i < 10; i++) {
            ScriptedRemote remote = new ScriptedRemote();
            try (DecisionEnv env = open(remote)) {
                remote.onExecute(op -> {
                    env.orderingDown = true;
                    return ScriptedRemote.confirmed().apply(op);
                });
                assertEquals(202, accept(env).http());
                env.orderingDown = false;
                race(() -> env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100),
                        () -> env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100));
                assertAccepted(env);
                assertEquals(List.of(EXECUTE), remote.calls);
            }
        }
    }

    @Test
    void aRejectedSelectionRestoresTheActiveOfferAndALaterAcceptProceeds() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.answer("rejected"), ScriptedRemote.confirmed());
            assertEquals(202, accept(env).http());
            assertRestored(env);
            assertEquals(List.of(EXECUTE), remote.calls);

            OfferOutcome again = env.decide(env.accept("cmd-2", 3, 3, null));
            assertEquals(202, again.http(), again.code());
            assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
            assertEquals("accepted", env.text("SELECT state FROM buddy_offers"));
            assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE command_id = 'cmd-2'"));
            assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
            assertEquals(List.of(EXECUTE, EXECUTE), remote.calls);
        }
    }

    @Test
    void aSelectionRejectedAfterTheDeadlineLeavesTheOfferToExpiryNotDecline() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.answer("rejected"));
            env.pg.update("ALTER TABLE buddy_operations DISABLE TRIGGER buddy_operations_immutable");
            env.pg.update("UPDATE buddy_operations SET payload = (SELECT jsonb_build_object('holdId', hold_id, 'orderUuid', "
                    + "order_uuid, 'employeeId', employee_id, 'expectedHoldVersion', version) FROM custody_holds)");
            env.pg.update("ALTER TABLE buddy_operations ENABLE TRIGGER buddy_operations_immutable");
            assertEquals(202, accept(env).http());
            Instant due = DecisionEnv.NOW.plusSeconds(3600);
            env.now[0] = due.plusSeconds(60);
            assertEquals(1, env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
            assertRestored(env);

            BuddyExpiry expiry = new BuddyExpiry(env.pg.pool(), DecisionEnv.policy(true), remote);
            ExpiryResult r = expiry.expire(new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, due.plusSeconds(60), 1));
            ExpiryResult.Done done = assertInstanceOf(ExpiryResult.Done.class, r);
            assertEquals(1, done.releases().size(), done.toString());
            assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
            assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        }
    }

    @Test
    void malformedOrMismatchedAcknowledgementsLeaveTheSelectionPendingUnknown() throws Exception {
        List<ScriptedRemote.Step> bad = List.of(
                op -> new RemoteBuddy.Ack("confirmed", op.operationId(), op.runId(), "other-order"),
                op -> new RemoteBuddy.Ack("confirmed", "other-op", op.runId(), op.orderUuid()),
                op -> new RemoteBuddy.Ack("confirmed", op.operationId(), "other-run", op.orderUuid()),
                ScriptedRemote.answer("ok"),
                ScriptedRemote.answer("not-found"),
                op -> null);
        for (ScriptedRemote.Step step : bad) {
            ScriptedRemote remote = new ScriptedRemote();
            try (DecisionEnv env = open(remote)) {
                remote.onExecute(step);
                assertEquals(202, accept(env).http());
                assertPending(env, "unknown");
                assertEquals(List.of(EXECUTE), remote.calls);
            }
        }
    }

    @Test
    void notFoundAfterAReconcileRetriesExecuteOnce() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost(), ScriptedRemote.confirmed()).onReconcile(ScriptedRemote.answer("not-found"));
            assertEquals(202, accept(env).http());
            assertEquals(1, env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
            assertAccepted(env);
            assertEquals(List.of(EXECUTE, RECONCILE, EXECUTE), remote.calls);
        }
    }

    @Test
    void replaysAndConflictsKeepTheOriginalPendingReceipt() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.confirmed());
            OfferOutcome first = accept(env);
            assertAccepted(env);
            long rows = env.written();

            OfferOutcome again = accept(env);
            assertEquals(202, again.http(), again.code());
            assertTrue(again.value().get("replayed").booleanValue());
            assertEquals("pending", again.value().get("state").textValue());
            assertEquals(first.value().get("operationId"), again.value().get("operationId"));
            assertEquals(first.value().get("decidedAt"), again.value().get("decidedAt"));

            OfferOutcome other = env.decide(env.accept("cmd-2", 1, 1, null));
            assertEquals(409, other.http());
            assertEquals("offer-no-longer-pending", other.code());
            OfferOutcome changed = env.decide(env.accept("cmd-1", 1, 1, 5L));
            assertEquals(409, changed.http());
            assertEquals("command-input-changed", changed.code());
            assertEquals(rows, env.written());
            assertEquals(List.of(EXECUTE), remote.calls);
        }
    }

    @Test
    void whileDecisionPendingADeclineAndAnotherAcceptSeeAPendingOffer() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost());
            assertEquals(202, accept(env).http());
            OfferOutcome decline = env.decide(DecisionEnv.decline("cmd-2", "size", 2, 2));
            assertEquals(409, decline.http());
            assertEquals("offer-no-longer-pending", decline.code());
            assertEquals("pending", decline.current().get("state").textValue());
            OfferOutcome other = env.decide(env.accept("cmd-3", 2, 2, null));
            assertEquals("offer-no-longer-pending", other.code());
            assertEquals(202, accept(env).http());
            assertPending(env, "unknown");
            assertEquals(List.of(EXECUTE), remote.calls);
        }
    }

    @Test
    void anAcceptRacingADeclineRecordsOneIntentAndOneExecute() throws Exception {
        for (int i = 0; i < 10; i++) {
            ScriptedRemote remote = new ScriptedRemote();
            try (DecisionEnv env = open(remote)) {
                remote.onExecute(ScriptedRemote.confirmed());
                var a = env.accept("cmd-a", 1, 1, null);
                var d = DecisionEnv.decline("cmd-d", "size", 1, 1);
                List<OfferOutcome> out = race(() -> env.decide(a), () -> env.decide(d));
                assertEquals(1, out.stream().filter(o -> o.http() == 202).count(), out.toString());
                assertEquals("offer-no-longer-pending", out.stream().filter(o -> o.http() != 202).findFirst().orElseThrow().code());
                assertEquals(1, env.count("SELECT count(*) FROM pending_operations WHERE operation_type IN "
                        + "('offer-selection', 'offer-decline-release')"));
                assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
                assertEquals(1, remote.calls.size());
            }
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
            assertEquals(202, accept(env).http());
            assertPending(env, "selection-pending");
            assertEquals(1, env.count("SELECT attempts FROM pending_operations WHERE " + TYPE));
            assertEquals(0, env.decisions.reconcileRemote(OffersPg.ENV, "run-2", 100).driven());
            assertEquals(List.of(EXECUTE), remote.calls);
            assertEquals("selection-pending", env.text("SELECT state FROM custody_holds"));
            assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
            assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        }
    }

    @Test
    void anUnconfirmedOrExpiredIntentNeverRenewsOrConvertsTheDeadline() throws Exception {
        ScriptedRemote remote = new ScriptedRemote();
        try (DecisionEnv env = open(remote)) {
            remote.onExecute(ScriptedRemote.lost()).onReconcile(ScriptedRemote.confirmed());
            assertEquals(202, accept(env).http());
            Instant due = DecisionEnv.NOW.plusSeconds(3600);
            BuddyExpiry expiry = new BuddyExpiry(env.pg.pool(), DecisionEnv.policy(true), remote);
            ExpiryResult.Done done = assertInstanceOf(ExpiryResult.Done.class,
                    expiry.expire(new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, due.plusSeconds(60), 1)));
            assertTrue(done.expired().isEmpty() && done.releases().isEmpty());
            assertPending(env, "unknown");

            env.now[0] = due.plusSeconds(60);
            env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
            assertAccepted(env);
            assertEquals(DecisionEnv.NOW.plusSeconds(3600).toEpochMilli(),
                    env.count("SELECT (extract(epoch FROM expires_at) * 1000)::bigint FROM buddy_offers"));
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
