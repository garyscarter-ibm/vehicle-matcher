package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** Actual bearer HTTP stays honest while the selected remote refuses, loses and later confirms an accept. */
@QuarkusTest
@TestProfile(RemoteDecisionJourneyProfiles.Accept.class)
class RemoteDecisionAcceptHttpTest extends RemoteDecisionJourneySupport {

    @Test
    void rejectedThenUncertainAcceptKeepsOriginalReceiptsAndConvertsOnlyAfterReconciliation() throws Exception {
        prepareOffer();
        ObjectNode rejected = command("remote-accept-rejected", "accept");
        script("REJECT", null);
        JsonNode rejectedResponse = post(rejected, 202);
        String rejectedOperation = rejectedResponse.path("operationId").asText();
        assertFalse(rejectedOperation.isBlank());
        JsonNode rejectedReceipt = originalReceipt("remote-accept-rejected");
        assertEquals("awaiting-decision", view().path("reason").asText());
        assertEquals("active", text("SELECT state FROM custody_holds"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals(rejectedOperation, post(rejected, 202).path("operationId").asText());
        assertEquals(rejectedReceipt, originalReceipt("remote-accept-rejected"));
        assertEquals(1, stats(rejectedOperation).path("posts").asInt());

        ObjectNode accept = command("remote-accept-uncertain", "accept");
        script("MISMATCH", null);
        JsonNode first = post(accept, 202);
        String operation = first.path("operationId").asText();
        assertNotEquals(rejectedOperation, operation);
        assertEquals("pending", first.path("status").asText());
        assertEquals("decision-pending", first.path("code").asText());
        assertFalse(first.has("decisionId"), "the initial browser command has no generated decision identity");
        pending(operation, "selection-pending", "unknown");
        JsonNode receipt = originalReceipt("remote-accept-uncertain");
        assertEquals(operation, post(accept, 202).path("operationId").asText());
        ObjectNode changed = accept.deepCopy().put("expectedReturnMileage", 5500);
        assertEquals("command-input-changed", post(changed, 409).path("code").asText());
        ObjectNode conflict = command("remote-accept-conflicting-decline", "decline");
        assertEquals("offer-no-longer-pending", post(conflict, 409).path("code").asText());
        assertEquals(1, stats(operation).path("posts").asInt());

        script(null, "MISMATCH");
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        pending(operation, "selection-pending", "unknown");
        script("APPLY_THEN_DROP", "LOOKUP");
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        pending(operation, "selection-pending", "unknown");
        assertEquals(2, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());
        assertEquals(1, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).settled());
        assertEquals("accepted", view().path("state").asText());
        assertEquals("allocated", text("SELECT state FROM custody_holds"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept'"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals(operation, post(accept, 202).path("operationId").asText());
        assertEquals(receipt, originalReceipt("remote-accept-uncertain"));
        assertEquals(0, decisions.reconcileRemote(OffersPg.ENV, "run-1", 100).driven());
        assertEquals(2, stats(operation).path("posts").asInt());
        assertEquals(1, stats(operation).path("effects").asInt());
        assertTrue(stats(operation).path("gets").asInt() >= 3);
    }
}
