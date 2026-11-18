package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.BuddyJourneySupport;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** Offer links over the actual OIDC/JWKS, allocation, PostgreSQL and employee projection beans. */
@QuarkusTest
@TestProfile(OfferLinkHttpTest.Profile.class)
class OfferLinkHttpTest {
    public static class Profile extends OfferJourneyProfiles.Accept {}

    @Inject AgroalDataSource dataSource;
    @Inject OfferRecords records;
    @ConfigProperty(name = "gcsp.test.signing-jwk") String signingJwk;

    @Test
    void newLinkShowsPinnedCurrentOfferOnlyToItsSignedInEmployee() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String owner = s.token("sub-paula", "employee");
        String offerId = OfferDecisionJourneySupport.allocate(s, presenter, PAULA);
        assertInstanceOf(PostgresOfferRecords.class, ClientProxy.unwrap(records));
        JsonNode offer = view(owner, offerId);
        assertEquals(s.text("SELECT run_id FROM buddy_offers WHERE offer_id = ?", offerId), offer.path("runId").asText());
        assertEquals("pending", offer.path("state").asText());
        assertEquals("awaiting-decision", offer.path("reason").asText());
        assertEquals("[\"accept\",\"decline\"]", offer.path("availableActions").toString());
        assertEquals("vehicle-snapshot-v1", offer.path("quote").path("facts").path("contractVersion").asText());
        assertEquals(s.text("SELECT order_uuid FROM buddy_quotes WHERE quote_id = ?", offer.path("quote").path("quoteId").asText()),
                offer.path("quote").path("facts").path("sourceKeys").path("stockId").asText());
        assertTrue(offer.path("quote").path("briefVersion").isIntegralNumber());
        assertTrue(offer.path("quote").path("decision").has("reasons"));
        assertFalse(offer.path("handoff").isNull());
        assertTrue(offer.path("handoff").path("blocker").isNull());
        assertFalse(offer.has("employeeId"));
        assertFalse(offer.has("holdId"));
        save("active", offer);

        get(s.token("sub-carla", "employee"), path(offerId)).then().statusCode(403);
        get(presenter, path(offerId)).then().statusCode(403);
        get(owner, path("bad%20id")).then().statusCode(400);
        get(owner, path("buddy-offer:" + "f".repeat(64))).then().statusCode(404);
        io.restassured.RestAssured.given().when().get(path(offerId)).then().statusCode(401);

        // A fresh reader has no link/session cache: durable run/offer/quote identity resolves unchanged.
        OfferRecords.Found found = assertInstanceOf(OfferRecords.Found.class, records.find(
                new gcsp.api.persistence.RunContext(s.text("SELECT environment_id FROM buddy_offers WHERE offer_id = ?", offerId),
                        offer.path("runId").asText(), "restart-proof"), offerId));
        PostgresOfferRecords restarted = new PostgresOfferRecords(() -> true, () -> dataSource);
        assertEquals(found, restarted.find(new gcsp.api.persistence.RunContext(
                s.text("SELECT environment_id FROM buddy_offers WHERE offer_id = ?", offerId),
                offer.path("runId").asText(), "restart-proof"), offerId));

        JsonNode acceptedReceipt = OfferDecisionJourneySupport.decide(owner, offerId,
                OfferDecisionJourneySupport.accept("offer-link-accept", offer, OfferDecisionJourneySupport.termsDigest(owner)), 200);
        assertEquals("accepted", acceptedReceipt.path("value").path("state").asText());
        JsonNode accepted = view(owner, offerId);
        assertEquals("accepted", accepted.path("state").asText());
        assertEquals(0, accepted.path("availableActions").size());
        assertFalse(accepted.path("selection").isNull());
        assertEquals("acknowledged", accepted.path("selection").path("selectionState").asText());
        save("accepted", accepted);
        String before = OfferDecisionJourneySupport.written(s);
        OfferDecisionJourneySupport.decide(owner, offerId,
                OfferDecisionJourneySupport.accept("offer-link-terminal", accepted,
                        OfferDecisionJourneySupport.termsDigest(owner)), 409);
        assertEquals(before, OfferDecisionJourneySupport.written(s));

        // Expiry is read from the authoritative run clock and removes decision authority.
        String otherOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);
        s.advance(presenter, 8 * 24 * 60 * 60);
        JsonNode expired = view(s.token("sub-bruno", "employee"), otherOffer);
        assertEquals("expired", expired.path("state").asText());
        assertEquals(0, expired.path("availableActions").size());
        save("expired", expired);

        // Retirement makes every old reference stale, without granting decision authority in the next run.
        try (var c = dataSource.getConnection(); var statement = c.createStatement()) {
            statement.executeUpdate("UPDATE runs SET status = 'retired', retired_at = now() WHERE status = 'active'");
            statement.executeUpdate("INSERT INTO runs (environment_id, run_id, status) SELECT environment_id, 'offer-link-next-run', 'active' FROM environment_identity");
        }
        get(owner, path(offerId)).then().statusCode(409);
    }

    private static void save(String state, JsonNode value) throws Exception {
        String destination = System.getenv("FUCQ465_PROJECTION_DIR");
        if (destination != null && !destination.isBlank()) {
            Files.writeString(Path.of(destination).resolve(state + ".json"), value.toPrettyString());
        }
    }
}
