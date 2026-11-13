package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PendingOperationsTest {

    static final String DEV = "isolated-dev";

    PgFixture f;
    TransactionRunner runner;

    @BeforeEach
    void setUp() throws Exception {
        f = PgFixture.createClaimed("GCSP_TEST_DATABASE_URL", DEV, true);
        runner = new TransactionRunner(f.pool());
        Support.seed(f);
        Outcome o = runner.execute(f.ctx(), cmd("claim-intent", "i-1", input("c", "c1")), tx -> {
            Support.hold("hold-1", "c1", "s1", 1).run(tx);
            PendingOperations.recordIntent(tx, "op-1", "claim", "claim-key-1", input("car", "c1"));
            return WorkResult.ok(PgFixture.obj().put("op", "op-1"));
        });
        assertInstanceOf(Outcome.Committed.class, o);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private Outcome finalizeOp(RunContext ctx, String commandId, long version, String state) {
        return runner.execute(ctx, cmd("finalize", commandId, input("v", Long.toString(version))), tx -> {
            PendingOperations.finalize(tx, "op-1", version, state, "ref-1", PgFixture.obj().put("ok", true));
            return WorkResult.ok(PgFixture.obj().put("state", state));
        });
    }

    @Test
    void intentIsDurableBeforeTheProviderCallAndFinalizeAcknowledgesByCas() throws Exception {
        assertEquals("intent", f.text("SELECT state FROM pending_operations WHERE operation_id = 'op-1'"));
        assertEquals(1, f.count("SELECT version FROM pending_operations WHERE operation_id = 'op-1'"));

        AtomicBoolean called = new AtomicBoolean();
        called.set(true); // the provider call happens here, outside any transaction

        Outcome.Committed done = assertInstanceOf(Outcome.Committed.class,
                finalizeOp(f.ctx(), "f-1", 1, "acknowledged"));
        assertTrue(called.get() && done.changed());
        assertEquals("acknowledged", f.text("SELECT state FROM pending_operations WHERE operation_id = 'op-1'"));
        assertEquals("ref-1", f.text("SELECT provider_reference FROM pending_operations WHERE operation_id = 'op-1'"));
        assertEquals(2, f.count("SELECT version FROM pending_operations WHERE operation_id = 'op-1'"));

        // A late duplicate acknowledgement still holding the old version loses the CAS.
        Outcome late = finalizeOp(f.ctx(), "f-late", 1, "acknowledged");
        assertEquals("stale-version", assertInstanceOf(Outcome.Conflict.class, late).code());
        assertEquals(2, f.count("SELECT version FROM pending_operations WHERE operation_id = 'op-1'"));
    }

    @Test
    void anAcknowledgementAfterTheRunWasResetIsRefusedAsStaleRun() throws Exception {
        String database = f.database();
        assertInstanceOf(Outcome.Committed.class,
                new RunReset(f.pool(), database, DEV).reset(DEV, "actor-1", "r-1", "run-1", "run-2"));
        Outcome o = finalizeOp(f.ctx(), "f-old", 1, "acknowledged");
        assertEquals("stale-run", assertInstanceOf(Outcome.Conflict.class, o).code());
        assertEquals("intent", f.text("SELECT state FROM pending_operations WHERE operation_id = 'op-1'"));
        assertEquals(0, f.count("SELECT count(*) FROM pending_operations WHERE run_id = 'run-2'"));
    }

    @Test
    void aTimeoutLeavesTheOperationPendingAndTheHoldStillOccupying() throws Exception {
        Outcome o = runner.execute(f.ctx(), cmd("timeout", "t-1", input("op", "op-1")), tx -> {
            PendingOperations.markPending(tx, "op-1", PendingOperations.version(tx, "op-1"),
                    PgFixture.obj().put("reason", "timeout"));
            return WorkResult.ok(PgFixture.obj().put("state", "pending"));
        });
        assertInstanceOf(Outcome.Committed.class, o);
        assertEquals("pending", f.text("SELECT state FROM pending_operations WHERE operation_id = 'op-1'"));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE hold_id = 'hold-1' "
                + "AND state IN ('active', 'claim-pending', 'release-pending', 'selection-pending')"));
        Outcome second = runner.execute(f.ctx(), cmd("hold", "h-2", input("c", "c1")),
                Support.hold("hold-2", "c1", "s2", 1));
        assertEquals("car-held", assertInstanceOf(Outcome.Conflict.class, second).code());

        // The pending operation can still be finalized later, once, at its current version.
        Outcome.Committed done = assertInstanceOf(Outcome.Committed.class,
                finalizeOp(f.ctx(), "f-2", 2, "acknowledged"));
        assertTrue(done.changed());
    }
}
