package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.bound.OfferDecisionTickHandler;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** A stale run is refused before any I/O, and a pending decline outlives the offer deadline until confirmed. */
@QuarkusTest
@TestProfile(RemoteDecisionJourneyProfiles.Expiry.class)
class RemoteDecisionExpiryHttpTest extends RemoteDecisionJourneySupport {

    @Test
    void staleRunIsRefusedThenPendingDeclineSurvivesExpiryAndSettlesOnce() throws Exception {
        prepareOffer();
        ObjectNode stale = command("remote-decline-stale", "decline").put("runId", "run-other");
        JsonNode refusal = post(stale, 409);
        assertEquals("stale-run", refusal.path("status").asText(), refusal.toString());
        assertEquals("offer-from-earlier-run", refusal.path("code").asText());
        assertEquals(0, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'offer-decline-release'"));
        control().path("operations").fields().forEachRemaining(e ->
                assertEquals("buddy-claim", e.getValue().path("type").asText(), "only the claim reached the remote"));
        assertEquals("pending", view().path("state").asText());
        assertEquals("active", text("SELECT state FROM custody_holds"));

        ObjectNode decline = command("remote-decline-expiry", "decline");
        script("APPLY_THEN_DROP", "FAIL_500");
        JsonNode first = post(decline, 202);
        String operation = first.path("operationId").asText();
        assertEquals("release-pending", first.path("code").asText());
        pending(operation, "release-pending", "unknown");
        JsonNode receipt = originalReceipt("remote-decline-expiry");
        JsonNode beforeIo = beforeIo(operation);
        assertEquals(1, beforeIo.path("intent").asInt(), beforeIo.toString());
        assertTrue(beforeIo.path("receipts").asInt() >= 1, beforeIo.toString());
        assertEquals(0, beforeIo.path("decisions").asInt());
        assertEquals(0, beforeIo.path("orders").asInt());

        String presenter = presenter();
        BuddyJourneySupport clock = clock();
        Instant expiresAt = Instant.parse(view().path("expiresAt").asText());
        long seconds = Duration.between(Instant.parse(clock.clockNow(presenter)), expiresAt).toSeconds() + 120;
        assertTrue(seconds > 0);
        clock.advance(presenter, seconds);
        JsonNode held = clock.tick(presenter, "remote-expiry-tick-1");
        assertEquals(0, BuddyJourneySupport.outcome(held, OfferDecisionTickHandler.ID).path("value").path("settled").asInt());
        // Expiry ran with the hold past its deadline, but takes only active holds: the pending decision keeps custody.
        JsonNode expiry = BuddyJourneySupport.outcome(held, "buddy-expiry");
        assertEquals("ok", expiry.path("status").asText(), expiry.toString());
        assertEquals(0, expiry.path("value").path("expired").asInt(), expiry.toString());
        assertEquals(1, count("SELECT count(*) FROM custody_holds h JOIN run_clocks r ON r.run_id = h.run_id "
                + "WHERE h.state = 'release-pending' AND h.expires_at < r.clock_instant"));
        pending(operation, "release-pending", "unknown");
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type IN ('buddy-expired', 'offer-declined', 'offer-accepted')"));
        assertEquals(0, count("SELECT count(*) FROM custody_holds WHERE state = 'expired'"));
        assertEquals(1, stats(operation).path("posts").asInt());
        assertTrue(stats(operation).path("gets").asInt() >= 1);

        script(null, "LOOKUP");
        JsonNode settled = clock.tick(presenter, "remote-expiry-tick-2");
        assertEquals(1, BuddyJourneySupport.outcome(settled, OfferDecisionTickHandler.ID).path("value").path("settled").asInt());
        assertEquals("declined", view().path("state").asText());
        assertEquals("released", text("SELECT state FROM custody_holds"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE decision = 'decline'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired'"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());
        assertEquals(operation, post(decline, 202).path("operationId").asText());
        assertEquals(receipt, originalReceipt("remote-decline-expiry"));
    }
}
