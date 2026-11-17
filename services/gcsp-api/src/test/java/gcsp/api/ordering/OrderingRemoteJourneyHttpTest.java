package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.remote.OperationHttpTransport;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * Lost acknowledgement, repeated command and restart through the started dev composition with the real
 * HttpOrderingProvider aimed at a loopback endpoint. Paula loses her acknowledgement; Jordan's handoff outlives a restart.
 */
@QuarkusTest
@TestProfile(OrderingRemoteJourneyProfile.Lost.class)
class OrderingRemoteJourneyHttpTest extends OrderingRemoteJourneySupport {

    @Test
    void lostAcknowledgementRepeatedCommandAndRestartMakeOneOrderEachOverTheRemoteProvider() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        assertRemoteComposition();
        assertEquals(0, stats().get("executes").asInt());
        seedStock();

        // Lost acknowledgement: paula's execute is recorded at the provider but never answered.
        ObjectNode paulaBody = prepare("paula");
        mode("drop-ack");
        Response lost = submit("paula", paulaBody);
        JsonNode pending = view(lost, 202);
        assertEquals("pending", body(lost).get("status").asText());
        assertEquals("handoff-pending", body(lost).get("code").asText());
        assertEquals("pending", pending.get("status").asText());
        assertEquals("handoff-pending", pending.get("view").get("state").asText());
        assertEquals("check-status", pending.get("view").get("action").asText());
        assertFalse(pending.has("providerReference"), "no confirmation is made up");
        String paulaOp = pending.get("operationId").asText();
        assertEquals(paulaOp, operationOf("paula"));
        assertEquals("pending", stateOf(paulaOp));
        assertEquals(1, ops("SELECT count(*) FROM pending_operations WHERE operation_id = ? AND provider_reference IS NULL", paulaOp));
        JsonNode s = stats();
        assertEquals(1, s.get("executes").asInt());
        assertEquals(1, s.get("effects").asInt());
        assertTrue(s.get("operations").toString().contains(paulaOp));

        // Repeated command while pending: same operation, still pending, no second execute.
        Response repeat = submit("paula", paulaBody);
        assertEquals(paulaOp, view(repeat, 202).get("operationId").asText());
        assertEquals("handoff-pending", body(repeat).get("value").get("view").get("state").asText());
        ObjectNode changed = paulaBody.deepCopy();
        changed.put("commandId", "cmd-changed-" + id());
        changed.put("expectedStockVersion", paulaBody.get("expectedStockVersion").asLong() + 1);
        Response conflict = submit("paula", changed);
        assertEquals(409, conflict.statusCode(), conflict.asString());
        assertEquals("active-selection-exists", body(conflict).get("code").asText());
        assertEquals(1, stats().get("executes").asInt());

