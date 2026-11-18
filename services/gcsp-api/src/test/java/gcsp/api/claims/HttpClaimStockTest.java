package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.claims.ClaimStockPort.Ack;
import gcsp.api.claims.ClaimStockPort.Confirmed;
import gcsp.api.claims.ClaimStockPort.NotFound;
import gcsp.api.claims.ClaimStockPort.Operation;
import gcsp.api.claims.ClaimStockPort.Rejected;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.RemoteOperationException;
import gcsp.api.remote.OperationHttpTransport.Settings;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** HttpClaimStock against an in-process loopback stub: the body, the ack mapping and every failure code. */
class HttpClaimStockTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "test-token-not-real";
    private static final String UPSTREAM = "upstream-secret-detail";

    record Seen(String method, String path, String rawQuery, Map<String, String> headers, String body) {}

    record Scripted(int status, String body, long delayMillis) {}

    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private final List<Scripted> script = new ArrayList<>();
    private HttpServer server;
    private String base;

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", exchange -> {
            Map<String, String> headers = new HashMap<>();
            exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), v.get(0)));
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                    exchange.getRequestURI().getRawQuery(), headers, body));
            Scripted r = script.get(Math.min(seen.size(), script.size()) - 1);
            try {
                if (r.delayMillis() > 0) Thread.sleep(r.delayMillis());
                byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(r.status(), out.length == 0 ? -1 : out.length);
                if (out.length > 0) exchange.getResponseBody().write(out);
            } catch (InterruptedException | IOException e) {
                // A client that timed out has gone away.
            } finally {
                exchange.close();
            }
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private void reply(int status, String body) {
        script.add(new Scripted(status, body, 0));
    }

    private static String ack(String status, Operation op, String reference) {
        return "{\"status\":\"" + status + "\",\"operationId\":\"" + op.operationId() + "\",\"runId\":\"" + op.runId()
                + "\",\"orderUuid\":\"" + op.orderUuid() + "\""
                + (reference == null ? "" : ",\"providerReference\":\"" + reference + "\"") + "}";
    }

    private HttpClaimStock stock(Optional<String> token, Duration timeout) {
        Settings settings = Settings.parse("gcsp.claims.stock", Optional.of(base + "/execute"),
                Optional.of(base + "/reconcile"), token, timeout, true);
        return new HttpClaimStock(new OperationHttpTransport(settings, OperationHttpTransport.newClient(timeout)));
    }

    private HttpClaimStock stock() {
        return stock(Optional.empty(), Duration.ofSeconds(2));
    }

    private static Operation op() throws IOException {
        return op("op-1", "run-1", "order-1", JSON.readTree("{\"slot\":\"s1\",\"price\":12.5}"),
                Instant.parse("2026-11-17T10:15:30Z"));
    }

    private static Operation op(String id, String run, String order, JsonNode quote, Instant expires) {
        return new Operation(id, "claim", "hold-1", order, "emp-1", "slot-1", expires, "stock-a", "demo-reason", run,
                quote);
    }

    private static String code(Operation op, Throwing call) {
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> call.run(op));
        assertEquals(e.code(), e.getMessage());
        return e.code();
    }

    private interface Throwing {

        Ack run(Operation op) throws Exception;
    }

    @Test
    void executePostsEveryFieldAndMapsConfirmedWithItsReference() throws Exception {
        Operation op = op();
        reply(200, ack("confirmed", op, "ref-77"));

        Ack ack = stock().execute(op);

        assertEquals(new Confirmed("op-1", "run-1", "order-1", "ref-77"), ack);
        assertEquals(1, seen.size());
        Seen s = seen.get(0);
        assertEquals("POST", s.method());
        assertEquals("/execute", s.path());
        assertNull(s.rawQuery());
        assertEquals("application/json", s.headers().get("content-type"));
        assertEquals("application/json", s.headers().get("accept"));
        assertEquals("op-1", s.headers().get("idempotency-key"));
        JsonNode body = JSON.readTree(s.body());
        assertEquals(11, body.size());
        assertEquals("op-1", body.get("operationId").asText());
        assertEquals("claim", body.get("type").asText());
        assertEquals("hold-1", body.get("holdId").asText());
        assertEquals("order-1", body.get("orderUuid").asText());
        assertEquals("emp-1", body.get("employeeId").asText());
        assertEquals("slot-1", body.get("slotId").asText());
        assertEquals("2026-11-17T10:15:30Z", body.get("expiresAt").asText());
        assertEquals("stock-a", body.get("target").asText());
        assertEquals("demo-reason", body.get("reason").asText());
        assertEquals("run-1", body.get("runId").asText());
        assertEquals(op.quote(), body.get("quote"));
    }

    @Test
    void rejectedAndNotFoundRepliesMapToTheirAcks() throws Exception {
        Operation op = op();
        reply(200, ack("rejected", op, null));
        reply(200, ack("not-found", op, null));

        assertEquals(new Rejected("op-1", "run-1", "order-1"), stock().execute(op));
        assertEquals(new NotFound("op-1", "run-1", "order-1"), stock().execute(op));
    }

    @Test
    void confirmedWithoutAReferenceHasANullReference() throws Exception {
        Operation op = op();
        reply(200, ack("confirmed", op, null));

        Confirmed confirmed = assertInstanceOf(Confirmed.class, stock().execute(op));

        assertNull(confirmed.providerReference());
    }

    @Test
    void nullQuoteAndNullExpiryAreSentAsJsonNullAndModeIsRemote() throws Exception {
        Operation op = op("op-1", "run-1", "order-1", null, null);
        reply(200, ack("confirmed", op, null));
        HttpClaimStock stock = stock();

        stock.execute(op);

        JsonNode body = JSON.readTree(seen.get(0).body());
        assertTrue(body.has("quote") && body.get("quote").isNull());
        assertTrue(body.has("expiresAt") && body.get("expiresAt").isNull());
        assertEquals(ClaimStockPort.Mode.REMOTE, stock.mode());
    }

    @Test
    void nullStringFieldsAreSentAsJsonNull() throws Exception {
        Operation op = new Operation("op-1", "claim", null, "order-1", null, null, null, null, null, "run-1", null);
        reply(200, ack("confirmed", op, null));

        stock().execute(op);

        JsonNode body = JSON.readTree(seen.get(0).body());
        for (String field : List.of("holdId", "employeeId", "slotId", "target", "reason")) {
            assertTrue(body.has(field) && body.get(field).isNull(), field);
        }
    }

    @Test
    void reconcileGetsTheEscapedQueryAndNeverPosts() throws Exception {
        Operation op = op("op&1/a", "run+2", "ord=3%", null, null);
        reply(200, ack("not-found", op, null));

        Ack ack = stock().reconcile(op);

        assertEquals(new NotFound("op&1/a", "run+2", "ord=3%"), ack);
        assertEquals(1, seen.size());
        Seen s = seen.get(0);
        assertEquals("GET", s.method());
        assertEquals("/reconcile", s.path());
        assertEquals("operationId=op%261%2Fa&runId=run%2B2&orderUuid=ord%3D3%25", s.rawQuery());
        assertEquals("", s.body());
        assertFalse(s.headers().containsKey("content-type"));
    }

    @Test
    void anIdWithASpaceIsRefusedBeforeAnyRequest() throws Exception {
        Operation op = op("op 1", "run-1", "order-1", null, null);

        assertEquals("remote-operation-invalid", code(op, stock()::execute));
        assertEquals("remote-operation-invalid", code(op, stock()::reconcile));
        assertTrue(seen.isEmpty());
    }

    @Test
    void aNullOperationIsInvalidAndSendsNothing() {
        assertEquals("remote-operation-invalid", code(null, stock()::execute));
        assertEquals("remote-operation-invalid", code(null, stock()::reconcile));
        assertTrue(seen.isEmpty());
    }

    @Test
    void aNullTransportIsRejected() {
        assertThrows(NullPointerException.class, () -> new HttpClaimStock(null));
    }

    @Test
    void aReplyForAnotherOperationRunOrOrderIsAMismatch() throws Exception {
        Operation op = op();
        reply(200, ack("confirmed", op("other", "run-1", "order-1", null, null), "r"));
        reply(200, ack("confirmed", op("op-1", "other", "order-1", null, null), "r"));
        reply(200, ack("confirmed", op("op-1", "run-1", "other", null, null), "r"));

        for (int i = 0; i < 3; i++) {
            assertEquals("remote-ack-mismatch", code(op, stock()::execute));
        }
        reply(200, ack("not-found", op("other", "run-1", "order-1", null, null), null));
        assertEquals("remote-ack-mismatch", code(op, stock()::reconcile));
    }

    @Test
    void aNon200StatusIsNeverAnAckEvenWithAValidNotFoundBody() throws Exception {
        Operation op = op();
        reply(404, ack("not-found", op, null));
        reply(500, "{\"detail\":\"" + UPSTREAM + "\"}");

        assertEquals("remote-http-status", code(op, stock()::reconcile));
        assertEquals("remote-http-status", code(op, stock()::execute));
    }

    @Test
    void malformedRepliesAreMalformedAndAnUnknownStatusIsNamed() throws Exception {
        Operation op = op();
        reply(200, "{not json");
        reply(200, "[]");
        reply(200, "\"confirmed\"");
        reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\"}");
        reply(200, ack("ok", op, null));

        for (int i = 0; i < 4; i++) {
            assertEquals("remote-ack-malformed", code(op, stock()::execute), "reply " + i);
        }
        assertEquals("remote-ack-status-unknown", code(op, stock()::execute));
    }

    @Test
    void aReplyBeyondTheTimeoutIsATimeoutAfterExactlyOneRequest() throws Exception {
        Operation op = op();
        script.add(new Scripted(200, ack("confirmed", op, "r"), 1500));

        assertEquals("remote-timeout", code(op, stock(Optional.empty(), Duration.ofMillis(300))::execute));
        assertEquals(1, seen.size());
    }

    @Test
    void theTokenGoesOutAsABearerHeaderOnlyWhenSet() throws Exception {
        Operation op = op();
        reply(200, ack("confirmed", op, null));
        reply(200, ack("not-found", op, null));
        reply(200, ack("confirmed", op, null));

        stock(Optional.of(TOKEN), Duration.ofSeconds(2)).execute(op);
        stock(Optional.of(TOKEN), Duration.ofSeconds(2)).reconcile(op);
        stock().execute(op);

        assertEquals("Bearer " + TOKEN, seen.get(0).headers().get("authorization"));
        assertEquals("Bearer " + TOKEN, seen.get(1).headers().get("authorization"));
        assertFalse(seen.get(2).headers().containsKey("authorization"));
    }

    @Test
    void failureMessagesNeverCarryTheTokenOrTheUpstreamBody() throws Exception {
        Operation op = op();
        reply(500, "{\"detail\":\"" + UPSTREAM + " " + TOKEN + "\"}");
        reply(200, "{\"status\":\"" + UPSTREAM + "\"}");

        for (int i = 0; i < 2; i++) {
            RemoteOperationException e = assertThrows(RemoteOperationException.class,
                    () -> stock(Optional.of(TOKEN), Duration.ofSeconds(2)).execute(op));
            assertFalse(e.getMessage().contains(TOKEN));
            assertFalse(e.getMessage().contains(UPSTREAM));
            assertFalse(e.toString().contains(TOKEN));
            assertFalse(e.toString().contains(UPSTREAM));
        }
    }
}
