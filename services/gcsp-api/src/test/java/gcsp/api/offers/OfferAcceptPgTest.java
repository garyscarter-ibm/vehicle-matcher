package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Local offer accept end to end over a real Postgres schema: ordering's transaction, the locked recheck and rollback. */
class OfferAcceptPgTest {

    private DecisionEnv env;

    @BeforeEach
    void open() throws SQLException {
        env = DecisionEnv.open(true);
    }

    @AfterEach
    void close() throws SQLException {
        if (env != null) env.close();
    }

    private void assertUntouched() throws SQLException {
        assertEquals("active", env.text("SELECT state FROM buddy_offers"));
        assertEquals("active", env.text("SELECT state FROM custody_holds"));
        assertEquals("released", env.text("SELECT state FROM stock_cars"));
        assertEquals(1, env.count("SELECT version FROM stock_cars"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, env.count("SELECT count(*) FROM outbox_events"));
    }

    private void assertRefused(OfferOutcome o, int http, String code) throws SQLException {
        assertEquals(http, o.http(), o.code());
        assertEquals(code, o.code());
        assertUntouched();
    }

    @Test
    void acceptAllocatesTheCarRecordsTheDecisionAndTheSelectionInOneRevision() throws Exception {
        long revision = env.count("SELECT revision FROM runs");
        OfferOutcome o = env.acceptOk();
        assertEquals(200, o.http(), o.code());
        assertEquals("accepted", o.value().get("state").textValue());
        assertEquals("accept", o.value().get("decision").textValue());
        assertEquals(2, o.value().get("offerVersion").asLong());
        assertEquals(2, o.value().get("holdVersion").asLong());
        assertNull(o.value().get("replayed"));
        assertEquals("acknowledged", o.value().at("/selection/status").textValue());
        assertEquals("accepted", env.text("SELECT state FROM buddy_offers"));
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals("allocated", env.text("SELECT state FROM stock_cars"));
        assertEquals(2, env.count("SELECT version FROM stock_cars"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept' AND reason_code IS NULL"));
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders WHERE source_type = 'buddy-offer' "
                + "AND order_uuid = (SELECT order_uuid FROM stock_cars)"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-received'"));
        assertEquals(revision + 1, env.count("SELECT run_revision FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals(1, env.count("SELECT count(DISTINCT run_revision) FROM outbox_events WHERE event_type IN "
                + "('offer-accepted', 'ordering.selection-received')"));
        assertEquals(o.value().get("operationId").textValue(),
                env.text("SELECT versions->>'operationId' FROM offer_decisions"));
        assertEquals("new", env.text("SELECT selection->'draft'->>'mode' FROM selection_orders"));
    }

    @Test
    void theSameCommandReplaysAndWritesNothing() throws Exception {
        OfferOutcome first = env.acceptOk();
        long written = env.written();
        OfferOutcome again = env.acceptOk();
        assertEquals(200, again.http(), again.code());
        assertTrue(again.value().get("replayed").booleanValue());
        assertEquals(first.value().get("decisionId"), again.value().get("decisionId"));
        assertEquals(written, env.written());
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(2, env.count("SELECT version FROM stock_cars"));
    }

    @Test
    void aChangedInputOrAnotherCommandIsRefusedAfterTheAccept() throws Exception {
        env.acceptOk();
        OfferOutcome changed = env.decide(env.accept("cmd-1", 1, 2, null));
        assertEquals("command-input-changed", changed.code());
        OfferOutcome other = env.decide(env.accept("cmd-2", 1, 1, null));
        assertEquals(409, other.http());
        assertEquals("offer-no-longer-pending", other.code());
        assertEquals("accepted", other.current().get("state").textValue());
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
    }

    @Test
    void aStaleVersionChangesNothing() throws Exception {
        assertRefused(env.decide(env.accept("c1", 2, 1, null)), 409, "stale-version");
        assertRefused(env.decide(env.accept("c2", 1, 2, null)), 409, "stale-version");
    }

    @Test
    void theDeadlineIsInclusive() throws Exception {
        env.now[0] = DecisionEnv.NOW.plusSeconds(3600);
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "deadline-passed");
    }

    @Test
    void anExpiredQuoteIsRefused() throws Exception {
        env.pg.rollQuoteEnd(Instant.parse("2026-11-14T08:59:00Z"));
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "quote-no-longer-valid");
    }

    @Test
    void anAllowanceBelowTheQuoteIsRefused() throws Exception {
        env.pg.rollMonthlyPoints(1200);
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "allowance-exceeded");
    }

