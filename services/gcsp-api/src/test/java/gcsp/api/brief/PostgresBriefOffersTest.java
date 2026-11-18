package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The offer port reads buddy_offers for one employee in one run and fails closed. */
class PostgresBriefOffersTest {

    BriefFixture f;
    Harness h;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
        f.account.contract("contract-1", "Model X");
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private PostgresBriefOffers port(PGSimpleDataSource pool) {
        return new PostgresBriefOffers(() -> true, () -> pool);
    }

    /** Replica mode skips the hold, quote and order rows this read never touches. */
    private void offer(String run, String id, String employee, String state, long briefVersion, String created) throws SQLException {
        try (Connection c = f.pool().getConnection()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, "
                    + "employee_id, order_uuid, state, brief_version, policy_version, expires_at, created_at) "
                    + "VALUES (?, ?, ?, ?, 'q', ?, ?, ?, ?, 'gcsp-policy-v1', now() + interval '1 day', ?::timestamptz)")) {
                ps.setString(1, BriefFixture.ENV);
                ps.setString(2, run);
                ps.setString(3, id);
                ps.setString(4, "hold-" + id);
                ps.setString(5, employee);
                ps.setString(6, "order-" + id);
                ps.setString(7, state);
                ps.setLong(8, briefVersion);
                ps.setString(9, created);
                ps.executeUpdate();
            }
        }
    }

    @Test
    void listsOnlyThisEmployeesOffersInThisRunInCreationOrder() throws Exception {
        offer("run-1", "o-b", "emp-1", "declined", 2, "2026-11-13T10:00:00Z");
        offer("run-1", "o-a", "emp-1", "active", 1, "2026-11-13T09:00:00Z");
        offer("run-1", "o-other", "emp-2", "accepted", 1, "2026-11-13T09:00:00Z");
        offer("run-2", "o-run2", "emp-1", "accepted", 1, "2026-11-13T09:00:00Z");
        List<BriefOfferPort.Offer> found = port(f.pool()).offers(BriefFixture.ENV, "run-1", "emp-1");
        assertEquals(List.of(new BriefOfferPort.Offer("o-a", "active", 1L), new BriefOfferPort.Offer("o-b", "declined", 2L)), found);
        assertTrue(port(f.pool()).offers(BriefFixture.ENV, "run-1", "nobody").isEmpty());
    }

    @Test
    void anInactivePersistenceListsNothing() throws Exception {
        assertTrue(new PostgresBriefOffers(() -> false, () -> {
            throw new AssertionError("no connection without persistence");
        }).offers(BriefFixture.ENV, "run-1", "emp-1").isEmpty());
    }

    @Test
    void anAcceptedOfferMakesTheBriefReadOnlyThroughARealService() throws Exception {
        BriefService real = new BriefService(f.pool(), f.policy, f.account, port(f.pool()), java.time.Clock.fixed(BriefFixture.NOW, java.time.ZoneOffset.UTC));
        BriefResult first = real.savePreferences(f.scope, Harness.envelope("p1", 0, 0).set("changes", Harness.obj()
                .set("comfort", Harness.obj().put("value", 50))));
        h.ok(first);
        offer("run-1", "o-acc", "emp-1", "accepted", 1, "2026-11-13T09:00:00Z");
        List<Long> before = f.snapshot();
        h.refused(real.savePreferences(f.scope, Harness.envelope("p2", 0, 1).set("changes", Harness.obj()
                .set("size", Harness.obj().put("value", 50)))), 409, "brief-read-only");
        assertEquals(before, f.snapshot());
    }

    @Test
    void aClosedPoolOrFailureIsUnavailableNeverAnEmptyList() throws Exception {
        PGSimpleDataSource broken = new PGSimpleDataSource();
        broken.setUrl("jdbc:postgresql://127.0.0.1:1/none?connectTimeout=1");
        BriefService real = new BriefService(f.pool(), f.policy, f.account, port(broken), java.time.Clock.fixed(BriefFixture.NOW, java.time.ZoneOffset.UTC));
        h.refused(real.readEditor(f.scope), 503, "brief-unavailable");
        h.refused(real.savePreferences(f.scope, Harness.envelope("p3", 0, 0).set("changes", Harness.obj()
                .set("comfort", Harness.obj().put("value", 50)))), 503, "brief-unavailable");
        assertEquals(0, f.count("SELECT count(*) FROM brief_drafts"));
        PostgresBriefOffers missingTable = port(f.pool());
        f.update("DROP TABLE buddy_offers CASCADE");
        h.refused(new BriefService(f.pool(), f.policy, f.account, missingTable, java.time.Clock.fixed(BriefFixture.NOW, java.time.ZoneOffset.UTC)).resolveInitial(f.scope), 503, "brief-unavailable");
    }
}
