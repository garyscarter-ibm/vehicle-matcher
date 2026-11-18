package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** A generated offer, reviewed reason and selected HTTP remote release remain pending until confirmed. */
@QuarkusTest
@TestProfile(RemoteDecisionJourneyProfiles.Decline.class)
class RemoteDecisionDeclineHttpTest extends RemoteDecisionJourneySupport {

    @Test
    void malformedAndLostDeclineAnswersKeepCustodyUntilOneConfirmedRelease() throws Exception {
        prepareOffer();
        ObjectNode decline = command("remote-decline-uncertain", "decline");
        script("MISMATCH", null);
        JsonNode first = post(decline, 202);
        String operation = first.path("operationId").asText();
        assertFalse(operation.isBlank());
        assertEquals("pending", first.path("status").asText());
        assertEquals("release-pending", first.path("code").asText());
        pending(operation, "release-pending", "unknown");
        JsonNode receipt = originalReceipt("remote-decline-uncertain");
        assertEquals(operation, post(decline, 202).path("operationId").asText());
        ObjectNode conflict = command("remote-decline-conflicting-accept", "accept");
        assertEquals("offer-no-longer-pending", post(conflict, 409).path("code").asText());
        assertEquals(1, stats(operation).path("posts").asInt());

        script(null, "FAIL_500");
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        pending(operation, "release-pending", "unknown");
        script("APPLY_THEN_DROP", "LOOKUP");
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        pending(operation, "release-pending", "unknown");
        assertEquals(1, stats(operation).path("effects").asInt());
        assertEquals(1, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        assertEquals("declined", view().path("state").asText());
        assertEquals("released", text("SELECT state FROM custody_holds"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE decision = 'decline'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals(operation, post(decline, 202).path("operationId").asText());
        assertEquals(receipt, originalReceipt("remote-decline-uncertain"));
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).driven());
        assertEquals(2, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());
    }
}
