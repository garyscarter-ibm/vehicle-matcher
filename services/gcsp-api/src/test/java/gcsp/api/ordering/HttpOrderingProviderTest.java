package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.ordering.OrderingProviderPort.ProviderRequest;
import gcsp.api.ordering.OrderingProviderPort.ProviderResponse;
import gcsp.api.ordering.OrderingProviderPort.Status;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Settings;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Actual loopback HTTP for the standalone ordering substitute; no startup, database or BMW proof. */
class HttpOrderingProviderTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "test-token-not-real";
    private static final OrderingScope SCOPE = new OrderingScope("isolated-dev", "run-7", "employee-7", "slot-7", "policy-v7");
    private static final ProviderRequest REQUEST = new ProviderRequest("operation-7", "persisted-key-7", "a".repeat(64),
            "exact-car-7", "1234567", "configuration-7", "HR approval");

    private record Seen(String method, String path, String query, Map<String, String> headers, String body) {}

    private record Scripted(int status, String body, long headerDelayMillis, int prefixBytes, long bodyDelayMillis) {}

    private final List<Seen> seen = new CopyOnWriteArrayList<>();
    private final Queue<Scripted> script = new ConcurrentLinkedQueue<>();
    private final CountDownLatch bodyStarted = new CountDownLatch(1);
    private HttpServer server;
    private ExecutorService executor;

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        executor = Executors.newSingleThreadExecutor();
        server.setExecutor(executor);
        server.createContext("/", exchange -> {
            Map<String, String> headers = new HashMap<>();
            exchange.getRequestHeaders().forEach((key, value) -> headers.put(key.toLowerCase(Locale.ROOT), value.get(0)));
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            seen.add(new Seen(exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(),
                    exchange.getRequestURI().getRawQuery(), headers, body));
            Scripted next = script.poll();
            Scripted response = next == null ? new Scripted(500, "{}", 0, 0, 0) : next;
            try {
                if (response.headerDelayMillis() > 0) Thread.sleep(response.headerDelayMillis());
                byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
                if (response.status() == 302) exchange.getResponseHeaders().add("Location", "/redirected");
                exchange.sendResponseHeaders(response.status(), bytes.length == 0 ? -1 : bytes.length);
                if (response.prefixBytes() > 0) {
                    int prefix = Math.min(response.prefixBytes(), bytes.length);
                    exchange.getResponseBody().write(bytes, 0, prefix);
                    exchange.getResponseBody().flush();
                    bodyStarted.countDown();
                    if (response.bodyDelayMillis() > 0) Thread.sleep(response.bodyDelayMillis());
                    exchange.getResponseBody().write(bytes, prefix, bytes.length - prefix);
                } else if (bytes.length > 0) {
                    exchange.getResponseBody().write(bytes);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException e) {
                // A bounded client may cancel before the stub finishes its body.
            } finally {
                exchange.close();
            }
        });
        server.start();
    }

    @AfterEach
    void stopStub() throws InterruptedException {
        server.stop(0);
        executor.shutdownNow();
        assertTrue(executor.awaitTermination(2, TimeUnit.SECONDS), "loopback worker stopped");
    }

    private Settings settings(Duration timeout) {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        return Settings.parse("gcsp.ordering", Optional.of(base + "/execute"), Optional.of(base + "/reconcile"),
                Optional.of(TOKEN), timeout, true);
    }

    private HttpOrderingProvider provider(Duration timeout) {
        return new HttpOrderingProvider(settings(timeout), OperationHttpTransport.newClient(timeout));
    }

    private HttpOrderingProvider provider() {
        return provider(Duration.ofSeconds(2));
    }

    private void reply(int status, String body) {
        script.add(new Scripted(status, body, 0, 0, 0));
    }

    private static ObjectNode ack(String status, OrderingScope scope, ProviderRequest request) {
        return JSON.createObjectNode().put("status", status).put("operationId", request.operationId())
                .put("runId", scope.runId()).put("orderUuid", request.orderUuid()).put("fictional", true);
    }

    private static ObjectNode confirmed(OrderingScope scope, ProviderRequest request) {
        return ack("confirmed", scope, request).put("orderNumber", request.orderNumber())
                .put("configurationId", request.configurationId()).put("orderStatus", request.firstApprovalStage())
                .put("providerReference", "upstream-receipt-77");
    }

    private static void assertUnknown(String reason, ProviderResponse response) {
        assertEquals(new ProviderResponse(Status.UNKNOWN, null, null, null, null, null, null, null, reason, false), response);
    }

    @Test
    void executePreservesEveryRequestAndScopeFieldAndActualConfirmation() throws Exception {
        reply(200, confirmed(SCOPE, REQUEST).toString());
        HttpOrderingProvider provider = provider();

        ProviderResponse response = provider.execute(SCOPE, REQUEST);

        assertEquals(new ProviderResponse(Status.CONFIRMED, "operation-7", "run-7", "exact-car-7", "1234567",
                "configuration-7", "HR approval", "upstream-receipt-77", null, true), response);
        assertEquals("remote", provider.mode());
        assertEquals("remote-ordering-substitute:v1", provider.provider());
        assertEquals(1, seen.size());
        Seen sent = seen.get(0);
        assertEquals("POST", sent.method());
        assertEquals("/execute", sent.path());
        assertNull(sent.query());
        assertEquals("application/json", sent.headers().get("accept"));
        assertEquals("application/json", sent.headers().get("content-type"));
        assertEquals("Bearer " + TOKEN, sent.headers().get("authorization"));
        assertEquals("persisted-key-7", sent.headers().get("idempotency-key"));
        ObjectNode expected = JSON.createObjectNode().put("operationId", "operation-7").put("idempotencyKey", "persisted-key-7")
                .put("inputDigest", "a".repeat(64)).put("orderUuid", "exact-car-7").put("orderNumber", "1234567")
                .put("configurationId", "configuration-7").put("firstApprovalStage", "HR approval")
                .put("environmentId", "isolated-dev").put("runId", "run-7").put("employeeId", "employee-7")
                .put("entitlementSlotId", "slot-7").put("policyVersion", "policy-v7");
        assertEquals(expected, JSON.readTree(sent.body()));
    }

    @Test
    void reconcileOnlyLooksUpSameEscapedIdentityAndCanReturnStoredConfirmation() {
        OrderingScope scope = new OrderingScope("isolated-dev", "run +7", "employee-7", "slot-7", "policy-v7");
        ProviderRequest request = new ProviderRequest("op&7/a", REQUEST.idempotencyKey(), REQUEST.inputDigest(), "order=7%",
                REQUEST.orderNumber(), REQUEST.configurationId(), REQUEST.firstApprovalStage());
        reply(200, confirmed(scope, request).toString());

        ProviderResponse response = provider().reconcile(scope, request);

        assertEquals(Status.CONFIRMED, response.status());
        assertEquals(request.operationId(), response.operationId());
        assertEquals(scope.runId(), response.runId());
        assertEquals(request.orderUuid(), response.orderUuid());
        assertEquals("upstream-receipt-77", response.providerReference());
        assertEquals(1, seen.size());
        Seen sent = seen.get(0);
        assertEquals("GET", sent.method());
        assertEquals("/reconcile", sent.path());
        assertEquals("operationId=op%267%2Fa&runId=run%20%2B7&orderUuid=order%3D7%25", sent.query());
        assertEquals("", sent.body());
        assertEquals("Bearer " + TOKEN, sent.headers().get("authorization"));
        assertFalse(sent.headers().containsKey("content-type"));
        assertFalse(sent.headers().containsKey("idempotency-key"));
    }

    @Test
    void scopedNegativeAcknowledgementsRemainDistinctAndNotFoundNeverExecutes() {
        HttpOrderingProvider provider = provider();
        for (String status : List.of("rejected", "unsupported", "not-found", "unknown")) {
            reply(200, ack(status, SCOPE, REQUEST).put("reason", "private-upstream-detail").toString());
        }

        assertEquals(new ProviderResponse(Status.REJECTED, "operation-7", "run-7", "exact-car-7", null, null, null, null,
                "remote-ordering-rejected", true), provider.execute(SCOPE, REQUEST));
        assertEquals(new ProviderResponse(Status.UNSUPPORTED, "operation-7", "run-7", "exact-car-7", null, null, null, null,
                "remote-ordering-unsupported", true), provider.execute(SCOPE, REQUEST));
        assertEquals(new ProviderResponse(Status.NOT_FOUND, "operation-7", "run-7", "exact-car-7", null, null, null, null,
                null, true), provider.reconcile(SCOPE, REQUEST));
        assertEquals(new ProviderResponse(Status.UNKNOWN, "operation-7", "run-7", "exact-car-7", null, null, null, null,
                "remote-ordering-unknown", true), provider.reconcile(SCOPE, REQUEST));
        assertEquals(List.of("POST", "POST", "GET", "GET"), seen.stream().map(Seen::method).toList());
    }

    @Test
    void wrongIdentityCannotAuthorizeConfirmationRefusalOrResend() {
        HttpOrderingProvider provider = provider();
        for (String field : List.of("operationId", "runId", "orderUuid")) {
            reply(200, confirmed(SCOPE, REQUEST).put(field, "another-identity").toString());
        }
        reply(200, ack("not-found", SCOPE, REQUEST).put("runId", "retired-run").toString());
        reply(200, ack("unsupported", SCOPE, REQUEST).put("orderUuid", "another-car").toString());

        for (int i = 0; i < 5; i++) assertUnknown("remote-ack-mismatch", provider.reconcile(SCOPE, REQUEST));

        assertEquals(5, seen.size());
        assertTrue(seen.stream().allMatch(request -> request.method().equals("GET")));
    }

    @Test
    void confirmationCannotBorrowMissingFactsOrAcceptDifferentOrderOrStage() {
        HttpOrderingProvider provider = provider();
        for (String field : List.of("orderNumber", "configurationId", "orderStatus", "providerReference")) {
            ObjectNode missing = confirmed(SCOPE, REQUEST);
            missing.remove(field);
            reply(200, missing.toString());
            assertUnknown("remote-ack-malformed", provider.execute(SCOPE, REQUEST));
        }
        for (String field : List.of("orderNumber", "configurationId", "orderStatus")) {
            reply(200, confirmed(SCOPE, REQUEST).put(field, "different-fact").toString());
            assertUnknown("remote-ack-mismatch", provider.execute(SCOPE, REQUEST));
        }
        reply(200, confirmed(SCOPE, REQUEST).put("providerReference", " ").toString());
        reply(200, confirmed(SCOPE, REQUEST).put("providerReference", "x".repeat(OperationHttpTransport.MAX_REFERENCE + 1)).toString());
        assertUnknown("remote-ack-malformed", provider.execute(SCOPE, REQUEST));
        assertUnknown("remote-ack-malformed", provider.execute(SCOPE, REQUEST));
        assertEquals(9, seen.size());
    }

    @Test
    void strictJsonTypesAndExplicitFictionalProvenanceAreRequired() {
        List<String> malformed = new ArrayList<>();
        malformed.add("{not-json");
        malformed.add("[]");
        malformed.add(confirmed(SCOPE, REQUEST) + " {}");
        malformed.add(confirmed(SCOPE, REQUEST).toString().replace("\"status\":\"confirmed\"",
                "\"status\":\"confirmed\",\"status\":\"not-found\""));
        malformed.add(confirmed(SCOPE, REQUEST).put("orderNumber", 1234567).toString());
        malformed.add(confirmed(SCOPE, REQUEST).put("fictional", false).toString());
        malformed.add(confirmed(SCOPE, REQUEST).put("fictional", "true").toString());
        ObjectNode missing = confirmed(SCOPE, REQUEST);
        missing.remove("fictional");
        malformed.add(missing.toString());
        malformed.add(ack("unsupported", SCOPE, REQUEST).put("providerReference", "unconfirmed-reference").toString());
        HttpOrderingProvider provider = provider();
        for (String body : malformed) {
            reply(200, body);
            assertUnknown("remote-ack-malformed", provider.reconcile(SCOPE, REQUEST));
        }
        reply(200, ack("accepted", SCOPE, REQUEST).toString());
        assertUnknown("remote-ack-status-unknown", provider.reconcile(SCOPE, REQUEST));
        assertEquals(malformed.size() + 1, seen.size());
    }

    @Test
    void invalidRequestsNeverReachRemote() {
        HttpOrderingProvider provider = provider();
        assertUnknown("remote-operation-invalid", provider.execute(null, REQUEST));
        assertUnknown("remote-operation-invalid", provider.reconcile(SCOPE, null));
        OrderingScope missingPolicy = new OrderingScope("isolated-dev", "run-7", "employee-7", "slot-7", " ");
        assertUnknown("remote-operation-invalid", provider.execute(missingPolicy, REQUEST));
        for (ProviderRequest request : List.of(
                new ProviderRequest(REQUEST.operationId(), "key\r\nInjected: yes", REQUEST.inputDigest(), REQUEST.orderUuid(),
                        REQUEST.orderNumber(), REQUEST.configurationId(), REQUEST.firstApprovalStage()),
                new ProviderRequest(REQUEST.operationId(), REQUEST.idempotencyKey(), "not-a-digest", REQUEST.orderUuid(),
                        REQUEST.orderNumber(), REQUEST.configurationId(), REQUEST.firstApprovalStage()),
                new ProviderRequest(REQUEST.operationId(), REQUEST.idempotencyKey(), REQUEST.inputDigest(), REQUEST.orderUuid(),
                        "123456", REQUEST.configurationId(), REQUEST.firstApprovalStage()))) {
            assertUnknown("remote-operation-invalid", provider.execute(SCOPE, request));
            assertUnknown("remote-operation-invalid", provider.reconcile(SCOPE, request));
        }
        assertTrue(seen.isEmpty());
    }

    @Test
    void httpFailuresAndRedirectsCannotBecomeNotFoundOrLeakUpstreamText() {
        reply(404, ack("not-found", SCOPE, REQUEST).toString());
        reply(503, "private-upstream-detail " + TOKEN);
        reply(302, ack("not-found", SCOPE, REQUEST).toString());
        HttpOrderingProvider provider = provider();

        for (int i = 0; i < 3; i++) assertUnknown("remote-http-status", provider.reconcile(SCOPE, REQUEST));

        assertEquals(3, seen.size());
        assertTrue(seen.stream().allMatch(request -> request.path().equals("/reconcile")));
    }

    @Test
    void bodyLimitAllowsExactBoundAndCancelsOversizeWithoutDraining() {
        String body = confirmed(SCOPE, REQUEST).toString();
        int length = body.getBytes(StandardCharsets.UTF_8).length;
        reply(200, body + " ".repeat(OperationHttpTransport.MAX_BODY - length));
        HttpOrderingProvider provider = provider();
        assertEquals(Status.CONFIRMED, provider.reconcile(SCOPE, REQUEST).status());
        String oversized = confirmed(SCOPE, REQUEST).put("padding", "x".repeat(OperationHttpTransport.MAX_BODY)).toString();
        script.add(new Scripted(200, oversized, 0, OperationHttpTransport.MAX_BODY + 1, 1500));

        assertUnknown("remote-ack-malformed", provider(Duration.ofMillis(800)).reconcile(SCOPE, REQUEST));

        assertEquals(0, bodyStarted.getCount(), "oversized prefix reached the client before its delayed tail");
        assertEquals(2, seen.size());
    }

    @Test
    void bodyStallExpiresTheWholeCallWithoutRetry() {
        script.add(new Scripted(200, confirmed(SCOPE, REQUEST).toString(), 0, 1, 1500));

        assertUnknown("remote-timeout", provider(Duration.ofMillis(400)).execute(SCOPE, REQUEST));

        assertEquals(0, bodyStarted.getCount(), "headers and first body byte were sent");
        assertEquals(1, seen.size());
    }

    @Test
    void headerStallExpiresWithoutRetry() {
        script.add(new Scripted(200, confirmed(SCOPE, REQUEST).toString(), 1500, 0, 0));

        assertUnknown("remote-timeout", provider(Duration.ofMillis(400)).execute(SCOPE, REQUEST));

        assertEquals(1, seen.size());
    }

    @Test
    void connectionFailureStaysUnknown() {
        HttpOrderingProvider provider = provider();
        server.stop(0);

        assertUnknown("remote-transport-failed", provider.execute(SCOPE, REQUEST));

        assertTrue(seen.isEmpty());
    }

    @Test
    void clientMustDisableRedirects() {
        HttpClient redirecting = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();

        assertThrows(IllegalArgumentException.class,
                () -> new HttpOrderingProvider(settings(Duration.ofSeconds(2)), redirecting));

        assertTrue(seen.isEmpty());
    }
}
