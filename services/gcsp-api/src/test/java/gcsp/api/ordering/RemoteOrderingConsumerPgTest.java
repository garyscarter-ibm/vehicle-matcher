package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.remote.OperationHttpTransport;
import gcsp.api.remote.OperationHttpTransport.Settings;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Real loopback HTTP ordering into the durable OrderingService on native PostgreSQL; no startup, account or BMW proof. */
class RemoteOrderingConsumerPgTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TOKEN = "test-token-not-real";
    private static final String IDENTITY = "SELECT s.operation_id || '|' || s.order_reference || '|' || s.order_uuid || '|' "
            + "|| s.received_at::text || '|' || p.operation_type || '|' || p.idempotency_key || '|' || p.input_digest "
            + "|| '|' || s.selection::text FROM selection_orders s JOIN pending_operations p "
            + "USING (environment_id, run_id, operation_id)";

    @Test
    void lostAcknowledgementReconcilesSamePersistedSelectionWithoutSecondExecute() throws Exception {
        try (OrderingFixture f = OrderingFixture.create(); Remote remote = Remote.start()) {
            OrderingScope scope = f.scope("e1");
            String id = OrderingService.operationId(scope);
            OrderingService first = f.newService(f.pool(), remote.provider());

            // GET not-found, then one POST whose effect is recorded but whose acknowledgement is cut off.
            OrderingResult submitted = first.submit(scope, f.body("e1", false, "c1"), f.cart);
            assertEquals(id, assertInstanceOf(OrderingResult.Pending.class, submitted).operationId());
            assertEquals("pending", OrderingFixture.status(submitted));
            assertEquals(List.of("GET", "POST"), remote.methods());
            assertEquals(1, remote.effects.get());
            assertEquals("pending", f.text("SELECT state FROM pending_operations"));
            assertEquals("unknown", f.text("SELECT outcome->>'status' FROM pending_operations"));
            assertTrue(Set.of("remote-transport-failed", "remote-ack-malformed", "remote-timeout")
                    .contains(f.text("SELECT outcome->>'reason' FROM pending_operations")));
            assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-received'"));
            assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
            assertEquals("selection-pending", assertInstanceOf(OrderSourcePort.NotReady.class,
                    new OrderingOrderSource(f.pool()).find(f.ctx(), "car-e1")).code());
            assertOccupied(f);
            String persisted = f.text(IDENTITY);

            // The POST carried exactly the persisted operation, identity and selected stock.
            Seen post = remote.seen.get(1);
            assertEquals("/execute", post.path());
            assertEquals(id, post.headers().get("idempotency-key"));
            assertEquals("Bearer " + TOKEN, post.headers().get("authorization"));
            ObjectNode expected = JSON.createObjectNode().put("operationId", id).put("idempotencyKey", id)
                    .put("inputDigest", f.text("SELECT input_digest FROM pending_operations"))
                    .put("orderUuid", "car-e1").put("orderNumber", OrderingFixture.order("e1")).put("configurationId", "cfg-1")
                    .put("firstApprovalStage", f.text("SELECT selection->'terms'->'approvalStages'->>0 FROM selection_orders"))
                    .put("environmentId", OrderingFixture.ENV).put("runId", OrderingFixture.RUN).put("employeeId", "e1")
                    .put("entitlementSlotId", "slot-e1").put("policyVersion", OrderingFixture.VERSION);
            assertEquals(expected, JSON.readTree(post.body()));
            assertEquals(id, f.text("SELECT idempotency_key FROM pending_operations"));

            // Restart: a new service and HTTP client over the same schema; GET now finds the remote record.
            OrderingService restarted = f.newService(f.pool(), remote.provider());
            OrderingResult.Ok swept = assertInstanceOf(OrderingResult.Ok.class, restarted.reconcileOpen(f.ctx(), 10));
            assertEquals(1, swept.value().get("examined").asInt());
            assertEquals(1, swept.value().get("settled").asInt());
            assertEquals(List.of("GET", "POST", "GET"), remote.methods());
            assertEquals(1, remote.effects.get());
            assertEquals(0, remote.duplicates.get());
            for (int i : List.of(0, 2)) {
                assertEquals("/reconcile", remote.seen.get(i).path());
                assertEquals(Map.of("operationId", id, "runId", OrderingFixture.RUN, "orderUuid", "car-e1"),
                        remote.seen.get(i).query());
            }

            String reference = "remote-receipt-1";
            assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
            assertEquals(reference, f.text("SELECT provider_reference FROM pending_operations"));
            assertEquals("true", f.text("SELECT outcome->>'fictional' FROM pending_operations"));
            assertEquals(persisted, f.text(IDENTITY));
            assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
            assertEquals(1, f.count("SELECT count(*) FROM pending_operations"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
            assertEquals(reference, f.text("SELECT payload->>'providerReference' FROM outbox_events "
                    + "WHERE event_type = 'ordering.selection-acknowledged'"));
            OrderSourcePort.SelectionOrder order = assertInstanceOf(OrderSourcePort.Ready.class,
                    new OrderingOrderSource(f.pool()).find(f.ctx(), "car-e1")).order();
            assertEquals(id, order.operationId());
            assertEquals(reference, order.providerReference());
            assertEquals("e1", order.employeeId());
            OrderingResult read = restarted.read(scope);
            assertEquals("acknowledged", OrderingFixture.status(read));
            assertEquals(reference, OrderingFixture.value(read).path("providerReference").asText());
            assertOccupied(f);
            assertEquals(1, f.cart.converts.get());
        }
    }

    /** The converted hold and car stay allocated: an unknown outcome never frees order authority. */
    private static void assertOccupied(OrderingFixture f) throws Exception {
        assertEquals("allocated", f.text("SELECT state FROM custody_holds WHERE hold_id = 'hold-e1'"));
        assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-e1'"));
    }

    private record Seen(String method, String path, Map<String, String> query, Map<String, String> headers, String body) {}

    /** Forwards unchanged to the real adapter; only satisfies the fixture's OrderingPort type. */
    private record Delegate(HttpOrderingProvider inner) implements OrderingFixture.OrderingPort {
        @Override
        public String mode() {
            return inner.mode();
        }

        @Override
        public String provider() {
            return inner.provider();
        }

        @Override
        public ProviderResponse execute(OrderingScope scope, ProviderRequest request) {
            return inner.execute(scope, request);
        }

        @Override
        public ProviderResponse reconcile(OrderingScope scope, ProviderRequest request) {
            return inner.reconcile(scope, request);
        }
    }

    /** A loopback substitute that answers reconcile from its own record and loses every execute acknowledgement. */
    private static final class Remote implements AutoCloseable {
        final List<Seen> seen = new CopyOnWriteArrayList<>();
        final Map<String, JsonNode> ledger = new ConcurrentHashMap<>();
        final AtomicInteger effects = new AtomicInteger();
        final AtomicInteger duplicates = new AtomicInteger();
        final List<HttpClient> clients = new CopyOnWriteArrayList<>();
        private final HttpServer server;
        private final ExecutorService executor;

        private Remote(HttpServer server, ExecutorService executor) {
            this.server = server;
            this.executor = executor;
        }

        static Remote start() throws IOException {
            HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            ExecutorService executor = Executors.newSingleThreadExecutor();
            Remote remote = new Remote(server, executor);
            server.setExecutor(executor);
            server.createContext("/", remote::handle);
            server.start();
            return remote;
        }

        /** A fresh adapter and client each call, as a restarted process would build. */
        OrderingFixture.OrderingPort provider() {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            Duration timeout = Duration.ofSeconds(2);
            HttpClient client = OperationHttpTransport.newClient(timeout);
            clients.add(client);
            Settings settings = Settings.parse("gcsp.ordering", Optional.of(base + "/execute"),
                    Optional.of(base + "/reconcile"), Optional.of(TOKEN), timeout, true);
            return new Delegate(new HttpOrderingProvider(settings, client));
        }

        List<String> methods() {
            return seen.stream().map(Seen::method).toList();
        }

        private void handle(HttpExchange exchange) throws IOException {
            try {
                Map<String, String> headers = new HashMap<>();
                exchange.getRequestHeaders().forEach((k, v) -> headers.put(k.toLowerCase(Locale.ROOT), v.get(0)));
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Map<String, String> query = query(exchange.getRequestURI().getRawQuery());
                String path = exchange.getRequestURI().getRawPath();
                seen.add(new Seen(exchange.getRequestMethod(), path, query, headers, body));
                if ("POST".equals(exchange.getRequestMethod()) && "/execute".equals(path)) {
                    JsonNode op = JSON.readTree(body);
                    if (ledger.putIfAbsent(op.path("operationId").asText(), op) != null) duplicates.incrementAndGet();
                    else effects.incrementAndGet();
                    // The effect is recorded; the answer is cut short so no valid acknowledgement arrives.
                    byte[] ack = confirmed(op).toString().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, ack.length);
                    exchange.getResponseBody().write(ack, 0, ack.length / 2);
                    exchange.getResponseBody().flush();
                    return;
                }
                if ("GET".equals(exchange.getRequestMethod()) && "/reconcile".equals(path)) {
                    JsonNode op = ledger.get(query.getOrDefault("operationId", ""));
                    boolean same = op != null && op.path("runId").asText().equals(query.get("runId"))
                            && op.path("orderUuid").asText().equals(query.get("orderUuid"));
                    ObjectNode answer = same ? confirmed(op) : JSON.createObjectNode().put("status", "not-found")
                            .put("operationId", query.get("operationId")).put("runId", query.get("runId"))
                            .put("orderUuid", query.get("orderUuid")).put("fictional", true);
                    byte[] bytes = answer.toString().getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    return;
                }
                exchange.sendResponseHeaders(404, -1);
            } catch (IOException e) {
                // A client may drop the connection mid-exchange; the ledger is already recorded.
            } finally {
                // Closing with bytes still owed drops the connection: that is the lost acknowledgement.
                exchange.close();
            }
        }

        /** The stored operation's original identity and stock, confirmed at its first approval stage. */
        private ObjectNode confirmed(JsonNode op) {
            return JSON.createObjectNode().put("status", "confirmed").put("operationId", op.path("operationId").asText())
                    .put("runId", op.path("runId").asText()).put("orderUuid", op.path("orderUuid").asText())
                    .put("orderNumber", op.path("orderNumber").asText())
                    .put("configurationId", op.path("configurationId").asText())
                    .put("orderStatus", op.path("firstApprovalStage").asText())
                    .put("providerReference", "remote-receipt-" + effects.get()).put("fictional", true);
        }

        private static Map<String, String> query(String raw) {
            Map<String, String> out = new HashMap<>();
            if (raw == null || raw.isEmpty()) return out;
            for (String pair : raw.split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0) {
                    out.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                            URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
                }
            }
            return out;
        }

        @Override
        public void close() throws InterruptedException {
            try {
                for (HttpClient client : clients) client.shutdownNow();
                server.stop(0);
            } finally {
                executor.shutdownNow();
                if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("loopback worker did not stop");
                }
            }
        }
    }
}
