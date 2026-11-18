package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.offers.OfferDecisionJourneySupport.*;
import static org.junit.jupiter.api.Assertions.*;

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
import java.util.HashSet;
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** FUCQ-466: Angular's real wire shape against signed OIDC, adopted policy and native PostgreSQL. */
@QuarkusTest
@TestProfile(OfferBrowserDecisionJourneyHttpTest.Profile.class)
class OfferBrowserDecisionJourneyHttpTest {
    public static class Profile extends OfferJourneyProfiles.Accept {}

    @ConfigProperty(name = "gcsp.test.signing-jwk") String signingJwk;
    @Inject AgroalDataSource dataSource;
    @Inject RunClockDocumentClock runClockDocuments;

    @Test
    void browserCommandsHaveActualStableReceiptsAndPreserveDecisionAuthority() throws Exception {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String bruno = s.token("sub-bruno", "employee");
        String paulaOffer = allocate(s, presenter, PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);
        JsonNode offer = view(paula, paulaOffer);
        ObjectNode accept = coordinates(accept("browser-accept", offer, termsDigest(paula)), offer);
        String before = written(s);
        assertEquals("stale-run", decide(paula, paulaOffer, accept.deepCopy().put("runId", "another-run"), 409).path("status").asText());
        assertEquals("stale-version", decide(paula, paulaOffer, accept.deepCopy().put("expectedQuoteVersion", 2), 409).path("code").asText());
        assertEquals(403, BuddyJourneySupport.post(bruno, path(paulaOffer) + "/decision", accept.toString()).statusCode());
        assertEquals(before, written(s));

        JsonNode accepted = decide(paula, paulaOffer, accept, 200).path("value");
        receipt(accepted, accept, paulaOffer, "accepted", "allocated");
        System.out.println("F466_BROWSER_RECEIPT " + new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode()
                .put("employeeId", PAULA).set("input", accept.deepCopy().put("offerId", paulaOffer)).toString());
        System.out.println("F466_ACCEPT_RECEIPT " + accepted);
        assertEquals("acknowledged", accepted.path("selection").path("operationState").asText());
        assertEquals("confirmed", accepted.path("selection").path("order").path("status").asText());
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ?", paulaOffer));
        assertEquals(1, s.count("SELECT count(*) FROM selection_orders"));
        String after = written(s);
        // The decision snapshot is immutable while the current run clock moves on.
        s.advance(presenter, 1);
        JsonNode replay = decide(paula, paulaOffer, accept, 200).path("value");
        assertEquals(accepted, replay);
        assertEquals(after, written(s));
        assertEquals("command-input-changed", decide(paula, paulaOffer,
                accept.deepCopy().put("expectedReturnMileage", 5401), 409).path("code").asText());
        assertEquals(after, written(s));

        JsonNode other = view(bruno, brunoOffer);
        ObjectNode decline = coordinates(decline("browser-decline", other, "body-style"), other);
        JsonNode declined = decide(bruno, brunoOffer, decline, 200).path("value");
        receipt(declined, decline, brunoOffer, "declined", "released");
        System.out.println("F466_DECLINE_RECEIPT " + new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode()
                .put("employeeId", BRUNO).set("input", decline.deepCopy().put("offerId", brunoOffer)).toString());
        System.out.println("F466_DECLINED_RECEIPT " + declined);
        assertFalse(declined.has("selection"));
        assertEquals("released", s.text("SELECT state FROM custody_holds WHERE employee_id = ?", BRUNO));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'decline'", brunoOffer));
        assertEquals(declined, decide(bruno, brunoOffer, decline, 200).path("value"));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        s.assertCustodyInvariants(1);
    }

    private static ObjectNode coordinates(ObjectNode body, JsonNode offer) {
        return body.put("runId", offer.path("runId").asText())
                .put("expectedQuoteVersion", offer.path("quote").path("revisions").path("quote").asLong());
    }

    private static void receipt(JsonNode receipt, JsonNode command, String offerId, String state, String holdState) {
        Set<String> keys = new HashSet<>(); receipt.fieldNames().forEachRemaining(keys::add);
        Set<String> required = Set.of("schemaVersion", "runId", "offerId", "commandId", "requestedDecision", "decisionId",
                "state", "reason", "offerState", "holdState", "offerVersion", "holdVersion", "quoteVersion", "quoteId",
                "policyVersion", "expiresAt", "serverNow", "clockVersion", "availableActions", "operationId", "reconciliationRequired");
        assertTrue(keys.containsAll(required), receipt.toPrettyString());
        keys.removeAll(required); keys.remove("selection"); assertTrue(keys.isEmpty(), receipt.toPrettyString());
        assertEquals(command.path("runId"), receipt.path("runId"));
        assertEquals(command.path("commandId"), receipt.path("commandId"));
        assertEquals(command.path("decision"), receipt.path("requestedDecision"));
        assertEquals(offerId, receipt.path("offerId").asText());
        assertEquals(state, receipt.path("state").asText());
        assertEquals(state, receipt.path("offerState").asText());
        assertEquals(holdState, receipt.path("holdState").asText());
        assertEquals(1, receipt.path("quoteVersion").asLong());
        assertFalse(receipt.path("reconciliationRequired").asBoolean());
    }
}
