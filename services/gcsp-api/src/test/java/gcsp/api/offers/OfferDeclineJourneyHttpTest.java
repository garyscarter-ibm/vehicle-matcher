package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_2;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.offers.OfferDecisionJourneySupport.accept;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.decline;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static gcsp.api.offers.OfferDecisionJourneySupport.written;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-466 AC2: decline, refused downstream work, replay and expiry stay truthful through the started app. */
@QuarkusTest
@TestProfile(OfferJourneyProfiles.Decline.class)
class OfferDeclineJourneyHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void declineReleasesAuthorityAndExpiryRefusesWithoutWriting() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String bruno = s.token("sub-bruno", "employee");
        String paulaOffer = OfferDecisionJourneySupport.allocate(s, presenter, PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);

        // Refused downstream work stays truthful: a stale terms digest is a typed 409 and the hold stays active.
        JsonNode paulaView = view(paula, paulaOffer);
        String beforeStale = written(s);
        JsonNode stale = decide(paula, paulaOffer, accept("accept-stale", paulaView, "0".repeat(64)), 409);
        assertNotNull(stale.get("code"), stale.toString());
        assertEquals(beforeStale, written(s));
        assertEquals("active", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ? AND state = 'active'", PAULA));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));

        // Bruno declines with a registry reason; the hold is released and the decline event is written once.
        JsonNode reasons = body(get(bruno, path(brunoOffer) + "/decision-reasons").then().statusCode(200).extract().response())
                .get("value");
        assertNotNull(reasons.get("provenance"));
        String reason = reasons.get("reasons").get(0).get("code").asText();
        JsonNode brunoView = view(bruno, brunoOffer);
        ObjectNode body = decline("decline-1", brunoView, reason);
        JsonNode first = decide(bruno, brunoOffer, body, 200).get("value");
        assertEquals("declined", first.get("state").asText());
        assertEquals(reason, first.get("reasonCode").asText());
        assertEquals("waiting-for-next-offer", first.get("followUp").get("state").asText());
        assertEquals("released", s.text("SELECT state FROM custody_holds WHERE employee_id = ?", BRUNO));
        assertEquals("declined", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", brunoOffer));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'decline' "
                + "AND reason_code = ?", brunoOffer, reason));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));
        assertEquals("released", s.text("SELECT state FROM stock_cars WHERE order_uuid = ?", CAR_2));
        s.assertCustodyInvariants(1);

        // Replay returns the stored outcome with no new row; changed input and a later accept are refused.
        String after = written(s);
        JsonNode replay = decide(bruno, brunoOffer, body, 200).get("value");
        assertEquals(first.get("decisionId").asText(), replay.get("decisionId").asText());
        assertEquals(first.get("decidedAt").asText(), replay.get("decidedAt").asText());
        assertEquals(after, written(s));
        ObjectNode changed = decline("decline-1", brunoView, reasons.get("reasons").get(1).get("code").asText());
        assertEquals("command-input-changed", decide(bruno, brunoOffer, changed, 409).get("code").asText());
        JsonNode late = decide(bruno, brunoOffer, accept("accept-late", brunoView, "0".repeat(64)), 409);
        assertEquals("offer-no-longer-pending", late.get("code").asText());
        assertEquals("declined", late.get("current").get("state").asText());
        assertEquals(after, written(s));

        // The supported follow-up after a decline is waiting for the next offer; a never-declined offer has none.
        JsonNode followUp = body(get(bruno, path(brunoOffer) + "/follow-up").then().statusCode(200).extract().response())
                .get("value");
        assertEquals("waiting-for-next-offer", followUp.get("state").asText());
        assertEquals(first.get("decisionId").asText(), followUp.get("decisionId").asText());
        assertTrue(followUp.get("nextOfferId").isNull());
        get(paula, path(paulaOffer) + "/follow-up").then().statusCode(404);
        assertFalse(get(bruno, path(brunoOffer) + "/follow-up").asString().contains(paulaOffer));

        // Expiry on the run clock: past the hold duration, with no wall wait and no tick, the offer is refused.
        s.advance(presenter, 7200 + 60);
        // The current terms are read after the deadline: the refusal must come from the offer, not from stale terms.
        assertEquals("active", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        String beforeExpiry = written(s);
        JsonNode expired = decide(paula, paulaOffer, accept("accept-expired", paulaView, OfferDecisionJourneySupport.termsDigest(paula)), 409);
        assertTrue(expired.get("code").asText().matches("deadline-passed|offer-not-actionable"), expired.toString());
        assertEquals(beforeExpiry, written(s));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));
        JsonNode expiredView = view(paula, paulaOffer);
        assertEquals("expired", expiredView.get("state").asText());
    }
}
