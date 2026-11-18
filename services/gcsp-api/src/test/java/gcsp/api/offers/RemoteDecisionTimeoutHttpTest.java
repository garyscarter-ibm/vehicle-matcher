package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.bound.OfferDecisionTickHandler;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** A real client timeout leaves an accept pending; the registered presenter tick settles it exactly once. */
@QuarkusTest
@TestProfile(RemoteDecisionJourneyProfiles.Timeout.class)
class RemoteDecisionTimeoutHttpTest extends RemoteDecisionJourneySupport {

    @Test
    void transportTimeoutAcceptSettlesThroughTheRegisteredTickAfterIntentWasCommitted() throws Exception {
        prepareOffer();
        ObjectNode accept = command("remote-accept-timeout", "accept");
        script("APPLY_THEN_STALL", "LOOKUP");
        JsonNode first = post(accept, 202);
        String operation = first.path("operationId").asText();
        assertEquals("pending", first.path("status").asText());
        assertEquals("decision-pending", first.path("code").asText());
        pending(operation, "selection-pending", "unknown");
        JsonNode receipt = originalReceipt("remote-accept-timeout");
        assertEquals(1, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());

        JsonNode beforeIo = beforeIo(operation);
        assertEquals(1, beforeIo.path("intent").asInt(), beforeIo.toString());
        assertTrue(beforeIo.path("receipts").asInt() >= 1, beforeIo.toString());
        assertEquals(0, beforeIo.path("decisions").asInt());
        assertEquals(0, beforeIo.path("orders").asInt());

        String presenter = presenter();
        JsonNode tick = clock().tick(presenter, "remote-timeout-tick-1");
        JsonNode handled = BuddyJourneySupport.outcome(tick, OfferDecisionTickHandler.ID);
        assertEquals("ok", handled.path("status").asText(), handled.toString());
        assertEquals(1, handled.path("value").path("settled").asInt(), handled.toString());
        assertEquals("accepted", view().path("state").asText());
        assertEquals("allocated", text("SELECT state FROM custody_holds"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals(1, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());
        assertTrue(stats(operation).path("gets").asInt() >= 1);

        assertEquals(operation, post(accept, 202).path("operationId").asText());
        assertEquals(receipt, originalReceipt("remote-accept-timeout"));
        JsonNode second = BuddyJourneySupport.outcome(clock().tick(presenter, "remote-timeout-tick-2"), OfferDecisionTickHandler.ID);
        assertEquals(0, second.path("value").path("driven").asInt(), second.toString());
        assertEquals(1, stats(operation).path("posts").asInt());
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
    }
}
