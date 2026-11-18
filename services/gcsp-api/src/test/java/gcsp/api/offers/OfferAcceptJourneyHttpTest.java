package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_1;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.offers.OfferDecisionJourneySupport.accept;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static gcsp.api.offers.OfferDecisionJourneySupport.termsDigest;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static gcsp.api.offers.OfferDecisionJourneySupport.written;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-466 AC1: an authorized accept through the started app, real RS256 JWTs and PostgreSQL, once and only once. */
@QuarkusTest
@TestProfile(OfferJourneyProfiles.Accept.class)
class OfferAcceptJourneyHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    OfferRecords records;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void anAuthorizedAcceptConvertsOnceAndReplaysWithoutNewRows() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String carla = s.token("sub-carla", "employee");
        String bruno = s.token("sub-bruno", "employee");

        // The production composition: the PostgreSQL records bean, and the adopted policy answering over HTTP.
        assertInstanceOf(PostgresOfferRecords.class, ClientProxy.unwrap(records));
        String paulaOffer = OfferDecisionJourneySupport.allocate(s, presenter, PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);
        JsonNode reasons = OfferDecisionJourneySupport.body(get(paula, path(paulaOffer) + "/decision-reasons").then()
                .statusCode(200).extract().response()).get("value");
        assertNotNull(reasons.get("provenance"));
        assertEquals("gcsp-policy-v1+offer-journey-v1", reasons.get("policyVersion").asText());

        JsonNode offer = view(paula, paulaOffer);
        assertEquals("pending", offer.get("state").asText());
        String digest = termsDigest(paula);
        ObjectNode body = accept("accept-1", offer, digest);
        assertTrue(written(s).startsWith("0/0/0/"), "the allocating tick left no decision, selection or operation");
        String before = written(s);

        // Refusals write nothing: another employee, the presenter, and a stale offer version.
        assertEquals(403, BuddyJourneySupport.post(carla, path(paulaOffer) + "/decision", body.toString()).statusCode());
        assertEquals(403, BuddyJourneySupport.post(presenter, path(paulaOffer) + "/decision", body.toString()).statusCode());
        ObjectNode stale = body.deepCopy();
        stale.put("expectedOfferVersion", offer.get("offerVersion").asLong() + 7);
        JsonNode staleBody = decide(paula, paulaOffer, stale, 409);
        assertEquals("stale-version", staleBody.get("code").asText());
        assertEquals(before, written(s));

        // The accept: one selection order, the car allocated to the hold, one decision row, one decision event.
        JsonNode first = decide(paula, paulaOffer, body, 200).get("value");
        assertEquals("accepted", first.get("state").asText());
        assertEquals(paulaOffer, first.get("offerId").asText());
        assertNotNull(first.get("operationId"));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'accept' "
                + "AND command_id = 'accept-1'", paulaOffer));
        assertEquals(1, s.count("SELECT count(*) FROM selection_orders WHERE employee_id = ? AND order_uuid = ? "
                + "AND source_type = 'buddy-offer'", PAULA, CAR_1));
        assertEquals(1, s.count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ? AND state = 'allocated'", PAULA));
        assertEquals("allocated", s.text("SELECT state FROM stock_cars WHERE order_uuid = ?", CAR_1));
        assertEquals("accepted", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        assertEquals("active", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", brunoOffer));
        s.assertCustodyInvariants(1);
        String after = written(s);

        // Replay: the same command answers the same outcome and writes no row; changed input is refused.
        JsonNode replay = decide(paula, paulaOffer, body, 200).get("value");
        assertEquals("accepted", replay.get("state").asText());
        assertEquals(first.get("decisionId").asText(), replay.get("decisionId").asText());
        assertEquals(first.get("serverNow").asText(), replay.get("serverNow").asText());
        assertEquals(after, written(s));
        ObjectNode changed = body.deepCopy();
        changed.putObject("declarations").put("terms", true).put("driver", true).put("return", false);
        assertEquals("command-input-changed", decide(paula, paulaOffer, changed, 409).get("code").asText());
        assertEquals(after, written(s));

        // A second, different command on the decided offer is refused as no longer pending, and writes nothing.
        ObjectNode other = accept("accept-2", offer, digest);
        assertEquals("offer-no-longer-pending", decide(paula, paulaOffer, other, 409).get("code").asText());
        assertEquals(after, written(s));
        assertEquals("accepted", view(paula, paulaOffer).get("state").asText());
        assertTrue(get(paula, API + "/offers/current").then().statusCode(200).extract().asString().length() > 0);
    }
}
