package gcsp.api.remote;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.allocation.HttpRemoteBuddy;
import gcsp.api.claims.HttpClaimStock;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * A loopback stand-in for the FUCQ-481 GCSP substitute wire (not a BMW service): POST execute applies effects by
 * operation id, GET reconcile answers from that record and never applies. All state belongs to the instance.
 */
public final class RemoteOperationServer implements AutoCloseable {

    /** What the next POST does; an empty queue plays APPLY. */
    public enum Execute {
        /** Apply one effect and answer confirmed. */
        APPLY,
        /** Record a rejection and answer rejected. */
        REJECT,
        /** Apply one effect, then drop the connection with no reply: the answer is lost. */
        APPLY_THEN_DROP,
        /** Drop the connection with no reply and apply nothing: the request is lost. */
        DROP,
        /** Apply nothing and answer confirmed for another operation id. */
        MISMATCH,
        /** Apply nothing and answer HTTP 500. */
        FAIL_500,
        /** Apply one effect, hold the answer for the stall time, then answer confirmed: a client timeout sees nothing. */
        APPLY_THEN_STALL
    }

    /** What the next GET does; an empty queue plays LOOKUP. */
    public enum Reconcile {
        /** Authoritative: rejected if rejected, confirmed if any effect was applied, else not-found. */
        LOOKUP,
        /** Answer confirmed for another run id. */
        MISMATCH,
        /** Answer HTTP 500. */
        FAIL_500
    }

    /** One received request; type is the body's type (claims) or operationType (Buddy), null for a GET. */
    public record Request(String method, String path, String operationId, String runId, String orderUuid, String type,
            JsonNode body, String authorization) {}

    public static final String PROVIDER_REFERENCE_PREFIX = "ref-";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final HttpServer server;
    private final ExecutorService executor;
    private final Deque<Execute> executes = new ArrayDeque<>();
    private final Deque<Reconcile> reconciles = new ArrayDeque<>();
    private final List<Request> requests = new CopyOnWriteArrayList<>();
    private final Map<String, AtomicInteger> effects = new ConcurrentHashMap<>();
    private final Set<String> rejected = ConcurrentHashMap.newKeySet();
    private volatile Consumer<Request> beforeAnswer = r -> { };
    private volatile Duration stall = Duration.ofSeconds(4);

    private RemoteOperationServer() throws IOException {
        executor = Executors.newFixedThreadPool(2);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        server.setExecutor(executor);
        server.createContext("/", this::handle);
    }

    /** Binds 127.0.0.1 on a free port; call it from the test lifecycle and close it there. */
    public static RemoteOperationServer start() throws IOException {
        RemoteOperationServer s = new RemoteOperationServer();
        s.server.start();
        return s;
    }

    public RemoteOperationServer onExecute(Execute... steps) {
        synchronized (executes) {
            executes.addAll(List.of(steps));
        }
        return this;
    }

    public RemoteOperationServer onReconcile(Reconcile... steps) {
        synchronized (reconciles) {
            reconciles.addAll(List.of(steps));
        }
        return this;
    }

    /** Observes each accepted POST after it is recorded and before its scripted step runs. */
    public RemoteOperationServer beforeAnswer(Consumer<Request> hook) {
        this.beforeAnswer = hook == null ? r -> { } : hook;
        return this;
    }

    /** How long APPLY_THEN_STALL holds its answer; keep it bounded so close() still returns. */
    public RemoteOperationServer stallFor(Duration time) {
        this.stall = time;
        return this;
    }

    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** A real transport to this server (loopback http is allowed here only because this is test code). */
    public OperationHttpTransport transport(String prefix, Duration timeout) {
        OperationHttpTransport.Settings s = OperationHttpTransport.Settings.parse(prefix, Optional.of(baseUrl() + "/execute"),
                Optional.of(baseUrl() + "/reconcile"), Optional.empty(), timeout, true);
        return new OperationHttpTransport(s, OperationHttpTransport.newClient(timeout));
    }

    public HttpClaimStock claimStock() {
        return new HttpClaimStock(transport("gcsp.claims.stock", Duration.ofSeconds(2)));
    }

    public HttpRemoteBuddy buddy() {
        return new HttpRemoteBuddy(transport("gcsp.buddy", Duration.ofSeconds(2)));
    }

    public List<Request> requests() {
        return List.copyOf(requests);
    }

    /** Every request in arrival order as "POST:type" or "GET:reconcile". */
    public List<String> calls() {
        List<String> out = new ArrayList<>();
        for (Request r : requests) out.add("POST".equals(r.method()) ? "POST:" + r.type() : "GET:reconcile");
        return out;
    }

    public long posts(String operationId) {
        return requests.stream().filter(r -> "POST".equals(r.method()) && operationId.equals(r.operationId())).count();
    }

    public long gets(String operationId) {
        return requests.stream().filter(r -> "GET".equals(r.method()) && operationId.equals(r.operationId())).count();
    }

