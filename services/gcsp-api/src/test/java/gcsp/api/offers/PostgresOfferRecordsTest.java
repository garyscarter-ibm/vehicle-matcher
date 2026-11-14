package gcsp.api.offers;

import static gcsp.api.offers.OfferFixtures.NOW;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.notify.OfferFacts;
import gcsp.api.persistence.RunContext;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The offer link read end to end over a real Postgres schema: the access rules, the run scope and restart. */
class PostgresOfferRecordsTest {

    private static final String OWNER = "E-1001";
    private static final String OTHER = "E-1002";
    private static final Instant LATER = NOW.plusSeconds(3600);

    private OffersPg pg;
    private PostgresOfferRecords records;
    private OfferAccess access;

    @BeforeEach
    void open() throws SQLException {
        pg = OffersPg.create();
        records = new PostgresOfferRecords(() -> true, () -> source());
        access = new OfferAccess(records, (ctx) -> NOW);
    }

    @AfterEach
    void close() throws SQLException {
        if (pg != null) pg.close();
    }

    private javax.sql.DataSource source() {
        try {
            return pg.pool();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Principal employee(String id) {
        return new Principal("sub-" + id, List.of("employee"), OffersPg.ENV, "run-1", id, "policy-1",
                List.of("account:read"));
    }

    private static Principal role(String role) {
        return new Principal("sub-" + role, List.of(role), OffersPg.ENV, "run-1", null, "policy-1", List.of());
    }

    private String active(String employeeId) throws SQLException {
        return pg.seed("run-1", employeeId, "active", "active", LATER, NOW.minusSeconds(60));
    }

    @Test
    void ownerReadsTheActiveOffer() throws SQLException {
        String id = active(OWNER);
        OfferOutcome out = access.read(employee(OWNER), id);
        assertEquals(200, out.http());
        assertEquals("pending", out.value().get("state").asText());
        assertEquals("awaiting-decision", out.value().get("reason").asText());
        assertEquals("[\"accept\",\"decline\"]", out.value().get("availableActions").toString());
        assertEquals("BMW 120d", out.value().get("quote").get("vehicleName").asText());
        assertEquals("eligible", out.value().get("quote").get("gateStatus").asText());
        assertNull(out.value().get("holdId"));
    }

    @Test
    void otherEmployeeAndNonEmployeeRolesAreRefused() throws SQLException {
        String id = active(OWNER);
        OfferOutcome other = access.read(employee(OTHER), id);
        assertEquals(403, other.http());
        assertEquals("offer-not-owned", other.code());
        assertEquals("role-required", access.read(role("presenter"), id).code());
        assertEquals("role-required", access.read(role("greg"), id).code());
    }

    @Test
    void invalidAndUnknownReferences() throws SQLException {
        active(OWNER);
        assertEquals(400, access.read(employee(OWNER), "bad id").http());
        assertEquals(404, access.read(employee(OWNER), "buddy-offer:" + "9".repeat(64)).http());
    }

    @Test
    void anOfferOfARetiredRunIsStale() throws SQLException {
        String old = active(OWNER);
        pg.rollRun("run-1", "run-2");
        String current = pg.seed("run-2", OWNER, "active", "active", LATER, NOW.minusSeconds(30));
        OfferOutcome stale = access.read(employee(OWNER), old);
        assertEquals(409, stale.http());
        assertEquals("offer-from-earlier-run", stale.code());
        assertEquals(200, access.read(employee(OWNER), current).http());
        List<String> listed = ((OfferRecords.Listed) records.listForEmployee(ctx(), OWNER)).offers().stream()
                .map(OfferRecords.OfferSummary::offerId).toList();
        assertEquals(List.of(current), listed);
    }

    @Test
    void terminalOffersReadAsExpiredWithNoActions() throws SQLException {
        String closed = pg.seed("run-1", OWNER, "expired", "expired", NOW.minusSeconds(60), NOW.minusSeconds(900));
        String lapsed = pg.seed("run-1", OWNER, "active", "active", NOW.minusSeconds(1), NOW.minusSeconds(800));
        for (String id : List.of(closed, lapsed)) {
            OfferOutcome out = access.read(employee(OWNER), id);
            assertEquals(200, out.http());
            assertEquals("expired", out.value().get("state").asText());
            assertEquals(0, out.value().get("availableActions").size());
            OfferAuthority auth = access.authorizeDecision(employee(OWNER), id, 1);
            OfferAuthority.Refused refused = assertInstanceOf(OfferAuthority.Refused.class, auth);
            assertEquals("offer-not-actionable", refused.refusal().code());
        }
    }

    @Test
    void theLinkSurvivesARestart() throws SQLException {
        String id = active(OWNER);
        ObjectNode before = access.read(employee(OWNER), id).value().deepCopy();
        PostgresOfferRecords restarted = new PostgresOfferRecords(() -> true, () -> source());
        ObjectNode after = new OfferAccess(restarted, (ctx) -> NOW).read(employee(OWNER), id).value().deepCopy();
        before.remove("serverNow");
        after.remove("serverNow");
        assertEquals(before, after);
    }

    @Test
    void listIsTheOwnersNewestFirst() throws SQLException {
        String older = pg.seed("run-1", OWNER, "active", "active", LATER, NOW.minusSeconds(500));
        String newer = pg.seed("run-1", OWNER, "expired", "expired", NOW.minusSeconds(10), NOW.minusSeconds(100));
        pg.seed("run-1", OTHER, "active", "active", LATER, NOW.minusSeconds(50));
        var listed = assertInstanceOf(OfferRecords.Listed.class, records.listForEmployee(ctx(), OWNER));
        assertEquals(List.of(newer, older), listed.offers().stream().map(OfferRecords.OfferSummary::offerId).toList());
    }

    @Test
    void inactivePersistenceOrNoActiveRunIsUnavailable() throws SQLException {
        String id = active(OWNER);
        PostgresOfferRecords off = new PostgresOfferRecords(() -> false, () -> source());
        assertInstanceOf(OfferRecords.Unavailable.class, off.find(ctx(), id));
        assertInstanceOf(OfferRecords.Unavailable.class, off.listForEmployee(ctx(), OWNER));
        RunContext otherEnv = new RunContext("no-such-env", "run-1", "a");
        assertInstanceOf(OfferRecords.Unavailable.class, records.find(otherEnv, id));
        PostgresOfferRecords broken = new PostgresOfferRecords(() -> true, () -> {
            throw new IllegalStateException("db down");
        });
        assertInstanceOf(OfferRecords.Unavailable.class, broken.find(ctx(), id));
    }

    @Test
    void notifyFactsAreReadInTheScopedRun() throws SQLException {
        String id = active(OWNER);
        PostgresOfferFacts facts = new PostgresOfferFacts(() -> true, () -> source());
        OfferFacts.Offer offer = assertInstanceOf(OfferFacts.Offer.class, facts.lookup(ctx(), id));
        assertEquals(OWNER, offer.employeeId());
        assertEquals("active", offer.state());
        assertEquals(LATER, offer.expiresAt());
        assertEquals("BMW 120d", offer.vehicleName());
        assertEquals(420, offer.monthlyPoints());
        assertEquals("/img/a.jpg", offer.imagePath());
        assertInstanceOf(OfferFacts.Missing.class, facts.lookup(ctx(), "buddy-offer:" + "9".repeat(64)));
        assertInstanceOf(OfferFacts.Missing.class,
                facts.lookup(new RunContext(OffersPg.ENV, "run-2", "a"), id));
        assertInstanceOf(OfferFacts.Unavailable.class,
                new PostgresOfferFacts(() -> false, () -> source()).lookup(ctx(), id));
        assertFalse(offer.offerId().isBlank());
    }

    private static RunContext ctx() {
        return new RunContext(OffersPg.ENV, "run-1", "actor");
    }
}
