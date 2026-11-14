package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.TransactionRunner;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** A commit that fails on the wire is pending with the command id; inspect and replay settle it. */
class ClaimUncertainTest {

    ClaimFixture f;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        f.employee("e1");
        f.car("car-1");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    private ManualClaims over(boolean reallyCommit) throws SQLException {
        DataSource real = f.pool();
        DataSource flaky = (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(),
                new Class<?>[] {DataSource.class}, (p, m, a) -> {
                    try {
                        if (!m.getName().equals("getConnection")) return m.invoke(real, a);
                        Connection c = real.getConnection();
                        return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                                (cp, cm, ca) -> {
                                    if (cm.getName().equals("commit")) {
                                        if (reallyCommit) c.commit();
                                        throw new SQLException("connection lost during commit", "08006");
                                    }
                                    try {
                                        return cm.invoke(c, ca);
                                    } catch (InvocationTargetException e) {
                                        throw e.getCause();
                                    }
                                });
                    } catch (InvocationTargetException e) {
                        throw e.getCause();
                    }
                });
        return new ManualClaims(real, new TransactionRunner(flaky), f.clock, f.timing, f.selection, f.offers);
    }

    @Test
    void aCommitThatLandedButWasNotConfirmedIsPendingAndSettlesByReplay() throws Exception {
        ObjectNode input = f.claimInput("cmd-u1", "car-1", 1);
        ClaimResult r = over(true).claim(f.scope("e1"), input);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class, r);
        assertTrue(p.uncertain());
        assertEquals("outcome-uncertain", p.code());
        assertEquals("cmd-u1", p.operationId());
        assertEquals(1, f.holdsOn("car-1"));
        assertInstanceOf(Inspection.Committed.class, new TransactionRunner(f.pool()).inspect(f.scope("e1").context(), "cmd-u1"));
        ClaimResult.Ok again = assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("e1"), input.deepCopy()));
        assertTrue(again.replayed());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void aCommitThatDidNotLandIsPendingAndSafeToResubmit() throws Exception {
        ObjectNode input = f.claimInput("cmd-u2", "car-1", 1);
        ClaimResult.Pending p = assertInstanceOf(ClaimResult.Pending.class, over(false).claim(f.scope("e1"), input));
        assertEquals("cmd-u2", p.operationId());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertInstanceOf(Inspection.Absent.class, new TransactionRunner(f.pool()).inspect(f.scope("e1").context(), "cmd-u2"));
        assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("e1"), input.deepCopy()));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
    }
}
