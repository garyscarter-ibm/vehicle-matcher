package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import gcsp.api.remote.RemoteOperationServer;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Keeps real source preparation and claim production; only the loopback decision acknowledgement is scripted. */
public class RemoteDecisionJourneyResource implements QuarkusTestResourceLifecycleManager {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final GeneratedClaimRemoteOfferResource sources = new GeneratedClaimRemoteOfferResource();
    private RemoteOperationServer remote;
    private HttpServer control;
    private ExecutorService executor;

    @Override
    public Map<String, String> start() {
        try {
            Map<String, String> config = new HashMap<>(sources.start());
            seedFixtureClock(config);
            remote = RemoteOperationServer.start();
            control = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
            executor = Executors.newSingleThreadExecutor();
            control.setExecutor(executor);
            control.createContext("/", this::handle);
            control.start();
            config.put("gcsp.buddy.execute-url", remote.baseUrl() + "/execute");
            config.put("gcsp.buddy.reconcile-url", remote.baseUrl() + "/reconcile");
            config.put("gcsp.test.remote-decision.control-url", "http://127.0.0.1:" + control.getAddress().getPort());
            return config;
        } catch (Exception e) {
            try {
                stop();
            } catch (RuntimeException closing) {
                e.addSuppressed(closing);
            }
            throw new IllegalStateException("Could not start owned remote-decision journey resources", e);
        }
    }

    /** Keeps adoption and the retained PolicyClock fixture on the same explicit instant. */
    private static void seedFixtureClock(Map<String, String> config) throws Exception {
        JsonNode policy;
        try (InputStream input = RemoteDecisionJourneyResource.class.getResourceAsStream("/gcsp/policy/seed-v1.json")) {
            if (input == null) throw new IOException("Missing retained policy fixture");
            policy = JSON.readTree(input);
        }
        JsonNode scenario = null;
        JsonNode commands = null;
        for (JsonNode row : policy.path("assumptions")) {
            if ("clock.scenario.v1".equals(row.path("key").asText())) scenario = row.path("value");
            if ("clock.commands.v1".equals(row.path("key").asText())) commands = row.path("value");
        }
        if (scenario == null || commands == null) throw new IOException("Missing retained clock contract");
        Duration shift = Duration.between(Instant.parse(scenario.path("startsAt").asText()), DecisionEnv.NOW);
        ObjectNode named = JSON.createObjectNode();
        scenario.path("namedTimes").fields().forEachRemaining(entry -> named.put(entry.getKey(),
                Instant.parse(entry.getValue().asText()).plus(shift).toString()));
        var dataSource = OffersPg.plain(config.get("quarkus.datasource.jdbc.url"));
        dataSource.setCurrentSchema(config.get("quarkus.flyway.default-schema"));
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                        + "fixture_version, starts_at, named_times) VALUES (?, 'run-1', ?, ?, ?, ?, ?, ?::jsonb)")) {
            statement.setString(1, OffersPg.ENV);
            statement.setObject(2, OffsetDateTime.ofInstant(DecisionEnv.NOW, ZoneOffset.UTC));
            statement.setLong(3, commands.path("initialClockVersion").asLong());
            statement.setString(4, scenario.path("scenarioVersion").asText());
            statement.setString(5, scenario.path("fixtureVersion").asText());
            statement.setObject(6, OffsetDateTime.ofInstant(DecisionEnv.NOW, ZoneOffset.UTC));
            statement.setString(7, named.toString());
            statement.executeUpdate();
        }
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            if ("POST".equals(exchange.getRequestMethod()) && "/script".equals(exchange.getRequestURI().getPath())) {
                JsonNode input = JSON.readTree(exchange.getRequestBody());
                if (input.has("execute")) remote.onExecute(RemoteOperationServer.Execute.valueOf(input.get("execute").asText()));
                if (input.has("reconcile")) remote.onReconcile(RemoteOperationServer.Reconcile.valueOf(input.get("reconcile").asText()));
            } else if (!"GET".equals(exchange.getRequestMethod()) || !"/stats".equals(exchange.getRequestURI().getPath())) {
                respond(exchange, 404, JSON.createObjectNode());
                return;
            }
            ObjectNode stats = JSON.createObjectNode();
            ObjectNode operations = stats.putObject("operations");
            for (RemoteOperationServer.Request request : remote.requests()) {
                String id = request.operationId();
                ObjectNode operation = operations.withObject("/" + id.replace("~", "~0").replace("/", "~1"));
                operation.put("posts", remote.posts(id)).put("gets", remote.gets(id)).put("effects", remote.effects(id));
                if (request.type() != null) operation.put("type", request.type());
            }
            respond(exchange, 200, stats);
        } catch (IllegalArgumentException e) {
            throw new IOException("Invalid test script", e);
        }
    }

    private static void respond(HttpExchange exchange, int status, JsonNode body) throws IOException {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Override
    public void stop() {
        RuntimeException failure = null;
        if (control != null) {
            control.stop(0);
            control = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            try {
                if (!executor.awaitTermination(2, TimeUnit.SECONDS)) throw new IllegalStateException("Control executor did not stop");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                failure = new IllegalStateException("Interrupted while stopping test control", e);
            } catch (RuntimeException e) {
                failure = e;
            } finally {
                executor = null;
            }
        }
        try {
            if (remote != null) remote.close();
        } catch (RuntimeException e) {
            if (failure == null) failure = e;
            else failure.addSuppressed(e);
        } finally {
            remote = null;
        }
        try {
            sources.stop();
        } catch (RuntimeException e) {
            if (failure == null) failure = e;
            else failure.addSuppressed(e);
        }
        if (failure != null) throw failure;
    }
}
