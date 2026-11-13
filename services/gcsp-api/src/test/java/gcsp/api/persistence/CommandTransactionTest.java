package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CommandTransactionTest {

    PgFixture f;
    TransactionRunner runner;
    RunContext ctx;

    @BeforeEach
    void setUp() throws SQLException {
        f = PgFixture.createClaimed();
        runner = new TransactionRunner(f.pool());
        ctx = f.ctx();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void commitMakesDomainRowReceiptOutboxAndRevisionVisible() throws Exception {
        Outcome o = runner.execute(ctx, cmd("add-employee", "c-1", input("e", "e1")), tx -> {
            Custody.insertEmployee(tx, "e1");
            tx.emit("ev-1", "employee-added", PgFixture.obj().put("employeeId", "e1"));
            return WorkResult.ok(PgFixture.obj().put("ok", true));
        });
        Outcome.Committed c = assertInstanceOf(Outcome.Committed.class, o);
        assertTrue(c.changed());
        assertFalse(c.replayed());
        assertEquals(1, c.runRevision());
        assertEquals(1, f.rows("employees", ctx));
        assertEquals(1, f.rows("command_receipts", ctx));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE run_id = 'run-1' AND run_revision = 1"));
        assertEquals(1, f.revision(ctx));
    }

    @Test
    void failureAfterWritingRollsBackEverything() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> runner.execute(ctx, cmd("t", "c-2", input("a", "b")), tx -> {
            Custody.insertEmployee(tx, "e1");
            tx.emit("ev-1", "x", PgFixture.obj());
            throw new IllegalArgumentException("boom");
        }));
        assertNothingWritten();
        Outcome refused = runner.execute(ctx, cmd("t", "c-3", input("a", "b")), tx -> {
            Custody.insertEmployee(tx, "e1");
            return WorkResult.refuse("not-allowed", "no");
        });
        assertEquals("not-allowed", assertInstanceOf(Outcome.Refused.class, refused).code());
        assertNothingWritten();
    }

    @Test
    void failedVersionCheckIsStaleVersionAndRollsBackOtherWrites() throws Exception {
        Support.seed(f);
        Outcome o = runner.execute(ctx, cmd("t", "c-4", input("a", "b")), tx -> {
            Custody.insertEmployee(tx, "e2");
            tx.cas("UPDATE stock_cars SET version = version + 1 WHERE environment_id = ? AND run_id = ? "
                    + "AND order_uuid = 'c1' AND version = ?", ctx.environmentId(), ctx.runId(), 99L);
            return WorkResult.ok(PgFixture.obj());
        });
        assertEquals("stale-version", assertInstanceOf(Outcome.Conflict.class, o).code());
        assertEquals(0, f.count("SELECT count(*) FROM employees WHERE employee_id = 'e2'"));
        assertEquals(1, f.revision(ctx));
        assertEquals(1, f.rows("command_receipts", ctx));
    }

    @Test
    void noOpWritesNoReceiptRevisionOrEvent() throws Exception {
        Support.seed(f);
        Outcome o = runner.execute(ctx, cmd("noop", "c-5", input("a", "b")), tx -> {
            tx.emit("ev-x", "never", PgFixture.obj());
            return WorkResult.ok(PgFixture.obj().put("same", true));
        });
        Outcome.Committed c = assertInstanceOf(Outcome.Committed.class, o);
        assertFalse(c.changed());
        assertEquals(1, f.revision(ctx));
        assertEquals(1, f.rows("command_receipts", ctx));
        assertEquals(0, f.rows("outbox_events", ctx));
    }

    @Test
    void sameCommandAndInputReplaysTheOriginalResult() throws Exception {
        Command command = cmd("add-employee", "c-6", input("e", "e1"));
        Outcome first = runner.execute(ctx, command, tx -> {
            Custody.insertEmployee(tx, "e1");
            return WorkResult.ok(PgFixture.obj().put("n", 1));
        });
        Outcome again = runner.execute(ctx, command, tx -> {
            throw new AssertionError("a replay must not run the work");
        });
        Outcome.Committed r = assertInstanceOf(Outcome.Committed.class, again);
        assertTrue(r.replayed());
        assertFalse(r.changed());
        assertEquals(((Outcome.Committed) first).result(), r.result());
        assertEquals(((Outcome.Committed) first).runRevision(), r.runRevision());
        assertEquals(1, f.revision(ctx));
    }

    @Test
    void sameCommandIdWithChangedInputIsRefusedAsConflict() throws Exception {
        runner.execute(ctx, cmd("t", "c-7", input("e", "one")), tx -> {
            Custody.insertEmployee(tx, "e1");
            return WorkResult.ok(PgFixture.obj());
        });
        Outcome o = runner.execute(ctx, cmd("t", "c-7", input("e", "two")), tx -> WorkResult.ok(PgFixture.obj()));
        assertEquals("command-input-changed", assertInstanceOf(Outcome.Conflict.class, o).code());
        assertEquals(1, f.revision(ctx));
    }

    @Test
    void commandAgainstARetiredRunIsStaleRun() throws Exception {
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-2', 'active')", PgFixture.ENV);
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-2'");
        Outcome o = runner.execute(new RunContext(PgFixture.ENV, "run-2", "actor-1"),
                cmd("t", "c-8", input("a", "b")), tx -> {
                    tx.write("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, 'run-2', 'e1')",
                            PgFixture.ENV);
                    return WorkResult.ok(PgFixture.obj());
                });
        assertEquals("stale-run", assertInstanceOf(Outcome.Conflict.class, o).code());
        assertEquals(0, f.count("SELECT count(*) FROM employees WHERE run_id = 'run-2'"));
    }

    @Test
    void sqlFailureIsUnavailableWithASafeMessage() throws Exception {
        Outcome o = runner.execute(ctx, cmd("t", "c-9", input("a", "b")), tx -> {
            tx.write("INSERT INTO no_such_table VALUES (1)");
            return WorkResult.ok(PgFixture.obj());
        });
        Outcome.Unavailable u = assertInstanceOf(Outcome.Unavailable.class, o);
        assertTrue(u.retryable());
        assertFalse(u.message().contains("no_such_table"));
    }

    private void assertNothingWritten() throws SQLException {
        assertEquals(0, f.rows("employees", ctx));
        assertEquals(0, f.rows("command_receipts", ctx));
        assertEquals(0, f.rows("outbox_events", ctx));
        assertEquals(0, f.revision(ctx));
    }
}
