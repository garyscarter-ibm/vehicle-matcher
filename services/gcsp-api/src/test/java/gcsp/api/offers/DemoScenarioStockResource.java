package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySeed;
import gcsp.api.policy.PolicyClock;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;

/** One migrated schema holding only upstream supply (environment, run, unreleased cars, plan); no person is seeded. */
public class DemoScenarioStockResource implements QuarkusTestResourceLifecycleManager {

    private static final ObjectMapper JSON = new ObjectMapper();
    private String url;
    private String schema;
    private Path dir;

    @Override
    public Map<String, String> start() {
        url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalStateException("GCSP_TEST_DATABASE_URL is required");
        try {
            schema = "gcsp_d_" + Long.toHexString(System.nanoTime());
            String tmp = System.getenv("TMPDIR");
            dir = Files.createTempDirectory(Path.of(tmp != null && !tmp.isBlank() ? tmp : System.getProperty("java.io.tmpdir")),
                    "demo-scenario-");
            Path plan = dir.resolve("tranche-plan.json");
            JsonNode rows = fixture().path("cases").get(0).path("rows");
            Files.writeString(plan, plan(rows));
            Flyway.configure().dataSource(plain()).schemas(schema).defaultSchema(schema).createSchemas(true)
                    .locations("classpath:db/migration").load().migrate();
            PGSimpleDataSource ds = plain();
            ds.setCurrentSchema(schema);
            try (Connection c = ds.getConnection()) {
                update(c, "INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", BuddyJourneySeed.ENV);
                update(c, "INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", BuddyJourneySeed.ENV,
                        BuddyJourneySeed.RUN);
                for (int i = 0; i < 2; i++) car(c, rows.get(i));
            }
            Map<String, String> config = new HashMap<>();
            config.put("quarkus.datasource.active", "true");
            config.put("quarkus.flyway.active", "true");
            config.put("quarkus.datasource.jdbc.url", url);
            config.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            config.put("quarkus.flyway.schemas", schema);
            config.put("quarkus.flyway.default-schema", schema);
            config.put("gcsp.supply.tranche-plan-file", plan.toAbsolutePath().toString());
            return config;
        } catch (Exception e) {
            RuntimeException cleanup = close();
            if (cleanup != null) e.addSuppressed(cleanup);
            throw new IllegalStateException("Demo scenario stock resource failed to start", e);
        }
    }

    @Override
    public void stop() {
        RuntimeException failure = close();
        if (failure != null) throw failure;
    }

    /** Both cars are released in one window that opened yesterday. */
    private static String plan(JsonNode rows) {
        Instant wall = Instant.now();
        ObjectNode plan = JSON.createObjectNode().put("label", "TEST FIXTURE demo scenario plan; not stock evidence")
                .put("version", "demo-scenario-remote-ordering-v1");
        ObjectNode window = plan.putArray("windows").addObject().put("windowId", "demo-w1")
                .put("availableAt", PolicyClock.iso(wall.minus(1, ChronoUnit.DAYS)));
        window.putNull("supplyId");
        ArrayNode stock = window.putArray("stock");
        for (int i = 0; i < 2; i++) {
            JsonNode row = rows.get(i);
            ObjectNode car = stock.addObject().put("orderUuid", row.path("orderUuid").asText())
                    .put("orderNumber", row.path("orderNumber").asText())
                    .put("configurationId", row.path("configurationId").asText());
            car.putObject("availability").put("availableUntil", PolicyClock.iso(wall.plus(400, ChronoUnit.DAYS)));
        }
        return plan.toString();
    }

    private void car(Connection c, JsonNode row) throws SQLException {
        ObjectNode attributes = row.deepCopy();
        attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version",
                "release"));
        update(c, "INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes, version) "
                + "VALUES (?, ?, ?, ?, 'unreleased', ?::jsonb, 1)", BuddyJourneySeed.ENV, BuddyJourneySeed.RUN,
                row.path("orderUuid").asText(), row.path("configurationId").asText(), attributes.toString());
    }

    private static void update(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    private static JsonNode fixture() throws IOException {
        try (InputStream in = DemoScenarioStockResource.class.getResourceAsStream("/recommendation-source/source-cases.json")) {
            if (in == null) throw new IOException("Missing retained fixture");
            return JSON.readTree(in);
        }
    }

    private PGSimpleDataSource plain() {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    private RuntimeException close() {
        RuntimeException failure = null;
        if (dir != null) {
            try (var files = Files.list(dir)) {
                for (Path p : files.toList()) Files.deleteIfExists(p);
                Files.deleteIfExists(dir);
            } catch (IOException e) {
                failure = new IllegalStateException("Could not remove the plan directory", e);
            }
            dir = null;
        }
        if (schema != null && url != null) {
            try (Connection c = plain().getConnection(); var st = c.createStatement()) {
                st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            } catch (Exception e) {
                if (failure == null) failure = new IllegalStateException("Could not drop the demo scenario schema", e);
                else failure.addSuppressed(e);
            }
            schema = null;
        }
        return failure;
    }
}
