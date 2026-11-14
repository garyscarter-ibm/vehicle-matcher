package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Buddy holds, replay and validation: what a claim must refuse or answer identically. */
class ClaimExclusivityTest {

    ClaimFixture f;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        f.employee("e1");
        f.employee("e2");
        f.car("car-1");
        f.car("car-2");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    @Test
    void aBuddyHoldOnTheCarRefusesAManualClaim() throws Exception {
        f.buddyHold("buddy-1", "car-1", "e2");
        ClaimResult r = f.claims.claim(f.scope("e1"), f.claimInput("car-1"));
        assertEquals("car-held", assertInstanceOf(ClaimResult.Conflict.class, r).code());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds WHERE hold_type = 'cart'"));
        assertEquals(0, f.count("SELECT count(*) FROM manual_claims"));
        assertEquals(1, f.carVersion("car-1"));
    }

    @Test
    void aBuddyHoldOnTheEmployeesSlotRefusesWithOfferHeldAndTheOfferId() throws Exception {
        f.buddyHold("buddy-1", "car-2", "e1");
        f.offers.offerId = "offer-9";
        ClaimResult r = f.claims.claim(f.scope("e1"), f.claimInput("car-1"));
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class, r);
        assertEquals("offer-held", c.code());
        assertEquals("offer-9", c.extra().get("offerId").asText());
        assertEquals("view-offer", c.view().get("action").asText());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds WHERE hold_type = 'cart'"));
        assertEquals(1, f.carVersion("car-1"));
    }

    @Test
    void offerHeldWithoutALookupHasANullOfferId() throws Exception {
        f.buddyHold("buddy-1", "car-2", "e1");
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        assertTrue(c.extra().get("offerId").isNull());
    }

    @Test
    void anExistingCartClaimOnTheSlotIsReleaseRequiredAndAnAllocatedOneIsEntitlementUnavailable() throws Exception {
        f.claimOk("e1", "car-1");
        assertEquals("release-required",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-2"))).code());
        f.update("UPDATE custody_holds SET state = 'allocated' WHERE hold_type = 'cart'");
        assertEquals("entitlement-unavailable",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-2"))).code());
    }

    @Test
    void anEmployeeWithoutTheSlotRowIsEntitlementUnavailable() throws Exception {
        f.update("DELETE FROM entitlement_slots WHERE employee_id = 'e2'");
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e2"), f.claimInput("car-1")));
        assertEquals("entitlement-unavailable", c.code());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void theSameCommandAndInputReplaysTheOriginalWithNoSecondHold() throws Exception {
        ObjectNode input = f.claimInput("cmd-fixed", "car-1", 1);
        ClaimResult first = f.claims.claim(f.scope("e1"), input);
        ClaimResult again = f.claims.claim(f.scope("e1"), input.deepCopy());
        JsonNode a = assertInstanceOf(ClaimResult.Ok.class, first).value();
        ClaimResult.Ok b = assertInstanceOf(ClaimResult.Ok.class, again);
        assertTrue(b.replayed());
        assertEquals("replayed", b.code());
        assertEquals(gcsp.api.persistence.Canonical.json(a), gcsp.api.persistence.Canonical.json(b.value()));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(2, f.carVersion("car-1"));
        assertEquals(1, f.count("SELECT count(*) FROM command_receipts WHERE command_id = 'cmd-fixed'"));
    }

    @Test
    void aReplayAnswersEvenAfterTheClaimWasReleased() throws Exception {
        ObjectNode input = f.claimInput("cmd-fixed", "car-1", 1);
        JsonNode hold = ClaimFixture.value(f.claims.claim(f.scope("e1"), input)).get("hold");
        assertInstanceOf(ClaimResult.Ok.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput("rel-1", hold.get("holdId").asText(), hold.get("version").asLong(), "cancel")));
        ClaimResult.Ok again = assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("e1"), input.deepCopy()));
        assertTrue(again.replayed());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void theSameCommandIdWithChangedInputIsIdempotencyInputChanged() throws Exception {
        ObjectNode input = f.claimInput("cmd-fixed", "car-1", 1);
        assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("e1"), input));
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class,
                f.claims.claim(f.scope("e1"), f.claimInput("cmd-fixed", "car-2", 1)));
        assertEquals("idempotency-input-changed", c.code());
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, f.carVersion("car-2"));
    }

    @Test
    void unknownOrBadlyTypedFieldsAreInvalidAndWriteNothing() throws Exception {
        ObjectNode extra = f.claimInput("car-1");
        extra.put("surprise", true);
        assertInstanceOf(ClaimResult.Invalid.class, f.claims.claim(f.scope("e1"), extra));
        ObjectNode typed = f.claimInput("car-1");
        typed.put("expectedStockVersion", "1");
        assertEquals("expectedStockVersion", assertInstanceOf(ClaimResult.Invalid.class, f.claims.claim(f.scope("e1"), typed)).field());
        ObjectNode missing = f.claimInput("car-1");
        missing.remove("expectedTermsDigest");
        assertInstanceOf(ClaimResult.Invalid.class, f.claims.claim(f.scope("e1"), missing));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void staleDraftContextTermsAndStockAreStaleVersionNamingTheResource() throws Exception {
        ObjectNode draft = f.claimInput("car-1");
        draft.put("expectedDraftVersion", 7);
        assertEquals("manual-draft", stale(f.claims.claim(f.scope("e1"), draft)));
        ObjectNode ctx = f.claimInput("car-1");
        ctx.put("expectedContextVersion", "ctx-0");
        assertEquals("manual-context", stale(f.claims.claim(f.scope("e1"), ctx)));
        ObjectNode terms = f.claimInput("car-1");
        terms.put("expectedTermsDigest", "0".repeat(64));
        assertEquals("manual-terms", stale(f.claims.claim(f.scope("e1"), terms)));
        assertEquals("stock", stale(f.claims.claim(f.scope("e1"), f.claimInput(ClaimFixture.commandId(), "car-1", 5))));
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void anIneligibleCarOrChangedFactsOrAnAllocatedCarAreRefused() throws Exception {
        f.selection.eligible = false;
        assertEquals("car-not-eligible-or-available",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-1"))).code());
        f.selection.eligible = true;
        f.update("UPDATE stock_cars SET attributes = '{\"colour\":\"blue\"}'::jsonb WHERE order_uuid = 'car-1'");
        assertEquals("stock-facts-changed",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-1"))).code());
        f.update("UPDATE stock_cars SET state = 'allocated' WHERE order_uuid = 'car-2'");
        assertEquals("stock-unavailable",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-2"))).code());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void anExpiredQuoteIsRefused() throws Exception {
        f.selection.validUntil = ClaimFixture.T0;
        assertEquals("quote-expired",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.claim(f.scope("e1"), f.claimInput("car-1"))).code());
    }

    @Test
    void theClaimPinsTheQuoteAndTimingAndEmitsOneEvent() throws Exception {
        JsonNode view = ClaimFixture.value(f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        assertEquals("quoted", view.get("state").asText());
        assertEquals("review-or-cancel", view.get("view").get("action").asText());
        assertEquals("preview", view.get("hold").get("phase").asText());
        JsonNode quote = view.get("quote");
        assertEquals(120, quote.get("timing").get("previewSeconds").asLong());
        assertEquals(600, quote.get("timing").get("reviewSeconds").asLong());
        assertEquals("once-from-preview", quote.get("timing").get("transition").asText());
        assertEquals(f.digest(), quote.get("termsDigest").asText());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'manual-claim-changed'"));
        assertEquals("local", f.text("SELECT mode FROM manual_claims"));
        assertEquals(1, f.count("SELECT slot_unit FROM custody_holds"));
    }

    private static String stale(ClaimResult r) {
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class, r);
        assertEquals("stale-version", c.code());
        return c.extra().get("resource").asText();
    }
}
