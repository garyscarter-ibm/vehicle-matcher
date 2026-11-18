package gcsp.api.remote;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The shared transport against a scripted loopback server: request shape, acknowledgement checks and failures. */
class OperationHttpTransportTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "test-token-not-real";
    private static final OperationHttpTransport.Ids IDS = new OperationHttpTransport.Ids("op-1", "run-1", "order-1");

    private record Seen(String method, String path, String query, Map<String, String> headers, String body) {}

    private record Reply(int status, String body, long delayMillis, long bodyDelayMillis) {
        Reply(int status, String body, long delayMillis) { this(status, body, delayMillis, 0); }
    }

    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private final ArrayDeque<Reply> script = new ArrayDeque<>();
    private HttpServer server;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.createContext("/", exchange -> {
            Map<String, String> headers = new java.util.HashMap<>();
            exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), v.get(0)));
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(),
                    exchange.getRequestURI().getRawQuery(), headers, body));
            Reply r = script.isEmpty() ? new Reply(500, "{}", 0) : script.poll();
            try {
                if (r.delayMillis() > 0) Thread.sleep(r.delayMillis());
                byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(r.status(), out.length == 0 ? -1 : out.length);
                if (out.length > 0) {
                    if (r.bodyDelayMillis() > 0) {
                        exchange.getResponseBody().write(out, 0, 1);
                        exchange.getResponseBody().flush();
                        Thread.sleep(r.bodyDelayMillis());
                        exchange.getResponseBody().write(out, 1, out.length - 1);
                    } else {
                        exchange.getResponseBody().write(out);
                    }
                }
            } catch (InterruptedException | IOException e) {
                // the client gave up
            } finally {
                exchange.close();
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private OperationHttpTransport transport(Optional<String> token, Duration timeout) {
        var s = OperationHttpTransport.Settings.parse("gcsp.test", Optional.of(base() + "/execute"),
                Optional.of(base() + "/reconcile"), token, timeout, true);
        return new OperationHttpTransport(s, OperationHttpTransport.newClient(timeout));
    }

    private OperationHttpTransport transport() {
        return transport(Optional.of(TOKEN), Duration.ofSeconds(2));
    }

    private void reply(int status, String body) {
        script.add(new Reply(status, body, 0));
    }

    private static String ack(String status, String op, String run, String order) {
        return "{\"status\":\"" + status + "\",\"operationId\":\"" + op + "\",\"runId\":\"" + run + "\",\"orderUuid\":\""
                + order + "\"}";
    }

    private String code(OperationHttpTransport t, boolean execute) {
        ObjectNode body = JSON.createObjectNode().put("operationId", "op-1");
        var e = assertThrows(OperationHttpTransport.RemoteOperationException.class,
                () -> {
                    if (execute) t.execute(IDS, body);
                    else t.reconcile(IDS);
                });
        assertEquals(e.code(), e.getMessage(), "the message is only the code");
        return e.code();
    }

    @Test
    void executePostsTheBodyOnceWithIdempotencyKeyAndBearerAndReturnsTheMatchingAck() throws Exception {
        reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\",\"orderUuid\":\"order-1\","
                + "\"providerReference\":\"ref-9\"}");
        ObjectNode body = JSON.createObjectNode().put("operationId", "op-1").put("type", "claim");
        var r = transport().execute(IDS, body);
        assertEquals(new OperationHttpTransport.Reply("confirmed", "op-1", "run-1", "order-1", "ref-9"), r);
        assertEquals(1, seen.size());
        Seen s = seen.get(0);
        assertEquals("POST", s.method());
        assertEquals("/execute", s.path());
        assertNull(s.query());
        assertEquals(body, JSON.readTree(s.body()));
        assertEquals("application/json", s.headers().get("content-type"));
        assertEquals("application/json", s.headers().get("accept"));
        assertEquals("op-1", s.headers().get("idempotency-key"));
        assertEquals("Bearer " + TOKEN, s.headers().get("authorization"));
    }

    @Test
    void reconcileIsAGetWithTheSameIdsEscapedInAFixedOrderAndNoBody() throws Exception {
        var ids = new OperationHttpTransport.Ids("op1&x", "run/1+2", "order 1=%\u00e9");
        reply(200, "{\"status\":\"not-found\",\"operationId\":\"op1&x\",\"runId\":\"run/1+2\",\"orderUuid\":\"order 1=%\u00e9\"}");
        var t = transport();
        assertEquals("not-found", t.reconcile(ids).status());
        Seen s = seen.get(0);
        assertEquals("GET", s.method());
        assertEquals("/reconcile", s.path());
        assertEquals("operationId=op1%26x&runId=run%2F1%2B2&orderUuid=order%201%3D%25%C3%A9", s.query());
        assertEquals("", s.body());
        assertFalse(s.headers().containsKey("idempotency-key"), "a lookup is not a write");
        assertEquals(URI.create(base() + "/reconcile?" + s.query()),
                OperationHttpTransport.reconcileUri(t.settings().reconcileUri(), ids));
    }

    @Test
    void withoutATokenNoAuthorizationHeaderIsSent() throws Exception {
        reply(200, ack("rejected", "op-1", "run-1", "order-1"));
        var r = transport(Optional.empty(), Duration.ofSeconds(2)).reconcile(IDS);
        assertEquals("rejected", r.status());
        assertNull(r.providerReference());
        assertFalse(seen.get(0).headers().containsKey("authorization"));
    }

    @Test
    void eachMismatchedIdIsRefused() {
        var t = transport();
        reply(200, ack("confirmed", "op-2", "run-1", "order-1"));
        reply(200, ack("confirmed", "op-1", "run-2", "order-1"));
        reply(200, ack("confirmed", "op-1", "run-1", "order-2"));
        assertEquals("remote-ack-mismatch", code(t, false));
        assertEquals("remote-ack-mismatch", code(t, false));
        assertEquals("remote-ack-mismatch", code(t, true));
    }

    @Test
    void a404IsNeverAnAuthoritativeNotFoundAndOtherStatusesAreRefused() {
        var t = transport();
        reply(404, ack("not-found", "op-1", "run-1", "order-1"));
        reply(201, ack("confirmed", "op-1", "run-1", "order-1"));
        reply(302, "");
        reply(503, "upstream secret detail");
        assertEquals("remote-http-status", code(t, false));
        assertEquals("remote-http-status", code(t, true));
        assertEquals("remote-http-status", code(t, true));
        assertEquals("remote-http-status", code(t, false));
    }

    @Test
    void malformedAndUnknownAcknowledgementsAreRefused() {
        var t = transport();
        reply(200, "not json");
        reply(200, "[]");
        reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\"}");
        reply(200, "{\"status\":\"confirmed\",\"operationId\":1,\"runId\":\"run-1\",\"orderUuid\":\"order-1\"}");
        reply(200, ack("confirmed", "op-1", "run-1", "order-1") + " {}");
        reply(200, "{\"status\":\"confirmed\",\"status\":\"rejected\",\"operationId\":\"op-1\",\"runId\":\"run-1\","
                + "\"orderUuid\":\"order-1\"}");
        reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\",\"orderUuid\":\"order-1\","
                + "\"providerReference\":7}");
        reply(200, ack("ok", "op-1", "run-1", "order-1"));
        for (int i = 0; i < 7; i++) assertEquals("remote-ack-malformed", code(t, false), "case " + i);
        assertEquals("remote-ack-status-unknown", code(t, false));
    }

    @Test
    void anOversizedBodyIsMalformed() {
        reply(200, "{\"pad\":\"" + "x".repeat(OperationHttpTransport.MAX_BODY) + "\"}");
        assertEquals("remote-ack-malformed", code(transport(), false));
    }

    @Test
    void aSlowAnswerTimesOutAfterOneRequestAndIsNeverRetried() {
        script.add(new Reply(200, ack("confirmed", "op-1", "run-1", "order-1"), 1500));
        var t = transport(Optional.of(TOKEN), Duration.ofMillis(300));
        assertEquals("remote-timeout", code(t, true));
        assertEquals(1, seen.size());
    }

    @Test
    void aStalledBodyTimesOutAfterHeadersAndIsNeverRetried() {
        script.add(new Reply(200, ack("confirmed", "op-1", "run-1", "order-1"), 0, 1500));
        var t = transport(Optional.of(TOKEN), Duration.ofMillis(300));
        long started = System.nanoTime();
        assertEquals("remote-timeout", code(t, true));
        assertTrue(Duration.ofNanos(System.nanoTime() - started).toMillis() < 1200);
        assertEquals(1, seen.size());
    }

    @Test
    void aRefusedConnectionIsATransportFailure() {
        var t = transport();
        server.stop(0);
        assertEquals("remote-transport-failed", code(t, true));
    }

    @Test
    void invalidIdsOrBodyAreRefusedBeforeAnyRequest() {
        var t = transport();
        for (var ids : List.of(new OperationHttpTransport.Ids("", "run-1", "order-1"),
                new OperationHttpTransport.Ids("op 1", "run-1", "order-1"),
                new OperationHttpTransport.Ids("op-1\r\nX: y", "run-1", "order-1"),
                new OperationHttpTransport.Ids("op-1", null, "order-1"),
                new OperationHttpTransport.Ids("op-1", "run-1", " "))) {
            var e = assertThrows(OperationHttpTransport.RemoteOperationException.class,
                    () -> t.execute(ids, JSON.createObjectNode()));
            assertEquals("remote-operation-invalid", e.code());
        }
        var e = assertThrows(OperationHttpTransport.RemoteOperationException.class, () -> t.execute(IDS, JSON.nullNode()));
        assertEquals("remote-operation-invalid", e.code());
        assertTrue(seen.isEmpty());
    }

    @Test
    void settingsNameOnlyTheBadKeysAndNeverShowTheToken() {
        var e = assertThrows(IllegalStateException.class, () -> OperationHttpTransport.Settings.parse("gcsp.test",
                Optional.of("http://example.com/x"), Optional.of("https://user@example.com/y"), Optional.of("bad token"),
                Duration.ZERO, false));
        assertEquals("gcsp.test.provider=remote needs valid settings: gcsp.test.execute-url, gcsp.test.reconcile-url, "
                + "gcsp.test.token, gcsp.test.timeout", e.getMessage());
        assertThrows(IllegalStateException.class, () -> OperationHttpTransport.Settings.parse("gcsp.test",
                Optional.of("https://example.com/x?y=1"), Optional.empty(), Optional.empty(), Duration.ofSeconds(61), false));
        assertThrows(IllegalStateException.class, () -> OperationHttpTransport.Settings.parse("gcsp.test",
                Optional.of("http://127.0.0.1:1/x"), Optional.of("http://127.0.0.1:1/y"), Optional.empty(),
                Duration.ofSeconds(1), false), "plain http to loopback is test-only");
        var ok = OperationHttpTransport.Settings.parse("gcsp.test", Optional.of("https://example.com/x"),
                Optional.of("https://example.com/y"), Optional.of(TOKEN), Duration.ofSeconds(5), false);
        assertFalse(ok.toString().contains(TOKEN));
        assertTrue(ok.toString().contains("token=set"));
    }

    @Test
    void theTransportRefusesAClientThatFollowsRedirects() {
        var s = OperationHttpTransport.Settings.parse("gcsp.test", Optional.of("https://example.com/x"),
                Optional.of("https://example.com/y"), Optional.empty(), Duration.ofSeconds(5), false);
        assertThrows(IllegalArgumentException.class, () -> new OperationHttpTransport(s,
                HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()));
    }
}