    @Test
    void anEmployeeNoLongerEligibleIsRefused() throws Exception {
        env.pg.alterQuote("UPDATE buddy_quotes SET quote = jsonb_set(quote, '{snapshot,facts,eligibilityModelKey,value}', "
                + "'\"F70 Sports Hatch|M135\"')");
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "current-eligibility-refused");
    }

    @Test
    void aChangedBriefIsRefusedButReorderedListsAreNot() throws Exception {
        env.pg.update("UPDATE brief_heads SET brief_version = 4");
        env.insertBrief(4, DecisionEnv.ESSENTIALS.replace("[\"b\",\"a\"]", "[\"a\",\"b\"]"));
        assertEquals(200, env.decide(env.accept("c1", 1, 1, null)).http());
    }

    @Test
    void aBriefWithADifferentEssentialIsRefused() throws Exception {
        env.pg.update("UPDATE brief_heads SET brief_version = 4");
        env.insertBrief(4, DecisionEnv.ESSENTIALS.replace("\"value\":5", "\"value\":7"));
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "brief-changed-review-required");
    }

    @Test
    void noContactIsRefusedBeforeAnyWrite() throws Exception {
        env.setAccount(DecisionEnv.record(false).replace("\"contact\":{\"phone\":\"01632 960000\",\"email\":\"paula@example.test\"}",
                "\"contact\":{}"));
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "contact-required");
    }

    @Test
    void anUnconfiguredAccountSourceIsUnavailable() throws Exception {
        env.pg.update("DELETE FROM employee_account_records");
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 503, "selection-source-unavailable");
    }

    @Test
    void aReplacementNeedsTheReturnMileageAndANewOrderRefusesOne() throws Exception {
        assertRefused(env.decide(env.accept("c0", 1, 1, 100L)), 409, "return-mileage-not-applicable");
        env.setAccount(DecisionEnv.record(true));
        ObjectNode none = env.accept("c1", 1, 1, 100L);
        none.remove("expectedReturnMileage");
        assertRefused(env.decide(none), 400, "expected-return-mileage-required");
        assertRefused(env.decide(env.accept("c2", 1, 1, 900000L)), 400, "expected-return-mileage-required");
        assertEquals(200, env.decide(env.accept("c3", 1, 1, 12000L)).http());
        assertEquals("replacement", env.text("SELECT selection->'draft'->>'mode' FROM selection_orders"));
        assertEquals("12000", env.text("SELECT selection->'sourceVersions'->'returnOdometer'->>'value' FROM selection_orders"));
    }

    @Test
    void aRemoteHoldIsRefused() throws Exception {
        env.mode = "remote";
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 503, "remote-decision-protocol-required");
    }

    @Test
    void aCarWithNoOrderNumberChangesTheSelectionAuthority() throws Exception {
        env.pg.update("UPDATE stock_cars SET attributes = '{}'::jsonb");
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "selection-authority-changed");
    }

    @Test
    void aCarTakenOrBumpedBeforeTheAcceptIsRefused() throws Exception {
        env.pg.update("UPDATE stock_cars SET state = 'allocated'");
        assertEquals("selection-authority-changed", env.decide(env.accept("c1", 1, 1, null)).code());
    }

    @Test
    void anotherEmployeeIsForbidden() throws Exception {
        OfferOutcome o = env.decisions.decide(DecisionEnv.employee("E-1002"), env.offerId, env.accept("c1", 1, 1, null));
        assertEquals(403, o.http());
        assertUntouched();
    }

    @Test
    void aConverterRefusalLeavesNoSelectionDecisionOrCustodyChange() throws Exception {
        // The contact check passes prepare; the quote lapses between prepare and convert, inside ordering's transaction.
        env.pg.rollQuoteEnd(Instant.parse("2026-11-14T08:59:59Z"));
        assertRefused(env.decide(env.accept("c1", 1, 1, null)), 409, "quote-no-longer-valid");
        assertEquals(0, env.count("SELECT count(*) FROM pending_operations"));
    }

    @Test
    void anAcceptBodyWithoutTermsOrDeclarationsIsInvalid() throws Exception {
        ObjectNode b = env.accept("c1", 1, 1, null);
        b.remove("termsDigest");
        assertEquals("invalid-offer-decision", env.decide(b).code());
        b = env.accept("c1", 1, 1, null);
        b.remove("declarations");
        assertEquals("invalid-offer-decision", env.decide(b).code());
        b = env.accept("c1", 1, 1, null);
        b.put("reasonCode", "size");
        assertEquals(400, env.decide(b).http());
        b = env.accept("c1", 1, 1, null);
        b.put("expectedReturnMileage", -1);
        assertEquals(400, env.decide(b).http());
    }

    @Test
    void aChangedTermsDigestIsRefusedByOrderingAndNothingIsWritten() throws Exception {
        ObjectNode b = env.accept("c1", 1, 1, null);
        b.put("termsDigest", "0".repeat(64));
        OfferOutcome o = env.decide(b);
        assertEquals(409, o.http());
        assertEquals("terms-changed", o.code());
        assertUntouched();
    }
}
