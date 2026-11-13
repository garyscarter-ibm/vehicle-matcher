package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class RunResetTest {

    static final String DEV = "isolated-dev";

    PgFixture f;
    String database;
    RunReset reset;

    @BeforeEach
    void setUp() throws Exception {
        f = PgFixture.createClaimed("GCSP_TEST_DATABASE_URL", DEV, true);
        database = f.database();
        reset = new RunReset(f.pool(), database, DEV);
        Support.seed(f);
        new TransactionRunner(f.pool()).execute(f.ctx(), cmd("hold", "h-1", input("c", "c1")), tx -> {
            Support.hold("hold-1", "c1", "s1", 1).run(tx);
            tx.emit("ev-1", "held", PgFixture.obj().put("hold", "hold-1"));
            return WorkResult.ok(PgFixture.obj().put("ok", true));
        });
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void resetRetiresTheActiveRunAndActivatesTheNewOneAtomicallyWithoutDeletingAnything() throws Exception {
        long receipts = f.rows("command_receipts", f.ctx());
        Outcome.Committed o = assertInstanceOf(Outcome.Committed.class,
                reset.reset(DEV, "actor-1", "r-1", "run-1", "run-2"));
        assertFalse(o.replayed());
        assertEquals("run-1", o.result().get("retiredRunId").asText());
        assertEquals("run-2", o.result().get("activatedRunId").asText());
        assertEquals(1, f.count("SELECT count(*) FROM runs WHERE status = 'active'"));
        assertEquals("run-2", f.text("SELECT run_id FROM runs WHERE status = 'active'"));
        assertEquals(1, f.count("SELECT count(*) FROM runs WHERE run_id = 'run-1' AND status = 'retired' "
                + "AND retired_at IS NOT NULL"));
        assertEquals(1, f.count("SELECT count(*) FROM run_resets WHERE command_id = 'r-1' "
                + "AND retired_run_id = 'run-1' AND activated_run_id = 'run-2'"));
        assertEquals(receipts, f.rows("command_receipts", f.ctx()));
        assertEquals(1, f.rows("custody_holds", f.ctx()));
        assertEquals(1, f.rows("outbox_events", f.ctx()));
        assertEquals(0, f.revision(f.ctx("run-2")));
    }

    @Test
    void resetIsAllOrNothingWhenTheNewRunCannotBeCreated() throws Exception {
        String before = f.stateDigest();
        Outcome badId = reset.reset(DEV, "actor-1", "r-bad", "run-1", "not a valid id!");
        assertEquals("constraint-violated", badId.code());
        assertEquals(before, f.stateDigest());
        Outcome reused = reset.reset(DEV, "actor-1", "r-dup", "run-1", "run-1");
        assertEquals("duplicate-record", reused.code());
        assertEquals(before, f.stateDigest());
        assertEquals("run-1", f.text("SELECT run_id FROM runs WHERE status = 'active'"));
        assertEquals(0, f.count("SELECT count(*) FROM run_resets"));
    }

    @Test
    void resetWithTheWrongExpectedActiveRunIsStaleRunAndChangesNothing() throws Exception {
        String before = f.stateDigest();
        Outcome o = reset.reset(DEV, "actor-1", "r-2", "run-9", "run-2");
        assertEquals("stale-run", assertInstanceOf(Outcome.Conflict.class, o).code());
        assertEquals(before, f.stateDigest());
    }

    @Test
    void replayWithTheSameInputReturnsTheOriginalAndChangedInputIsRefused() throws Exception {
        Outcome.Committed first = assertInstanceOf(Outcome.Committed.class,
                reset.reset(DEV, "actor-1", "r-3", "run-1", "run-2"));
        Outcome.Committed replay = assertInstanceOf(Outcome.Committed.class,
                reset.reset(DEV, "actor-1", "r-3", "run-1", "run-2"));
        assertTrue(replay.replayed());
        assertEquals(first.result(), replay.result());
        Outcome changed = reset.reset(DEV, "actor-1", "r-3", "run-1", "run-3");
        assertEquals("command-input-changed", assertInstanceOf(Outcome.Conflict.class, changed).code());
        assertEquals(1, f.count("SELECT count(*) FROM run_resets"));
        assertEquals(2, f.count("SELECT count(*) FROM runs"));
    }

    @Test
    void resetIsRefusedWhenTheConfiguredDatabaseIsNotTheConnectedOne() throws Exception {
        String before = f.stateDigest();
        Outcome o = new RunReset(f.pool(), "some_other_database", DEV).reset(DEV, "actor-1", "r-4", "run-1", "run-2");
        Outcome.Refused refused = assertInstanceOf(Outcome.Refused.class, o);
        assertEquals("reset-isolation-mismatch", refused.code());
        assertFalse(refused.message().contains(database));
        assertEquals(before, f.stateDigest());
    }

    @Test
    void resetIsRefusedWhenTheStoredEnvironmentIsNotTheConfiguredOne() throws Exception {
        String before = f.stateDigest();
        Outcome configured = new RunReset(f.pool(), database, "other-env").reset("other-env", "actor-1", "r-5",
                "run-1", "run-2");
        assertEquals("reset-isolation-mismatch", assertInstanceOf(Outcome.Refused.class, configured).code());
        Outcome argument = reset.reset("other-env", "actor-1", "r-6", "run-1", "run-2");
        assertEquals("reset-isolation-mismatch", assertInstanceOf(Outcome.Refused.class, argument).code());
        assertEquals(before, f.stateDigest());
    }

    @Test
    void resetIsRefusedWhenTheDatabaseDoesNotAllowIt() throws Exception {
        try (PgFixture locked = PgFixture.createClaimed("GCSP_TEST_DATABASE_URL", DEV, false)) {
            String before = locked.stateDigest();
            Outcome o = new RunReset(locked.pool(), locked.database(), DEV).reset(DEV, "actor-1", "r-7", "run-1",
                    "run-2");
            assertEquals("reset-not-allowed", assertInstanceOf(Outcome.Refused.class, o).code());
            assertEquals(before, locked.stateDigest());
        }
    }

    @Test
    void afterResetTheOldRunRefusesCommandsAndTheNewRunAcceptsThem() throws Exception {
        assertInstanceOf(Outcome.Committed.class, reset.reset(DEV, "actor-1", "r-8", "run-1", "run-2"));
        TransactionRunner runner = new TransactionRunner(f.pool());
        Outcome old = runner.execute(f.ctx(), cmd("add", "late-1", input("e", "e9")), tx -> {
            Custody.insertEmployee(tx, "e9");
            return WorkResult.ok(PgFixture.obj());
        });
        assertEquals("stale-run", assertInstanceOf(Outcome.Conflict.class, old).code());
        Outcome.Committed fresh = assertInstanceOf(Outcome.Committed.class,
                runner.execute(f.ctx("run-2"), cmd("add", "new-1", input("e", "e9")), tx -> {
                    Custody.insertEmployee(tx, "e9");
                    return WorkResult.ok(PgFixture.obj());
                }));
        assertEquals(1, fresh.runRevision());
        assertEquals(0, f.count("SELECT count(*) FROM employees WHERE run_id = 'run-1' AND employee_id = 'e9'"));
    }

    @Test
    void aRetiredRunIsRefusedBeforeItsWorkCanHitAConstraint() throws Exception {
        TransactionRunner runner = new TransactionRunner(f.pool());
        assertInstanceOf(Outcome.Committed.class, runner.execute(f.ctx(), cmd("add", "dup-1", input("e", "e7")),
                tx -> { Custody.insertEmployee(tx, "e7"); return WorkResult.ok(PgFixture.obj()); }));
        assertInstanceOf(Outcome.Committed.class, reset.reset(DEV, "actor-1", "r-10", "run-1", "run-2"));
        Outcome late = runner.execute(f.ctx(), cmd("add", "dup-2", input("e", "e7")),
                tx -> { Custody.insertEmployee(tx, "e7"); return WorkResult.ok(PgFixture.obj()); });
        assertEquals("stale-run", assertInstanceOf(Outcome.Conflict.class, late).code());
    }

    @Test
    void aNewPoolSeesTheNewRunAndReplayingTheResetReturnsTheOriginal() throws Exception {
        Outcome.Committed first = assertInstanceOf(Outcome.Committed.class,
                reset.reset(DEV, "actor-1", "r-9", "run-1", "run-2"));
        // "Restart": nothing shared with the pool that did the reset.
        EnvironmentGuard guard = new EnvironmentGuard(f.pool(), database, DEV, true);
        assertEquals("run-2", guard.currentRun().runId());
        assertEquals(0, guard.currentRun().revision());
        assertEquals("run-2", guard.claim().runId());
        Outcome.Committed replay = assertInstanceOf(Outcome.Committed.class,
                new RunReset(f.pool(), database, DEV).reset(DEV, "actor-1", "r-9", "run-1", "run-2"));
        assertTrue(replay.replayed());
        assertEquals(first.result(), replay.result());
        Inspection.Committed seen = assertInstanceOf(Inspection.Committed.class,
                new RunReset(f.pool(), database, DEV).inspect("r-9"));
        assertEquals(first.result(), seen.result());
        assertEquals("run-2", f.text("SELECT run_id FROM runs WHERE status = 'active'"));
    }
}
