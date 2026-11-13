package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** Shared test helpers: seeding through the runner, hold commands and a two-thread gate. */
final class Support {

    private Support() {}

    static ObjectNode input(String k, String v) {
        return PgFixture.obj().put(k, v);
    }

    static Command cmd(String type, String id, JsonNode input) {
        return new Command(type, id, input);
    }

    /** Employee e1, slot s1 (capacity 2), slot s2 (capacity 1), cars c1..c3 at version 1; revision becomes 1. */
    static void seed(PgFixture f) throws SQLException {
        Outcome o = new TransactionRunner(f.pool()).execute(f.ctx(), cmd("seed", "seed-1", input("a", "b")), tx -> {
            Custody.insertEmployee(tx, "e1");
            Custody.insertSlot(tx, "s1", "e1", 2);
            Custody.insertSlot(tx, "s2", "e1", 1);
            for (String car : List.of("c1", "c2", "c3")) Custody.insertStockCar(tx, car, "cfg-1", "available");
            return WorkResult.ok(PgFixture.obj().put("seeded", true));
        });
        if (!(o instanceof Outcome.Committed)) throw new IllegalStateException("seed failed: " + o);
    }

    static Work hold(String holdId, String car, String slot, int unit) {
        return tx -> {
            Custody.acquireHold(tx, holdId, car, Custody.carVersion(tx, car), slot, "e1", unit,
                    Instant.now().plus(1, ChronoUnit.HOURS));
            return WorkResult.ok(PgFixture.obj().put("hold", holdId));
        };
    }

    /** Runs both commands at the same moment on separate connections; returns outcomes in input order. */
    static List<Outcome> race(Callable<Outcome> a, Callable<Outcome> b) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Future<Outcome> fa = pool.submit(() -> gated(ready, go, a));
            Future<Outcome> fb = pool.submit(() -> gated(ready, go, b));
            ready.await();
            go.countDown();
            return List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    private static Outcome gated(CountDownLatch ready, CountDownLatch go, Callable<Outcome> c) throws Exception {
        ready.countDown();
        go.await();
        return c.call();
    }
}