    public int effects(String operationId) {
        AtomicInteger n = effects.get(operationId);
        return n == null ? 0 : n.get();
    }

    public int totalEffects() {
        return effects.values().stream().mapToInt(AtomicInteger::get).sum();
    }

    @Override
    public void close() {
        server.stop(0);
        executor.shutdownNow();
        try {
            executor.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getRawPath();
            byte[] raw = exchange.getRequestBody().readAllBytes();
            String authorization = exchange.getRequestHeaders().getFirst("Authorization");
            if ("POST".equals(method) && path.endsWith("/execute")) {
                execute(exchange, path, raw, authorization);
            } else if ("GET".equals(method) && path.endsWith("/reconcile")) {
                reconcile(exchange, path, authorization);
            } else {
                respond(exchange, 405, "{}");
            }
        }
    }

    private void execute(HttpExchange exchange, String path, byte[] raw, String authorization) throws IOException {
        JsonNode body;
        try {
            body = JSON.readTree(raw);
        } catch (IOException e) {
            respond(exchange, 400, "{}");
            return;
        }
        String op = body == null ? null : body.path("operationId").asText(null);
        String run = body == null ? null : body.path("runId").asText(null);
        String order = body == null ? null : body.path("orderUuid").asText(null);
        // The idempotency key must name the operation in the body; anything else is a malformed request.
        if (op == null || run == null || order == null || !op.equals(exchange.getRequestHeaders().getFirst("Idempotency-Key"))) {
            respond(exchange, 400, "{}");
            return;
        }
        String type = body.has("type") ? body.path("type").asText(null) : body.path("operationType").asText(null);
        Request received = new Request("POST", path, op, run, order, type, body, authorization);
        requests.add(received);
        beforeAnswer.accept(received);
        Execute step;
        synchronized (executes) {
            step = executes.isEmpty() ? Execute.APPLY : executes.poll();
        }
        switch (step) {
            case APPLY -> {
                apply(op);
                respond(exchange, 200, ack("confirmed", op, run, order, true));
            }
            case REJECT -> {
                rejected.add(op);
                respond(exchange, 200, ack("rejected", op, run, order, false));
            }
            // Closing before any response headers drops the connection, so the client sees no answer.
            case APPLY_THEN_DROP -> apply(op);
            case DROP -> { }
            case MISMATCH -> respond(exchange, 200, ack("confirmed", "other-" + op, run, order, false));
            case FAIL_500 -> respond(exchange, 500, "{}");
            case APPLY_THEN_STALL -> {
                apply(op);
                try {
                    Thread.sleep(stall.toMillis());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
                respond(exchange, 200, ack("confirmed", op, run, order, true));
            }
            default -> respond(exchange, 500, "{}");
        }
    }

    private void reconcile(HttpExchange exchange, String path, String authorization) throws IOException {
        Map<String, String> q = query(exchange.getRequestURI().getRawQuery());
        String op = q.get("operationId");
        String run = q.get("runId");
        String order = q.get("orderUuid");
        if (op == null || run == null || order == null) {
            respond(exchange, 400, "{}");
            return;
        }
        requests.add(new Request("GET", path, op, run, order, null, null, authorization));
        Reconcile step;
        synchronized (reconciles) {
            step = reconciles.isEmpty() ? Reconcile.LOOKUP : reconciles.poll();
        }
        switch (step) {
            case MISMATCH -> respond(exchange, 200, ack("confirmed", op, "other-" + run, order, false));
            case FAIL_500 -> respond(exchange, 500, "{}");
            default -> {
                if (rejected.contains(op)) respond(exchange, 200, ack("rejected", op, run, order, false));
                else if (effects(op) > 0) respond(exchange, 200, ack("confirmed", op, run, order, true));
                else respond(exchange, 200, ack("not-found", op, run, order, false));
            }
        }
    }

    private void apply(String operationId) {
        effects.computeIfAbsent(operationId, k -> new AtomicInteger()).incrementAndGet();
    }

    private static String ack(String status, String op, String run, String order, boolean reference) {
        ObjectNode a = JSON.createObjectNode().put("status", status).put("operationId", op).put("runId", run)
                .put("orderUuid", order);
        if (reference) a.put("providerReference", PROVIDER_REFERENCE_PREFIX + op);
        return a.toString();
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> out = new HashMap<>();
        if (raw == null) return out;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            out.put(URLDecoder.decode(pair.substring(0, eq), StandardCharsets.UTF_8),
                    URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8));
        }
        return out;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] out = body.getBytes(StandardCharsets.UTF_8);
        // No pooled connections: a dropped reply must never let the client silently resend a POST on a reused socket.
        exchange.getResponseHeaders().set("Connection", "close");
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, out.length == 0 ? -1 : out.length);
        if (out.length > 0) exchange.getResponseBody().write(out);
    }
}
