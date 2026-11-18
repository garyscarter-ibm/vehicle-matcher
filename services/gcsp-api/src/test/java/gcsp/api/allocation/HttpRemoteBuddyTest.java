package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.allocation.RemoteBuddy.Ack;
import gcsp.api.allocation.RemoteBuddy.RemoteOperation;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.RemoteOperationException;
import gcsp.api.remote.OperationHttpTransport.Settings;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** HttpRemoteBuddy against a loopback stub: field mapping, ack mapping, and that every failure is a coded exception. */
class HttpRemoteBuddyTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "test-token-not-real";
    private static final String UPSTREAM = "upstream-body-must-not-leak";

    record Seen(String method, String path, String rawQuery, Map<String, String> headers, String body) {}

    record Scripted(int status, String body, long delayMillis, String location) {}

    private static Scripted reply(int status, String body) {
        return new Scripted(status, body, 0, null);
    }

    private static String ack(String status, String op, String run, String order) {
        return "{\"status\":\"" + status + "\",\"operationId\":\"" + op + "\",\"runId\":\"" + run + "\",\"orderUuid\":\""
                + order + "\"}";
    }

    private static String ok(String status) {
        return ack(status, "op-1", "run-1", "ord-1");
    }

    /** Replies in order, repeating the last; records every request. */
    static final class Stub implements AutoCloseable {
        final List<Seen> seen = new CopyOnWriteArrayList<>();
        final List<Scripted> script = new CopyOnWriteArrayList<>();
        private final HttpServer server;

        Stub() throws IOException {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            server.createContext("/", exchange -> {
                Map<String, String> headers = new HashMap<>();
                exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), v.get(0)));
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getPath(),
                        exchange.getRequestURI().getRawQuery(), headers, body));
                Scripted r = script.isEmpty() ? reply(500, "{}") : script.get(Math.min(seen.size(), script.size()) - 1);
                try {
                    if (r.delayMillis() > 0) Thread.sleep(r.delayMillis());
                    if (r.location() != null) exchange.getResponseHeaders().add("Location", r.location());
                    byte[] out = r.body().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(r.status(), out.length == 0 ? -1 : out.length);
                    if (out.length > 0) exchange.getResponseBody().write(out);
                } catch (InterruptedException | IOException e) {
                    // The client timed out and went away.
                } finally {
                    exchange.close();
                }
            });
            server.start();
        }

        Stub then(Scripted r) {
            script.add(r);
            return this;
        }

        String url() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    private final List<Stub> stubs = new CopyOnWriteArrayList<>();

    @AfterEach
    void closeStubs() {
        stubs.forEach(Stub::close);
    }

    private Stub stub() throws IOException {
        Stub s = new Stub();
        stubs.add(s);
        return s;
    }

    private static HttpRemoteBuddy buddy(String baseUrl, Optional<String> token, Duration timeout) {
        Settings settings = Settings.parse("gcsp.buddy", Optional.of(baseUrl + "/execute"),
                Optional.of(baseUrl + "/reconcile"), token, timeout, true);
        return new HttpRemoteBuddy(new OperationHttpTransport(settings, OperationHttpTransport.newClient(timeout)));
    }

    private static HttpRemoteBuddy buddy(Stub stub) {
        return buddy(stub.url(), Optional.empty(), Duration.ofSeconds(2));
    }

    private static RemoteOperation op() throws IOException {
        JsonNode payload = JSON.readTree("{\"vin\":\"X1\",\"slots\":[1,2],\"nested\":{\"a\":true}}");
        return new RemoteOperation("op-1", "CLAIM", "run-1", "hold-1", "ord-1", "emp-1", payload, 2);
    }

    private static RemoteOperation withIds(String op, String run, String order) {
        return new RemoteOperation(op, "CLAIM", run, "hold-1", order, "emp-1", null, 0);
    }

    private static String code(RemoteOperationException e) {
        assertEquals(e.code(), e.getMessage());
        return e.code();
    }

    @Test
    void executePostsEveryFieldAndMapsConfirmed() throws Exception {
        Stub s = stub().then(reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\","
                + "\"orderUuid\":\"ord-1\",\"providerReference\":\"ref-9\"}"));
        Ack ack = buddy(s).execute(op());

        assertEquals(new Ack("confirmed", "op-1", "run-1", "ord-1"), ack);
        assertEquals(1, s.seen.size());
        Seen req = s.seen.get(0);
        assertEquals("POST", req.method());
        assertEquals("/execute", req.path());
        assertEquals("application/json", req.headers().get("content-type"));
        assertEquals("application/json", req.headers().get("accept"));
        assertEquals("op-1", req.headers().get("idempotency-key"));
        JsonNode body = JSON.readTree(req.body());
        assertEquals("op-1", body.get("operationId").textValue());
        assertEquals("CLAIM", body.get("operationType").textValue());
        assertEquals("run-1", body.get("runId").textValue());
        assertEquals("hold-1", body.get("holdId").textValue());
        assertEquals("ord-1", body.get("orderUuid").textValue());
        assertEquals("emp-1", body.get("employeeId").textValue());
        assertEquals(op().payload(), body.get("payload"));
        assertTrue(body.get("attempts").isInt());
        assertEquals(2, body.get("attempts").intValue());
        assertEquals(8, body.size());
    }

    @Test
    void rejectedReplyGivesRejectedAck() throws Exception {
        Stub s = stub().then(reply(200, ok("rejected")));
        assertEquals(new Ack("rejected", "op-1", "run-1", "ord-1"), buddy(s).execute(op()));
    }

    @Test
    void notFoundReplyGivesNotFoundAck() throws Exception {
        Stub s = stub().then(reply(200, ok("not-found")));
        assertEquals(new Ack("not-found", "op-1", "run-1", "ord-1"), buddy(s).execute(op()));
    }

    @Test
    void reconcileGetsExactEscapedQueryAndNeverPosts() throws Exception {
        Stub s = stub().then(reply(200, ack("not-found", "op&1/x", "run+2#?", "ord%3")));
        Ack ack = buddy(s).reconcile(withIds("op&1/x", "run+2#?", "ord%3"));

        assertEquals(new Ack("not-found", "op&1/x", "run+2#?", "ord%3"), ack);
        assertEquals(1, s.seen.size());
        Seen req = s.seen.get(0);
        assertEquals("GET", req.method());
        assertEquals("/reconcile", req.path());
        assertEquals("operationId=op%261%2Fx&runId=run%2B2%23%3F&orderUuid=ord%253", req.rawQuery());
        assertEquals("", req.body());
        assertFalse(req.headers().containsKey("idempotency-key"));
        assertEquals("application/json", req.headers().get("accept"));
    }

    @Test
    void reconcileMapsConfirmedAndRejected() throws Exception {
        Stub s = stub().then(reply(200, ok("confirmed"))).then(reply(200, ok("rejected")));
        HttpRemoteBuddy buddy = buddy(s);
        assertEquals("confirmed", buddy.reconcile(op()).status());
        assertEquals("rejected", buddy.reconcile(op()).status());
        assertTrue(s.seen.stream().allMatch(r -> r.method().equals("GET") && r.path().equals("/reconcile")));
    }

    @Test
    void anyMismatchedIdIsAckMismatchForExecuteAndReconcile() throws Exception {
        String[] replies = {ack("confirmed", "op-X", "run-1", "ord-1"), ack("confirmed", "op-1", "run-X", "ord-1"),
                ack("confirmed", "op-1", "run-1", "ord-X")};
        for (String reply : replies) {
            Stub s = stub().then(reply(200, reply));
            HttpRemoteBuddy buddy = buddy(s);
            assertEquals("remote-ack-mismatch", code(assertThrows(RemoteOperationException.class, () -> buddy.execute(op()))));
            assertEquals("remote-ack-mismatch", code(assertThrows(RemoteOperationException.class, () -> buddy.reconcile(op()))));
        }
    }

    @Test
    void http404WithValidNotFoundBodyIsStatusErrorNotAnAck() throws Exception {
        Stub s = stub().then(reply(404, ok("not-found")));
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> buddy(s).reconcile(op()));
        assertEquals("remote-http-status", code(e));
    }

    @Test
    void http503IsStatusErrorAndLeaksNothing() throws Exception {
        Stub s = stub().then(reply(503, UPSTREAM));
        RemoteOperationException e = assertThrows(RemoteOperationException.class,
                () -> buddy(s.url(), Optional.of(TOKEN), Duration.ofSeconds(2)).execute(op()));
        assertEquals("remote-http-status", code(e));
        assertFalse(e.getMessage().contains(UPSTREAM));
        assertFalse(e.getMessage().contains(TOKEN));
    }

    @Test
    void malformedJsonIsAckMalformed() throws Exception {
        Stub s = stub().then(reply(200, "{\"status\":\"confirmed\","));
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> buddy(s).execute(op()));
        assertEquals("remote-ack-malformed", code(e));
    }

    @Test
    void unknownStatusHeldIsStatusUnknown() throws Exception {
        Stub s = stub().then(reply(200, ok("held")));
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> buddy(s).execute(op()));
        assertEquals("remote-ack-status-unknown", code(e));
    }

    @Test
    void nonStringProviderReferenceIsAckMalformed() throws Exception {
        Stub s = stub().then(reply(200, "{\"status\":\"confirmed\",\"operationId\":\"op-1\",\"runId\":\"run-1\","
                + "\"orderUuid\":\"ord-1\",\"providerReference\":42}"));
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> buddy(s).execute(op()));
        assertEquals("remote-ack-malformed", code(e));
    }

    @Test
    void delayedReplyTimesOutAfterExactlyOneRequest() throws Exception {
        Stub s = stub().then(new Scripted(200, ok("confirmed"), 1500, null));
        RemoteOperationException e = assertThrows(RemoteOperationException.class,
                () -> buddy(s.url(), Optional.empty(), Duration.ofMillis(500)).execute(op()));
        assertEquals("remote-timeout", code(e));
        assertEquals(1, s.seen.size());
    }

    @Test
    void refusedConnectionIsTransportFailed() throws Exception {
        Stub closed = new Stub();
        String url = closed.url();
        closed.close();
        RemoteOperationException e = assertThrows(RemoteOperationException.class,
                () -> buddy(url, Optional.of(TOKEN), Duration.ofSeconds(2)).execute(op()));
        assertEquals("remote-transport-failed", code(e));
        assertFalse(e.getMessage().contains(TOKEN));
        assertFalse(e.getMessage().contains("127.0.0.1"));
    }

    @Test
    void tokenIsSentAsBearerOnExecuteAndReconcile() throws Exception {
        Stub s = stub().then(reply(200, ok("confirmed")));
        HttpRemoteBuddy buddy = buddy(s.url(), Optional.of(TOKEN), Duration.ofSeconds(2));
        buddy.execute(op());
        buddy.reconcile(op());
        assertEquals(2, s.seen.size());
        assertTrue(s.seen.stream().allMatch(r -> ("Bearer " + TOKEN).equals(r.headers().get("authorization"))));
        assertFalse(s.seen.get(0).body().contains(TOKEN));
    }

    @Test
    void noTokenMeansNoAuthorizationHeader() throws Exception {
        Stub s = stub().then(reply(200, ok("confirmed")));
        buddy(s).execute(op());
        assertFalse(s.seen.get(0).headers().containsKey("authorization"));
    }

    @Test
    void nullPayloadIsSentAsJsonNullAndModeIsRemote() throws Exception {
        Stub s = stub().then(reply(200, ok("confirmed")));
        HttpRemoteBuddy buddy = buddy(s);
        assertEquals("remote", buddy.mode());
        buddy.execute(new RemoteOperation("op-1", "RELEASE", "run-1", null, "ord-1", null, null, 0));

        JsonNode body = JSON.readTree(s.seen.get(0).body());
        assertTrue(body.has("payload"));
        assertTrue(body.get("payload").isNull());
        assertTrue(body.get("holdId").isNull());
        assertTrue(body.get("employeeId").isNull());
        assertEquals(0, body.get("attempts").intValue());
        assertNull(body.get("holdId").textValue());
    }

    @Test
    void redirectIsNotFollowed() throws Exception {
        Stub s = stub().then(new Scripted(302, "", 0, "/elsewhere")).then(reply(200, ok("confirmed")));
        RemoteOperationException e = assertThrows(RemoteOperationException.class, () -> buddy(s).execute(op()));
        assertEquals("remote-http-status", code(e));
        assertEquals(1, s.seen.size());
        assertEquals("/execute", s.seen.get(0).path());
    }

    @Test
    void nullOperationOrUnsafeIdIsInvalidWithoutAnyRequest() throws Exception {
        Stub s = stub().then(reply(200, ok("confirmed")));
        HttpRemoteBuddy buddy = buddy(s);
        assertEquals("remote-operation-invalid", code(assertThrows(RemoteOperationException.class, () -> buddy.execute(null))));
        assertEquals("remote-operation-invalid", code(assertThrows(RemoteOperationException.class, () -> buddy.reconcile(null))));
        RemoteOperation spaced = withIds("op 1", "run-1", "ord-1");
        assertEquals("remote-operation-invalid", code(assertThrows(RemoteOperationException.class, () -> buddy.execute(spaced))));
        RemoteOperation blank = withIds("op-1", "", "ord-1");
        assertEquals("remote-operation-invalid", code(assertThrows(RemoteOperationException.class, () -> buddy.reconcile(blank))));
        assertTrue(s.seen.isEmpty());
    }

    @Test
    void nullTransportIsRejected() {
        assertThrows(NullPointerException.class, () -> new HttpRemoteBuddy(null));
    }
}
