package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.ordering.OrderingProviderPort.ProviderRequest;
import gcsp.api.ordering.OrderingProviderPort.ProviderResponse;
import gcsp.api.ordering.OrderingProviderPort.Status;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/**
 * Started Quarkus with gcsp.ordering.provider=remote and no database: the real selector, bindings and holder resolve one
 * HttpOrderingProvider at startup without a request. Not a Holder.service, database, JWT or full-order proof.
 */
@QuarkusTest
@TestProfile(RemoteOrderingStartupTest.RemoteProfile.class)
class RemoteOrderingStartupTest {

    private static final String TOKEN = "test-token-not-real";

    @Inject
    OrderingSelection selection;

    @Inject
    OrderingProviderBindings bindings;

    @Inject
    OrderingServiceHolder holder;

    @ConfigProperty(name = "gcsp.ordering.reconcile-url")
    String reconcileUrl;

    public static class RemoteProfile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("gcsp.ordering.provider", "remote", "gcsp.ordering.token", TOKEN, "gcsp.ordering.timeout", "2s",
                    "quarkus.datasource.active", "false", "quarkus.flyway.active", "false",
                    "quarkus.devservices.enabled", "false");
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(OrderingStub.class));
        }
    }

    @Test
    void remoteIsBoundAtStartupWithoutARequestAndReconcilesThroughTheSelectedPort() throws Exception {
        String stats = reconcileUrl.replace("/ordering/reconcile", "/stats");
        assertEquals("execute=0 reconcile=0", read(stats), "startup made no ordering request");

        assertEquals("remote", selection.provider());
        assertEquals("remote", holder.provider());
        assertEquals("remote", bindings.mode());
        OrderingProviderPort port = bindings.provider(null);
        assertInstanceOf(HttpOrderingProvider.class, port);
        assertSame(port, bindings.provider(null), "one adapter per startup");
        assertEquals(HttpOrderingProvider.PROVIDER, port.provider());
        assertTrue(holder.service().isEmpty(), "without persistence the holder builds no service");
        assertEquals("execute=0 reconcile=0", read(stats));

        OrderingScope scope = new OrderingScope("isolated-dev", "run-s1", "employee-s1", "slot-s1", "policy-v1");
        ProviderRequest request = new ProviderRequest("operation-s1", "operation-s1", "c".repeat(64), "exact-car-s1",
                "2345678", "configuration-s1", "HR approval");
        ProviderResponse response = port.reconcile(scope, request);
        assertEquals(Status.NOT_FOUND, response.status());
        assertEquals("operation-s1", response.operationId());
        assertEquals("run-s1", response.runId());
        assertEquals("exact-car-s1", response.orderUuid());
        assertNull(response.reason());
        assertTrue(response.fictional());
        assertEquals("execute=0 reconcile=1 auth=Bearer " + TOKEN, read(stats), "one GET lookup, never an execute");
    }

    private static String read(String url) throws IOException, InterruptedException {
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            HttpResponse<String> r = client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(2))
                    .GET().build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, r.statusCode());
            return r.body();
        }
    }

    /** A loopback ordering substitute owned by this test: reconcile answers an echoed not-found; execute is refused. */
    public static class OrderingStub implements QuarkusTestResourceLifecycleManager {

        private final AtomicInteger executes = new AtomicInteger();
        private final AtomicInteger reconciles = new AtomicInteger();
        private final AtomicReference<String> auth = new AtomicReference<>();
        private HttpServer server;

        @Override
        public Map<String, String> start() {
            try {
                server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
                server.createContext("/ordering/execute", exchange -> {
                    executes.incrementAndGet();
                    respond(exchange, 500, "{}");
                });
                server.createContext("/ordering/reconcile", this::reconcile);
                server.createContext("/stats", exchange -> respond(exchange, 200, "execute=" + executes.get()
                        + " reconcile=" + reconciles.get() + (auth.get() == null ? "" : " auth=" + auth.get())));
                server.start();
                String base = "http://127.0.0.1:" + server.getAddress().getPort();
                Map<String, String> c = new HashMap<>();
                c.put("gcsp.ordering.execute-url", base + "/ordering/execute");
                c.put("gcsp.ordering.reconcile-url", base + "/ordering/reconcile");
                return c;
            } catch (IOException | RuntimeException e) {
                stop();
                throw new IllegalStateException("The remote ordering stub failed to start", e);
            }
        }

        @Override
        public void stop() {
            HttpServer s = server;
            server = null;
            if (s != null) s.stop(0);
        }

        private void reconcile(HttpExchange exchange) throws IOException {
            reconciles.incrementAndGet();
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            Map<String, String> q = new HashMap<>();
            String raw = exchange.getRequestURI().getRawQuery();
            for (String pair : raw == null ? new String[0] : raw.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0) {
                    q.put(pair.substring(0, eq), URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
                }
            }
            if (!"GET".equals(exchange.getRequestMethod()) || q.size() != 3) {
                respond(exchange, 400, "{}");
                return;
            }
            respond(exchange, 200, "{\"status\":\"not-found\",\"operationId\":\"" + q.get("operationId") + "\",\"runId\":\""
                    + q.get("runId") + "\",\"orderUuid\":\"" + q.get("orderUuid") + "\",\"fictional\":true}");
        }

        private static void respond(HttpExchange exchange, int status, String body) throws IOException {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        }
    }
}
