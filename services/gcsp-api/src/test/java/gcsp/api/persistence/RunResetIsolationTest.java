package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Two real databases on one cluster: the dev one may reset, the stand-in for the running gcsp-poc app may not. */
class RunResetIsolationTest {

    PgFixture dev;
    PgFixture running;

    @BeforeEach
    void setUp() throws Exception {
        dev = PgFixture.createClaimed("GCSP_TEST_DATABASE_URL", "isolated-dev", true);
        running = PgFixture.createClaimed("GCSP_TEST_RUNNING_DATABASE_URL", "gcsp-poc", false);
        for (PgFixture f : new PgFixture[] {dev, running}) {
            Support.seed(f);
            assertInstanceOf(Outcome.Committed.class, new TransactionRunner(f.pool()).execute(f.ctx(),
                    cmd("hold", "h-1", input("c", "c1")), Support.hold("hold-1", "c1", "s1", 1)));
        }
    }

    @AfterEach
    void tearDown() throws SQLException {
        try {
            if (dev != null) dev.close();
        } finally {
            if (running != null) running.close();
        }
    }

    @Test
    void resettingTheDevDatabaseLeavesTheRunningDatabaseByteForByteUnchanged() throws Exception {
        String runningBefore = running.stateDigest();
        String devBefore = dev.stateDigest();
        long runningRevision = running.revision(running.ctx());
        Outcome o = new RunReset(dev.pool(), dev.database(), "isolated-dev").reset("isolated-dev", "actor-1", "r-1",
                "run-1", "run-2");
        assertInstanceOf(Outcome.Committed.class, o);
        assertNotEquals(devBefore, dev.stateDigest());
        assertEquals(runningBefore, running.stateDigest());
        assertEquals(runningRevision, running.revision(running.ctx()));
        assertEquals(2, running.rows("command_receipts", running.ctx()));
        assertEquals(1, running.rows("custody_holds", running.ctx()));
        assertEquals("run-1", running.text("SELECT run_id FROM runs WHERE status = 'active'"));
    }

    @Test
    void aResetConfiguredForDevButPointedAtTheRunningDatabaseIsRefusedAndChangesNothing() throws Exception {
        String runningBefore = running.stateDigest();
        Outcome o = new RunReset(running.pool(), dev.database(), "isolated-dev").reset("isolated-dev", "actor-1",
                "r-2", "run-1", "run-2");
        assertEquals("reset-isolation-mismatch", assertInstanceOf(Outcome.Refused.class, o).code());
        assertEquals(runningBefore, running.stateDigest());
        assertEquals(0, running.count("SELECT count(*) FROM run_resets"));
    }
}
