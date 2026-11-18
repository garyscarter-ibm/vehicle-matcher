package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * The refused half: a rejecting provider through the started dev composition (real RS256 tokens, a private schema,
 * demo-prepared Paula, the real HttpOrderingProvider aimed at a loopback endpoint) leaves one refused order and no effect.
 */
@QuarkusTest
@TestProfile(OrderingRemoteJourneyProfile.Refused.class)
class OrderingRemoteRefusedHttpTest extends OrderingRemoteJourneySupport {

    @Test
    void aRejectedHandoffIsRefusedWithoutAReferenceOrAnEffect() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        assertRemoteComposition();
        assertEquals(0, stats().get("executes").asInt());
        seedStock();

        // Refused: paula's order is rejected, so nothing is made at the provider and nothing is confirmed.
        ObjectNode paulaBody = prepare("paula");
        mode("reject");
        Response rejected = submit("paula", paulaBody);
        JsonNode refused = view(rejected, 200);
        assertEquals("ok", body(rejected).get("status").asText());
        assertEquals("refused", refused.get("status").asText());
        assertEquals("handoff-failed", refused.get("view").get("state").asText());
        assertEquals("contact-support", refused.get("view").get("action").asText());
        assertEquals("remote-ordering-rejected", refused.get("failure").get("reason").asText());
        assertFalse(refused.has("providerReference"), "a refused handoff carries no provider reference");
        String refusedOp = refused.get("operationId").asText();
        assertEquals(refusedOp, operationOf("paula"));
        assertEquals("refused", stateOf(refusedOp));
        assertEquals(1, ops("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order' "
                + "AND operation_id = ? AND provider_reference IS NULL", refusedOp));
        assertEquals(1, ops("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-refused' "
                + "AND payload->>'operationId' = ?", refusedOp));
        assertEquals(0, ops("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged' "
                + "AND payload->>'operationId' = ?", refusedOp));
        assertEquals("remote-ordering-rejected", text("SELECT outcome->>'reason' FROM pending_operations "
                + "WHERE operation_id = ?", refusedOp));
        JsonNode s = stats();
        assertEquals(1, s.get("executes").asInt());
        assertEquals(0, s.get("effects").asInt());
        Response paulaRead = employee("paula").get(ORDER);
        assertEquals("refused", view(paulaRead, 200).get("status").asText());
        assertEquals("handoff-failed", body(paulaRead).get("value").get("view").get("state").asText());
        // A repeat of the refused command replays the refusal and asks the provider for nothing more.
        JsonNode again = view(submit("paula", paulaBody), 200);
        assertEquals("refused", again.get("status").asText());
        assertTrue(again.get("replayed").asBoolean());
        assertEquals(1, stats().get("executes").asInt());
        assertEquals(0, stats().get("effects").asInt());
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
        // A different command for the same slot is not a second order either.
        ObjectNode other = paulaBody.deepCopy();
        other.put("commandId", "cmd-other-" + id());
        other.put("expectedStockVersion", paulaBody.get("expectedStockVersion").asLong() + 1);
        Response second = submit("paula", other);
        assertEquals(409, second.statusCode(), second.asString());
        assertEquals("active-selection-exists", body(second).get("code").asText());
        // The presenter sweep leaves a settled refusal alone.
        Response sweep = as("sub-presenter", "presenter").post(BASE + "/presenter/ordering/reconcile");
        assertEquals(200, sweep.statusCode(), sweep.asString());
        assertEquals(0, body(sweep).get("value").get("examined").asInt());
        assertEquals(1, stats().get("executes").asInt());
        assertEquals(0, stats().get("effects").asInt());
        assertEquals("refused", stateOf(refusedOp));
    }
}
