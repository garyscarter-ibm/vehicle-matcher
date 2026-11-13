package gcsp.api.persistence;

import static gcsp.api.persistence.Support.cmd;
import static gcsp.api.persistence.Support.hold;
import static gcsp.api.persistence.Support.input;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CustodyConcurrencyTest {

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

    private TransactionRunner runner() throws SQLException {
        return new TransactionRunner(f.pool());
    }

    @Test
    void twoConnectionsCompetingForOneExactCarYieldOneWinnerAndCarHeld() throws Exception {
        TransactionRunner a = runner();
        TransactionRunner b = runner();
        List<Outcome> outcomes = Support.race(
                () -> a.execute(ctx, cmd("hold", "h-a", input("c", "c1")), hold("hold-a", "c1", "s1", 1)),
                () -> b.execute(ctx, cmd("hold", "h-b", input("c", "c1")), hold("hold-b", "c1", "s1", 2)));
        assertEquals(1, outcomes.stream().filter(o -> o instanceof Outcome.Committed).count());
        Outcome.Conflict loser = assertInstanceOf(Outcome.Conflict.class,
                outcomes.stream().filter(o -> !(o instanceof Outcome.Committed)).findFirst().orElseThrow());
        assertEquals("car-held", loser.code());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE order_uuid = 'c1'"));
        assertEquals(2, f.revision(ctx));
    }

    @Test
    void twoCarsOnTheSameSlotUnitYieldOneWinnerAndSlotOccupied() throws Exception {
        TransactionRunner a = runner();
        TransactionRunner b = runner();
        List<Outcome> outcomes = Support.race(
                () -> a.execute(ctx, cmd("hold", "h-a", input("c", "c1")), hold("hold-a", "c1", "s1", 1)),
                () -> b.execute(ctx, cmd("hold", "h-b", input("c", "c2")), hold("hold-b", "c2", "s1", 1)));
        assertEquals(1, outcomes.stream().filter(o -> o instanceof Outcome.Committed).count());
        Outcome.Conflict loser = assertInstanceOf(Outcome.Conflict.class,
                outcomes.stream().filter(o -> !(o instanceof Outcome.Committed)).findFirst().orElseThrow());
        assertEquals("slot-occupied", loser.code());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE slot_id = 's1' AND slot_unit = 1"));
    }

    @Test
    void aSlotUnitAboveCapacityIsRefusedAndNothingIsWritten() throws Exception {
        Outcome o = runner().execute(ctx, cmd("hold", "h-over", input("c", "c3")), hold("hold-x", "c3", "s2", 2));
        assertEquals("constraint-violated", assertInstanceOf(Outcome.Refused.class, o).code());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, f.revision(ctx));
    }

    @Test
    void releasingAHoldFreesTheCarAndAStaleReleaseIsAConflict() throws Exception {
        runner().execute(ctx, cmd("hold", "h-1", input("c", "c1")), hold("hold-1", "c1", "s1", 1));
        Outcome stale = runner().execute(ctx, cmd("rel", "r-0", input("v", "9")), tx -> {
            Custody.releaseHold(tx, "hold-1", 9);
            return WorkResult.ok(PgFixture.obj());
        });
        assertEquals("stale-version", assertInstanceOf(Outcome.Conflict.class, stale).code());
        Outcome ok = runner().execute(ctx, cmd("rel", "r-1", input("v", "1")), tx -> {
            Custody.releaseHold(tx, "hold-1", 1);
            return WorkResult.ok(PgFixture.obj());
        });
        assertTrue(assertInstanceOf(Outcome.Committed.class, ok).changed());
        Outcome again = runner().execute(ctx, cmd("hold", "h-2", input("c", "c1")), hold("hold-2", "c1", "s1", 1));
        assertInstanceOf(Outcome.Committed.class, again);
    }

    @Test
    void concurrentDuplicateCommandIdCommitsOnceAndTheOtherAnswersFromTheReceipt() throws Exception {
        TransactionRunner a = runner();
        TransactionRunner b = runner();
        Command same = cmd("hold", "dup-1", input("c", "c1"));
        List<Outcome> outcomes = Support.race(
                () -> a.execute(ctx, same, hold("hold-a", "c1", "s1", 1)),
                () -> b.execute(ctx, same, hold("hold-a", "c1", "s1", 1)));
        List<Outcome.Committed> committed = outcomes.stream().map(o -> assertInstanceOf(Outcome.Committed.class, o)).toList();
        assertEquals(1, committed.stream().filter(c -> !c.replayed()).count());
        assertEquals(1, committed.stream().filter(Outcome.Committed::replayed).count());
        assertEquals(committed.get(0).result(), committed.get(1).result());
        assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_id = 'dup-1'"));
        assertEquals(2, f.revision(ctx));
    }
}
