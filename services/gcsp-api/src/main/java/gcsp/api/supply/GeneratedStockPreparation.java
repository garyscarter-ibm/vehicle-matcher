package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Inspection;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyClock;
import gcsp.api.scenario.DemoPreparationFile;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;

/** Atomically prepares native generated stock before any release command can see it. */
public final class GeneratedStockPreparation {
    static final String ACTOR = "system:stock-generation";
    static final String COMMAND = "stock:generate";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();
    private final DataSource source;
    private final String environmentId;
    private final GeneratedStockInputs inputs;
    private final TransactionRunner runner;

    public GeneratedStockPreparation(DataSource source, String environmentId, GeneratedStockInputs inputs) {
        if (source == null || environmentId == null || environmentId.isBlank() || inputs == null) {
            throw new IllegalArgumentException("Generated stock needs the database, environment and immutable input loader.");
        }
        this.source = source;
        this.environmentId = environmentId;
        this.inputs = inputs;
        this.runner = new TransactionRunner(source);
    }

    public ClockResult prepare(RunContext run, String policyVersion, Instant clock, JsonNode scenario, JsonNode tranche) {
        if (run == null || !environmentId.equals(run.environmentId()) || policyVersion == null || clock == null) {
            return ClockResult.invalid("invalid-stock-generation", "Supply the run, pinned policy and clock.");
        }
        RunContext scope = scope(run.runId());
        ObjectNode pins = F.objectNode().put("runId", run.runId()).put("seed", "gcsp-demo-stock-v1")
                .put("policyVersion", policyVersion).put("clockInstant", PolicyClock.iso(clock))
                .put("stockAccount", "gcsp-demo-scheme-stock");
        pins.put("scenarioDigest", Canonical.digest(scenario));
        pins.put("trancheDigest", Canonical.digest(tranche));
        try {
            if (!active(run.runId())) return ClockResult.staleRun();
            Inspection previous = runner.inspect(scope, COMMAND);
            if (previous instanceof Inspection.Committed committed) {
                if (!pins.equals(committed.result().path("pins"))) {
                    return ClockResult.conflict("command-input-changed", "The generation command has different input.", null);
                }
                return answer(committed.result(), true);
            }
            if (previous instanceof Inspection.Unavailable) return unavailable("database-unavailable");
            JsonNode loaded = inputs.load(run.runId(), policyVersion, clock, scenario, tranche);
            if (loaded.has("status")) return unavailable(loaded.path("code").asText("stock-inputs-unavailable"));
            ObjectNode request = loaded.deepCopy();
            Outcome outcome = runner.execute(scope, new Command("stock.generate", COMMAND, pins), tx -> {
                // One authority for synthetic identities across all retained generated runs in this environment.
                tx.first("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> true,
                        environmentId + ":generated-stock-identities");
                var raced = tx.first("SELECT result::text FROM command_receipts WHERE environment_id = ? "
                        + "AND run_id = ? AND actor_id = ? AND command_id = ?", rs -> json(rs.getString(1)),
                        environmentId, run.runId(), ACTOR, COMMAND);
                if (raced.isPresent()) return WorkResult.ok(raced.get());
                request.set("inventory", inventory(tx));
                JsonNode generation = GeneratedStockGenerator.generate(request);
                if (!"ok".equals(generation.path("status").asText())) {
                    return WorkResult.refuse(generation.path("code").asText("stock-generation-unavailable"),
                            "Generated stock could not be prepared.");
                }
                JsonNode value = generation.path("value");
                JsonNode rows = value.path("rows");
                if (!rows.isArray() || rows.isEmpty() || !value.path("report").isObject()) {
                    return WorkResult.refuse("invalid-stock-generation", "Generation did not return complete stock and a report.");
                }
                Map<String, JsonNode> identities = new HashMap<>();
                for (JsonNode identity : value.path("inventory").path("records")) {
                    if (run.runId().equals(identity.path("runId").asText())) {
                        identities.put(identity.path("orderUuid").asText(), identity);
                    }
                }
                ArrayNode batch = F.arrayNode();
                for (JsonNode row : rows) {
                    JsonNode identity = identities.get(row.path("orderUuid").asText());
                    if (!row.isObject() || identity == null || !row.path("configurationId").isTextual()
                            || !GeneratedSupplyProvider.NAMESPACE.equals(row.path("facts").path("sourceNamespace").asText())) {
                        return WorkResult.refuse("invalid-stock-generation", "An exact generated identity is missing.");
                    }
                    ObjectNode stored = row.deepCopy();
                    stored.set("generatedIdentity", identity.deepCopy());
                    batch.add(stored);
                }
                int inserted = tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, "
                        + "state, attributes) SELECT ?, ?, car->>'orderUuid', car->>'configurationId', 'unreleased', "
                        + "car - 'orderUuid' - 'configurationId' - 'state' - 'status' - 'available' "
                        + "FROM jsonb_array_elements(?::jsonb) car", environmentId, run.runId(), batch);
                if (inserted != rows.size()) throw new SQLException("Incomplete generated-stock insert");
                ObjectNode result = F.objectNode().put("generated", true).put("rowCount", inserted)
                        .put("rowBytes", Canonical.json(rows).getBytes(java.nio.charset.StandardCharsets.UTF_8).length);
                result.set("pins", pins);
                ObjectNode content = request.deepCopy();
                content.remove("inventory");
                result.put("requestDigest", Canonical.digest(content));
                result.set("report", value.get("report").deepCopy());
                return WorkResult.ok(result);
            });
            if (outcome instanceof Outcome.Committed committed) return answer(committed.result(), committed.replayed());
            if (outcome instanceof Outcome.Conflict conflict) {
                if ("stale-run".equals(conflict.code())) return ClockResult.staleRun();
                return ClockResult.conflict(conflict.code(), conflict.message(), null);
            }
            if (outcome instanceof Outcome.Uncertain uncertain) return ClockResult.uncertain(uncertain.operationId());
            return unavailable(outcome instanceof Outcome.Refused refused ? refused.code() : "stock-generation-unavailable");
        } catch (SQLException | RuntimeException failure) {
            return unavailable("stock-generation-unavailable");
        }
    }

    /** Existing generated rows are authoritative even when the original source is temporarily unavailable. */
    ClockResult ensure(PullRequest request) throws SQLException {
        if (!active(request.runId())) return ClockResult.staleRun();
        Inspection previous = runner.inspect(scope(request.runId()), COMMAND);
        if (previous instanceof Inspection.Committed committed) return answer(committed.result(), true);
        if (previous instanceof Inspection.Unavailable) return unavailable("database-unavailable");
        JsonNode scenario = scenario(request.runId());
        JsonNode tranche = generatedTranche(scenario);
        return prepare(scope(request.runId()), request.policyVersion(), request.asOf(), scenario, tranche);
    }

    boolean active(String runId) throws SQLException {
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT 1 FROM runs WHERE environment_id = ? AND run_id = ? AND status = 'active'")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
        }
    }

    boolean publishedDemo(String runId) throws SQLException {
        JsonNode scenario = scenario(runId);
        if (scenario != null) for (JsonNode tranche : scenario.path("inputs").path("stockTranches")) {
            if ("published-demo-stock".equals(tranche.path("source").asText())) return true;
        }
        return false;
    }

    private JsonNode scenario(String runId) throws SQLException {
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT scenario_id FROM scenario_runs WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? DemoPreparationFile.load().scenario(rs.getString(1)).orElse(null) : null;
            }
        }
    }

    static JsonNode generatedTranche(JsonNode scenario) {
        if (scenario != null) for (JsonNode tranche : scenario.path("inputs").path("stockTranches")) {
            if ("generated-stock".equals(tranche.path("source").asText())) return tranche;
        }
        return null;
    }

    ArrayNode rows(String runId) throws SQLException {
        ArrayNode rows = F.arrayNode();
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT order_uuid, configuration_id, attributes::text FROM stock_cars "
                        + "WHERE environment_id = ? AND run_id = ? AND attributes->'generatedIdentity' IS NOT NULL "
                        + "ORDER BY attributes->>'orderNumber', order_uuid")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    ObjectNode row = json(rs.getString(3)).deepCopy();
                    row.put("orderUuid", rs.getString(1)).put("configurationId", rs.getString(2));
                    rows.add(row);
                }
            }
        }
        return rows;
    }

    private ObjectNode inventory(Tx tx) throws SQLException {
        ObjectNode inventory = F.objectNode().put("schemaVersion", "1")
                .put("generatorVersion", "synthetic-identities.sha256-v1");
        inventory.put("revision", tx.first("SELECT count(*) FROM command_receipts WHERE environment_id = ? "
                + "AND actor_id = ? AND command_type = 'stock.generate'", rs -> rs.getLong(1), environmentId, ACTOR).orElse(0L));
        inventory.putObject("limits").put("maxAttempts", 1000).put("serialSpace", 1_000_000)
                .put("orderNumberSpace", 10_000_000).put("wholesalerSpace", 90_000_000);
        List<JsonNode> records = new ArrayList<>();
        try (PreparedStatement ps = tx.connection().prepareStatement("SELECT attributes->'generatedIdentity' "
                + "FROM stock_cars WHERE environment_id = ? AND attributes->'generatedIdentity' IS NOT NULL")) {
            ps.setString(1, environmentId);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) records.add(json(rs.getString(1))); }
        }
        records.sort(Comparator.comparing(row -> F.arrayNode().add(row.path("runId").asText())
                .add(row.path("vehicleId").asText()).toString()));
        ArrayNode ordered = inventory.putArray("records");
        records.forEach(ordered::add);
        inventory.put("contentDigest", Canonical.digest(inventory));
        return inventory;
    }

    private RunContext scope(String runId) { return new RunContext(environmentId, runId, ACTOR); }

    private static ClockResult answer(JsonNode stored, boolean replayed) {
        ObjectNode result = stored.deepCopy();
        result.put("generated", !replayed);
        return ClockResult.ok(result);
    }

    private static JsonNode json(String text) throws SQLException {
        try { return JSON.readTree(text); } catch (java.io.IOException failure) { throw new SQLException("Invalid generated stock JSON"); }
    }

    private static ClockResult unavailable(String code) {
        return ClockResult.unavailable(code, "Generated stock is unavailable.", true);
    }
}
