package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** A refused release is unresolved custody, never an invented successful decline or available car. */
@QuarkusTest
@TestProfile(RemoteDecisionJourneyProfiles.RejectedDecline.class)
class RemoteDecisionRejectedDeclineHttpTest extends RemoteDecisionJourneySupport {

    @Test
    void rejectedReleaseRemainsPendingThroughOwnerHttpReadAndReconcile() throws Exception {
        prepareOffer();
        ObjectNode decline = command("remote-decline-rejected", "decline");
        script("REJECT", null);
        JsonNode first = post(decline, 202);
        String operation = first.path("operationId").asText();
        pending(operation, "release-pending", "rejected");
        JsonNode receipt = originalReceipt("remote-decline-rejected");
        assertEquals(operation, post(decline, 202).path("operationId").asText());
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        pending(operation, "release-pending", "rejected");
        assertEquals(receipt, originalReceipt("remote-decline-rejected"));
        assertEquals(1, stats(operation).path("posts").asInt());
        assertEquals(0, stats(operation).path("effects").asInt());
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type IN ('offer-accepted','offer-declined')"));
    }
}
