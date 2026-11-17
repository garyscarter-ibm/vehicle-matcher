package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A loopback GCSP ordering substitute owned by this test: GET reconcile answers not-found until one POST execute stores a
 * fictional confirmation, then answers that. /stats exposes counts and observed requests; nothing leaves 127.0.0.1.
 */
public class GeneratedClaimRemoteOrderingResource implements QuarkusTestResourceLifecycleManager {

    static final String REFERENCE_PREFIX = "gcsp-remote-order:";
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Map<String, ObjectNode> confirmed = new ConcurrentHashMap<>();
    private final ArrayNode observed = JSON.createArrayNode();
    private int executes;
    private int reconciles;
    private HttpServer server;

    @Override
    public Map<String, String> start() {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            server.createContext("/ordering/execute", this::execute);
            server.createContext("/ordering/reconcile", this::reconcile);
            server.createContext("/ordering/stats", this::stats);
            server.start();
            String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/ordering";
            Map<String, String> c = new HashMap<>();
            c.put("gcsp.ordering.execute-url", base + "/execute");
            c.put("gcsp.ordering.reconcile-url", base + "/reconcile");
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

    private synchronized void execute(HttpExchange exchange) throws IOException {
        executes++;
        JsonNode body;
        try {
            body = JSON.readTree(exchange.getRequestBody().readAllBytes());
        } catch (IOException e) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        ObjectNode seen = observed.addObject().put("method", exchange.getRequestMethod()).put("path", "execute")
                .put("idempotencyKey", exchange.getRequestHeaders().getFirst("Idempotency-Key"));
        seen.set("body", body);
        if (!"POST".equals(exchange.getRequestMethod()) || !body.isObject()) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        String id = body.path("operationId").asText();
        ObjectNode ack = confirmed.computeIfAbsent(id, k -> JSON.createObjectNode().put("status", "confirmed")
                .put("operationId", id).put("runId", body.path("runId").asText())
                .put("orderUuid", body.path("orderUuid").asText()).put("orderNumber", body.path("orderNumber").asText())
                .put("configurationId", body.path("configurationId").asText())
                .put("orderStatus", body.path("firstApprovalStage").asText())
                .put("providerReference", REFERENCE_PREFIX + id).put("fictional", true));
        respond(exchange, 200, ack);
    }

    private synchronized void reconcile(HttpExchange exchange) throws IOException {
        reconciles++;
        Map<String, String> q = new HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        for (String pair : raw == null ? new String[0] : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) q.put(pair.substring(0, eq), URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
        observed.addObject().put("method", exchange.getRequestMethod()).put("path", "reconcile")
                .put("operationId", q.get("operationId"));
        if (!"GET".equals(exchange.getRequestMethod()) || q.size() != 3) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        ObjectNode ack = confirmed.get(q.get("operationId"));
        respond(exchange, 200, ack != null ? ack : JSON.createObjectNode().put("status", "not-found")
                .put("operationId", q.get("operationId")).put("runId", q.get("runId"))
                .put("orderUuid", q.get("orderUuid")).put("fictional", true));
    }

    private synchronized void stats(HttpExchange exchange) throws IOException {
        ObjectNode s = JSON.createObjectNode().put("executes", executes).put("reconciles", reconciles);
        s.set("observed", observed.deepCopy());
        respond(exchange, 200, s);
    }

    private static void respond(HttpExchange exchange, int status, JsonNode body) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
