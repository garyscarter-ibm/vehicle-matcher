package gcsp.api.offers;

import static gcsp.api.offers.OfferFixtures.NOW;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.offers.OfferRecords.OfferRecord;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class OfferViewTest {

    private static OfferView view(String offer, String hold) {
        return OfferView.project(OfferFixtures.record(OfferFixtures.OFFER, "E-1", offer, hold), NOW).orElseThrow();
    }

    private static void maps(String offer, String hold, String state, String reason) {
        OfferView v = view(offer, hold);
        assertEquals(state, v.state(), offer + "+" + hold);
        assertEquals(reason, v.reason(), offer + "+" + hold);
        assertEquals(List.of(), v.availableActions());
    }

    @Test
    void everyDocumentedPairing() {
        maps("decision-pending", "selection-pending", "pending", "decision-pending");
        maps("release-pending", "release-pending", "pending", "release-pending");
        maps("accepted", "allocated", "accepted", "accepted");
        maps("declined", "released", "declined", "declined");
        maps("superseded", "released", "superseded", "superseded");
        maps("superseded", "expired", "superseded", "superseded");
        maps("expired", "expired", "expired", "deadline-passed");
        maps("expired", "release-pending", "expired", "release-pending");
        maps("released", "released", "released", "released");
        maps("released", "expired", "released", "released");
    }

    @Test
    void activeOfferIsAwaitingDecisionBeforeItsDeadline() {
        OfferView v = view("active", "active");
        assertEquals("pending", v.state());
        assertEquals("awaiting-decision", v.reason());
        assertEquals(List.of("accept", "decline"), v.availableActions());
    }

    @Test
    void deadlineBoundaryIsExpired() {
        OfferRecord r = OfferFixtures.active("E-1");
        OfferView atDeadline = OfferView.project(r, r.expiresAt()).orElseThrow();
        assertEquals("expired", atDeadline.state());
        assertEquals("deadline-passed", atDeadline.reason());
        assertEquals(List.of(), atDeadline.availableActions());
        OfferView justBefore = OfferView.project(r, r.expiresAt().minusMillis(1)).orElseThrow();
        assertEquals("pending", justBefore.state());
    }

    @Test
    void acceptStopsAtTheQuoteValidityButDeclineRemains() {
        OfferRecord r = OfferFixtures.active("E-1");
        Instant validUntil = r.validUntil();
        assertEquals(List.of("decline"), OfferView.project(r, validUntil).orElseThrow().availableActions());
        assertEquals(List.of("accept", "decline"),
                OfferView.project(r, validUntil.minusMillis(1)).orElseThrow().availableActions());
    }

    @Test
    void nullValidUntilKeepsAcceptOpen() {
        OfferRecord r = OfferFixtures.active("E-1");
        OfferRecord open = new OfferRecord(r.offerId(), r.employeeId(), r.holdId(), r.holdState(), r.quoteId(),
                r.orderUuid(), r.configurationId(), r.state(), r.expiresAt(), r.version(), r.holdVersion(),
                r.createdAt(), r.policyVersion(), r.briefVersion(), r.quotedAt(), null, null, null, null,
                r.gateStatus());
        OfferView v = OfferView.project(open, NOW).orElseThrow();
        assertEquals(List.of("accept", "decline"), v.availableActions());
        assertTrue(v.toJson().get("quote").get("monthlyPoints").isNull());
    }

    @Test
    void anythingOtherThanEligibleOffersNoActions() {
        OfferRecord r = OfferFixtures.active("E-1");
        OfferRecord gated = new OfferRecord(r.offerId(), r.employeeId(), r.holdId(), r.holdState(), r.quoteId(),
                r.orderUuid(), r.configurationId(), r.state(), r.expiresAt(), r.version(), r.holdVersion(),
                r.createdAt(), r.policyVersion(), r.briefVersion(), r.quotedAt(), r.validUntil(), 1, "x", "y",
                "blocked");
        assertEquals(List.of(), OfferView.project(gated, NOW).orElseThrow().availableActions());
    }

    @Test
    void inconsistentPairsProduceNothing() {
        String[][] bad = {{"active", "released"}, {"active", "selection-pending"}, {"accepted", "released"},
                {"declined", "allocated"}, {"decision-pending", "active"}, {"release-pending", "released"},
                {"superseded", "active"}, {"expired", "active"}, {"released", "allocated"}, {"mystery", "active"},
                {"active", "claim-failed"}};
        for (String[] pair : bad) {
            Optional<OfferView> v = OfferView.project(
                    OfferFixtures.record(OfferFixtures.OFFER, "E-1", pair[0], pair[1]), NOW);
            assertTrue(v.isEmpty(), pair[0] + "+" + pair[1]);
        }
    }

    @Test
    void jsonCarriesNoHoldIdOrEmployee() {
        String json = view("active", "active").toJson().toString();
        assertFalse(json.contains("buddy-hold"));
        assertFalse(json.contains("E-1"));
        assertFalse(json.contains("holdId"));
        assertTrue(json.contains("\"serverNow\":\"2026-11-14T09:00:00.000Z\""));
    }
}