        // The lookup is hidden: after the retry lease the provider is asked again, answers unknown, nothing is made up.
        mode("hide");
        int before = stats().get("reconciles").asInt();
        assertTrue(until(Duration.ofSeconds(15), () -> {
            try {
                Response r = employee("paula").get(ORDER);
                assertEquals(202, r.statusCode(), r.asString());
                assertEquals("pending", body(r).get("value").get("status").asText());
                assertFalse(body(r).get("value").has("providerReference"));
                return stats().get("reconciles").asInt() > before;
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }), "the retry lease never allowed another lookup");
        assertEquals("pending", stateOf(paulaOp));
        assertEquals(1, stats().get("executes").asInt());
        assertEquals(1, stats().get("effects").asInt());

        // The effect becomes visible: the next read settles to acknowledged with the recorded reference.
        mode("confirm");
        assertTrue(until(Duration.ofSeconds(15), () -> {
            try {
                return employee("paula").get(ORDER).statusCode() == 200;
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }), "paula's handoff never settled");
        String recorded = LoopbackOrderingResource.REFERENCE_PREFIX + paulaOp;
        assertEquals(recorded, stats().get("references").get(paulaOp).asText());
        JsonNode settled = view(employee("paula").get(ORDER), 200);
        assertEquals("acknowledged", settled.get("status").asText());
        assertEquals(recorded, settled.get("providerReference").asText());
        assertEquals("awaiting-approval", settled.get("view").get("state").asText());
        assertEquals("acknowledged", stateOf(paulaOp));
        assertEquals(recorded, text("SELECT provider_reference FROM pending_operations WHERE operation_id = ?", paulaOp));
        assertEquals(1, stats().get("executes").asInt());
        assertEquals(1, stats().get("effects").asInt());
        assertEquals(0, stats().get("duplicates").asInt());

        // Repeated command after settling: same reference, replayed. A changed body is refused.
        Response replay = submit("paula", paulaBody);
        JsonNode replayed = view(replay, 200);
        assertEquals(paulaOp, replayed.get("operationId").asText());
        assertEquals(recorded, replayed.get("providerReference").asText());
        assertTrue(replayed.get("replayed").asBoolean());
        ObjectNode freshCommand = paulaBody.deepCopy();
        freshCommand.put("commandId", "cmd-fresh-" + id());
        JsonNode sameIntent = view(submit("paula", freshCommand), 200);
        assertEquals(paulaOp, sameIntent.get("operationId").asText());
        assertEquals(recorded, sameIntent.get("providerReference").asText());
        Response second = submit("paula", changed);
        assertEquals(409, second.statusCode(), second.asString());
        assertEquals("active-selection-exists", body(second).get("code").asText());
        assertEquals(1, stats().get("executes").asInt());
        assertEquals(1, stats().get("effects").asInt());

        // Restart: jordan's acknowledgement is lost; the startup pass and a fresh service reconcile without a second order.
        ObjectNode jordanBody = prepare("jordan");
        mode("drop-ack");
        JsonNode jordanPending = view(submit("jordan", jordanBody), 202);
        assertEquals("handoff-pending", jordanPending.get("view").get("state").asText());
        String jordanOp = jordanPending.get("operationId").asText();
        assertEquals(2, stats().get("executes").asInt());
        assertEquals(2, stats().get("effects").asInt());
        mode("hide");

        int examined = 0;
        int lookups = stats().get("reconciles").asInt();
        long end = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (examined == 0 && System.nanoTime() < end) {
            examined = startup.reconcileOnce();
            if (examined == 0) Thread.sleep(250);
        }
        assertEquals(1, examined, "the startup pass drives only jordan's open handoff");
        assertTrue(stats().get("reconciles").asInt() > lookups);
        assertEquals("pending", stateOf(jordanOp));
        assertEquals(2, stats().get("executes").asInt());

        var settings = OperationHttpTransport.Settings.parse("gcsp.ordering", Optional.of(executeUrl), Optional.of(reconcileUrl),
                Optional.empty(), Duration.ofSeconds(2), true);
        var client = OperationHttpTransport.newClient(Duration.ofSeconds(2));
        PGSimpleDataSource pool = new PGSimpleDataSource();
        pool.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        pool.setCurrentSchema(schema);
        try {
            // A new service, provider and connection source over the same schema: what a restarted process builds.
            OrderingService restarted = new OrderingService(pool, new OrderingTerms(policy, clock),
                    new HttpOrderingProvider(settings, client), Duration.ofSeconds(30), Duration.ofSeconds(5), Instant::now);
            var run = persistence.guard().currentRun();
            RunContext ctx = new RunContext(run.environmentId(), run.runId(), "restart-proof");
            int[] seen = {0, 0};
            assertTrue(until(Duration.ofSeconds(15), () -> {
                JsonNode v = assertInstanceOf(OrderingResult.Ok.class, restarted.reconcileOpen(ctx, 10)).value();
                seen[0] = v.get("examined").asInt();
                seen[1] = v.get("settled").asInt();
                return seen[0] > 0;
            }), "the restarted service never got the lease");
            assertEquals(1, seen[0]);
            assertEquals(0, seen[1], "a hidden effect settles nothing");
            assertEquals("pending", stateOf(jordanOp));
            assertEquals(2, stats().get("executes").asInt());

            mode("confirm");
            assertTrue(until(Duration.ofSeconds(15), () -> {
                JsonNode v = assertInstanceOf(OrderingResult.Ok.class, restarted.reconcileOpen(ctx, 10)).value();
                return v.get("settled").asInt() == 1;
            }), "the restarted service never settled jordan's handoff");
        } finally {
            client.shutdownNow();
        }
        String jordanRef = LoopbackOrderingResource.REFERENCE_PREFIX + jordanOp;
        assertEquals("acknowledged", stateOf(jordanOp));
        assertEquals(jordanRef, text("SELECT provider_reference FROM pending_operations WHERE operation_id = ?", jordanOp));
        JsonNode jordanRead = view(employee("jordan").get(ORDER), 200);
        assertEquals("acknowledged", jordanRead.get("status").asText());
        assertEquals(jordanRef, jordanRead.get("providerReference").asText());
        assertEquals(0, startup.reconcileOnce(), "nothing is left open for another startup pass");
        assertEquals(2, stats().get("executes").asInt());
        assertEquals(2, stats().get("effects").asInt());

        // Durable counts: one intent and one selection per operation, one outcome event each, effects = acknowledged.
        assertEquals(2, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
        assertEquals(2, count("SELECT count(*) FROM selection_orders"));
        for (String op : List.of(paulaOp, jordanOp)) {
            assertEquals(1, ops("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order' "
                    + "AND operation_id = ?", op));
            assertEquals(1, ops("SELECT count(*) FROM selection_orders WHERE operation_id = ?", op));
            assertEquals(1, ops("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-received' "
                    + "AND payload->>'operationId' = ?", op));
        }
        for (String op : List.of(paulaOp, jordanOp)) {
            assertEquals(1, ops("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged' "
                    + "AND payload->>'operationId' = ?", op));
            assertEquals(0, ops("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-refused' "
                    + "AND payload->>'operationId' = ?", op));
        }
        assertEquals(2, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
        assertEquals(0, count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-refused'"));
        assertEquals(2, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order' "
                + "AND state = 'acknowledged'"));
        JsonNode end2 = stats();
        assertEquals(2, end2.get("effects").asInt());
        assertEquals(0, end2.get("duplicates").asInt());
        assertEquals(List.of(paulaOp, jordanOp), List.of(end2.get("operations").get(0).asText(), end2.get("operations").get(1).asText()));
    }
}
