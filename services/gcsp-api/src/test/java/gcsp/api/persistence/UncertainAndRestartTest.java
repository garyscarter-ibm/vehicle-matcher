package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.hold;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class UncertainAndRestartTest {

    PgFixture f;
    RunContext ctx;

    @BeforeEach
    void setUp() throws SQLException {
        f = PgFixture.createClaimed();
        ctx = f.ctx();
        Support.seed(f);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void commitThatLandsThenFailsIsUncertainInspectFindsItAndResubmitReplays() throws Exception {
        TransactionRunner flaky = new TransactionRunner(
                new FlakyCommitDataSource(f.pool(), FlakyCommitDataSource.Mode.COMMIT_THEN_FAIL));
        Command command = cmd("hold", "u-1", input("c", "c1"));
        Outcome o = flaky.execute(ctx, command, hold("hold-1", "c1", "s1", 1));
        assertEquals("u-1", assertInstanceOf(Outcome.Uncertain.class, o).operationId());

        TransactionRunner healthy = new TransactionRunner(f.pool());
        Inspection.Committed seen = assertInstanceOf(Inspection.Committed.class, healthy.inspect(ctx, "u-1"));
        assertEquals("hold-1", seen.result().get("hold").asText());
        Outcome.Committed replay = assertInstanceOf(Outcome.Committed.class,
                healthy.execute(ctx, command, hold("hold-1", "c1", "s1", 1)));
        assertTrue(replay.replayed());
        assertEquals(seen.result(), replay.result());
        assertEquals(seen.runRevision(), replay.runRevision());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void commitThatNeverLandsIsUncertainInspectSaysAbsentAndResubmitCommitsOnce() throws Exception {
        TransactionRunner flaky = new TransactionRunner(
                new FlakyCommitDataSource(f.pool(), FlakyCommitDataSource.Mode.FAIL_WITHOUT_COMMIT));
        Command command = cmd("hold", "u-2", input("c", "c1"));
        Outcome o = flaky.execute(ctx, command, hold("hold-1", "c1", "s1", 1));
        assertEquals("u-2", assertInstanceOf(Outcome.Uncertain.class, o).operationId());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));

        TransactionRunner healthy = new TransactionRunner(f.pool());
        assertInstanceOf(Inspection.Absent.class, healthy.inspect(ctx, "u-2"));
        Outcome.Committed done = assertInstanceOf(Outcome.Committed.class,
                healthy.execute(ctx, command, hold("hold-1", "c1", "s1", 1)));
        assertTrue(done.changed());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_id = 'u-2'"));
    }

    @Test
    void stateSurvivesANewPoolAndReplayStillReturnsTheOriginalResult() throws Exception {
        Command command = cmd("hold", "p-1", input("c", "c1"));
        Outcome.Committed first = assertInstanceOf(Outcome.Committed.class,
                new TransactionRunner(f.pool()).execute(ctx, command, hold("hold-1", "c1", "s1", 1)));

        // "Restart": a brand-new DataSource and runner, nothing shared with the first.
        var restarted = f.pool();
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE hold_id = 'hold-1' AND state = 'active'"));
        assertEquals(first.runRevision(), f.revision(ctx));
        Outcome.Committed replay = assertInstanceOf(Outcome.Committed.class,
                new TransactionRunner(restarted).execute(ctx, command, tx -> {
                    throw new AssertionError("a replay must not run the work");
                }));
        assertTrue(replay.replayed());
        assertEquals(first.result(), replay.result());
        assertEquals(first.runRevision(), replay.runRevision());
    }
}
