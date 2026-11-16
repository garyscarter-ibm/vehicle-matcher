package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.BuddyExpiry;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/** Real separate connections, released together: one winner per offer, never an orphan or an occupying hold. */
class OfferDecisionRaceTest {

    private static final int ROUNDS = 20;
    private static final Instant DUE = DecisionEnv.NOW.plusSeconds(3600);

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

    /** What every round must leave behind, whoever won. */
    private static void assertSettled(DecisionEnv env, boolean accepted) throws SQLException {
        assertEquals(0, env.count("SELECT count(*) FROM custody_holds WHERE state IN "
                + "('active', 'claim-pending', 'release-pending', 'selection-pending')"));
        assertEquals(0, env.count("SELECT count(*) FROM custody_holds h WHERE h.state = 'allocated' AND NOT EXISTS "
                + "(SELECT 1 FROM selection_orders s WHERE s.hold_id = h.hold_id)"));
        assertEquals(2, env.count("SELECT version FROM stock_cars"));
        if (accepted) {
            assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
            assertEquals("accepted", env.text("SELECT state FROM buddy_offers"));
            assertEquals("allocated", env.text("SELECT state FROM stock_cars"));
            assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
            assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept'"));
        } else {
            assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        }
    }

    private static void arm(DecisionEnv env) throws SQLException {
        env.pg.update("UPDATE custody_holds SET attributes = jsonb_build_object('policyVersion', ?, 'quoteId', "
                + "(SELECT quote_id FROM buddy_offers))", DecisionEnv.POLICY);
    }

    @Test
    void anAcceptRacingTheExpiryTickLeavesExactlyOneOutcome() throws Exception {
        int accepted = 0;
        int expired = 0;
        for (int i = 0; i < ROUNDS; i++) {
            try (DecisionEnv env = DecisionEnv.open(true)) {
                arm(env);
                env.now[0] = DUE.minusMillis(1);
                BuddyExpiry expiry = new BuddyExpiry(env.pg.pool(), DecisionEnv.policy(true));
                AllocationScope tick = new AllocationScope(OffersPg.ENV, "run-1", DecisionEnv.POLICY, DUE, 1);
                var body = env.accept("cmd-" + i, 1, 1, null);
                // The expiry starts a little later each round, so the lock is contended at different points of the accept.
                long lag = i;
                List<Object> out = race(() -> env.decide(body), () -> {
                    Thread.sleep(lag);
                    return expiry.expire(tick);
                });
                OfferOutcome o = (OfferOutcome) out.get(0);
                if ("allocated".equals(env.text("SELECT state FROM custody_holds"))) {
                    accepted++;
                    assertEquals(200, o.http(), o.code());
                    assertSettled(env, true);
                } else {
                    expired++;
                    assertEquals("expired", env.text("SELECT state FROM custody_holds"));
                    assertEquals("expired", env.text("SELECT state FROM buddy_offers"));
                    assertEquals("released", env.text("SELECT state FROM stock_cars"));
                    assertEquals(409, o.http(), o.code());
                    assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
                    assertSettled(env, false);
                }
            }
        }
        System.out.println("RACE accept-vs-expiry accepted=" + accepted + " expired=" + expired);
        assertEquals(ROUNDS, accepted + expired);
    }

    @Test
    void twoAcceptsWithDifferentCommandsHaveOneWinner() throws Exception {
        for (int i = 0; i < ROUNDS; i++) {
            try (DecisionEnv env = DecisionEnv.open(true)) {
                var a = env.accept("cmd-a", 1, 1, null);
                var b = env.accept("cmd-b", 1, 1, null);
                List<OfferOutcome> out = race(() -> env.decide(a), () -> env.decide(b));
                long wins = out.stream().filter(o -> o.http() == 200).count();
                assertEquals(1, wins, out.toString());
                OfferOutcome loser = out.stream().filter(o -> o.http() != 200).findFirst().orElseThrow();
                assertEquals(409, loser.http(), loser.code());
                assertEquals("offer-no-longer-pending", loser.code());
                assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
                assertSettled(env, true);
            }
        }
    }

    @Test
    void anAcceptRacingADeclineLeavesOneTerminalDecision() throws Exception {
        for (int i = 0; i < ROUNDS; i++) {
            try (DecisionEnv env = DecisionEnv.open(true)) {
                var accept = env.accept("cmd-a", 1, 1, null);
                var decline = DecisionEnv.decline("cmd-d", "size", 1, 1);
                List<OfferOutcome> out = race(() -> env.decide(accept), () -> env.decide(decline));
                assertEquals(1, out.stream().filter(o -> o.http() == 200).count(), out.toString());
                assertEquals("offer-no-longer-pending", out.stream().filter(o -> o.http() != 200).findFirst().orElseThrow().code());
                assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
                boolean accepted = "accept".equals(env.text("SELECT decision FROM offer_decisions"));
                if (accepted) {
                    assertSettled(env, true);
                } else {
                    assertEquals("declined", env.text("SELECT state FROM buddy_offers"));
                    assertEquals("released", env.text("SELECT state FROM custody_holds"));
                    assertEquals("released", env.text("SELECT state FROM stock_cars"));
                    assertSettled(env, false);
                }
            }
        }
    }
}
