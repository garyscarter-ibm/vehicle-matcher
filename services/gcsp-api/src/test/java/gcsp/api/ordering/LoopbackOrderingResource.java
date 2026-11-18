package gcsp.api.ordering;

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
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Loopback ordering substitute with an in-memory record of confirmed effects by operationId. /control?mode= is
 * confirm, reject (no effect), drop-ack (effect, then no reply) or hide (effect, but a lookup answers unknown).
 */
public class LoopbackOrderingResource implements QuarkusTestResourceLifecycleManager {

    static final String REFERENCE_PREFIX = "loopback-ordering:";
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Map<String, ObjectNode> effects = new LinkedHashMap<>();
    private String mode = "confirm";
    private int executes;
    private int reconciles;
    private int duplicates;
    private HttpServer server;

    @Override
    public Map<String, String> start() {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
            server.createContext("/ordering/execute", this::execute);
            server.createContext("/ordering/reconcile", this::reconcile);
            server.createContext("/ordering/stats", this::stats);
            server.createContext("/ordering/control", this::control);
            server.start();
            String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/ordering";
            Map<String, String> c = new HashMap<>();
            c.put("gcsp.ordering.execute-url", base + "/execute");
            c.put("gcsp.ordering.reconcile-url", base + "/reconcile");
            return c;
        } catch (IOException | RuntimeException e) {
            stop();
            throw new IllegalStateException("The loopback ordering endpoint failed to start", e);
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
        if (!"POST".equals(exchange.getRequestMethod()) || body == null || !body.isObject()) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        String id = body.path("operationId").asText();
        if ("reject".equals(mode)) {
            respond(exchange, 200, echo("rejected", id, body.path("runId").asText(), body.path("orderUuid").asText()));
            return;
        }
        // The effect is recorded before any reply, as a real provider would.
        if (effects.containsKey(id)) duplicates++;
        ObjectNode effect = effects.computeIfAbsent(id, k -> echo("confirmed", id, body.path("runId").asText(),
                body.path("orderUuid").asText()).put("orderNumber", body.path("orderNumber").asText())
                .put("configurationId", body.path("configurationId").asText())
                .put("orderStatus", body.path("firstApprovalStage").asText()).put("providerReference", REFERENCE_PREFIX + id));
        if ("drop-ack".equals(mode)) {
            exchange.close();
            return;
        }
        respond(exchange, 200, effect);
    }

    private synchronized void reconcile(HttpExchange exchange) throws IOException {
        reconciles++;
        Map<String, String> q = new HashMap<>();
        String raw = exchange.getRequestURI().getRawQuery();
        for (String pair : raw == null ? new String[0] : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) q.put(pair.substring(0, eq), URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
        if (!"GET".equals(exchange.getRequestMethod()) || q.size() != 3) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        String id = q.get("operationId");
        ObjectNode effect = effects.get(id);
        String status = effect == null ? "not-found" : "hide".equals(mode) ? "unknown" : null;
        respond(exchange, 200, status == null ? effect : echo(status, id, q.get("runId"), q.get("orderUuid")));
    }

    private synchronized void stats(HttpExchange exchange) throws IOException {
        ObjectNode s = JSON.createObjectNode().put("executes", executes).put("reconciles", reconciles)
                .put("effects", effects.size()).put("duplicates", duplicates).put("mode", mode);
        ArrayNode ids = s.putArray("operations");
        effects.keySet().forEach(ids::add);
        ObjectNode refs = s.putObject("references");
        effects.forEach((k, v) -> refs.put(k, v.get("providerReference").asText()));
        respond(exchange, 200, s);
    }

    /** Test-only switch: POST /control?mode=confirm|reject|drop-ack|hide; it never touches a recorded effect. */
    private synchronized void control(HttpExchange exchange) throws IOException {
        String raw = exchange.getRequestURI().getRawQuery();
        String next = raw != null && raw.startsWith("mode=") ? raw.substring(5) : null;
        if (!"POST".equals(exchange.getRequestMethod()) || next == null
                || !java.util.List.of("confirm", "reject", "drop-ack", "hide").contains(next)) {
            respond(exchange, 400, JSON.createObjectNode());
            return;
        }
        mode = next;
        respond(exchange, 200, JSON.createObjectNode().put("mode", mode));
    }

    private static ObjectNode echo(String status, String operationId, String runId, String orderUuid) {
        return JSON.createObjectNode().put("status", status).put("operationId", operationId).put("runId", runId)
                .put("orderUuid", orderUuid).put("fictional", true);
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
