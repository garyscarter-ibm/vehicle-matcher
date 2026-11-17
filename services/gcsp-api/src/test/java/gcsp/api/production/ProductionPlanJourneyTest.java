package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.RESPONSES;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.count;
import static gcsp.api.production.ProductionHttpSupport.scriptBody;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/**
 * The acceptance journey over the started app: real RS256 tokens, native PostgreSQL, the real plan port and the real
 * order-plan history. Only the planner's demand and stock inputs are test beans. One plan can be sent once per run,
 * so the whole story is one ordered test.
 */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.Journey.class)
class ProductionPlanJourneyTest {

    private static final String PLAN_PATH = "/api/gcsp/v1/greg/order-plan";
    private static final ObjectMapper JSON = new ObjectMapper();

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    PlanSnapshotPort plans;

    @Inject
    gcsp.api.planning.SubmissionHistory history;

    @Inject
    ProductionPlanPorts.Inputs inputs;

    @AfterAll
    static void dropSchema() throws SQLException {
        if (ProductionHttpProfiles.URL == null) return;
        try (Connection c = java.sql.DriverManager.getConnection(ProductionHttpProfiles.URL);
                java.sql.Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ProductionHttpProfiles.Journey.SCHEMA + " CASCADE");
        }
    }

    @Test
    void theRealPlanIsSubmittedConfirmedAndReplannedOverHttp() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        assertTrue(ClientProxy.unwrap(plans) instanceof PlanningPlanSnapshot, "the real plan port must be bound");
        assertTrue(ClientProxy.unwrap(history) instanceof ProductionSubmissionHistory, "the real history must be bound");
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
        String greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        String presenter = ProductionHttpSupport.token(jwk, "sub-presenter", "presenter");
        String employee = ProductionHttpSupport.token(jwk, "sub-employee", "employee");

        // Greg's plan before any submission.
        JsonPath read = JsonPath.from(as(greg).get(PLAN_PATH).then().statusCode(200).extract().asString());
        assertEquals("feasible", read.getString("value.plan.status"));
        assertEquals("no-submission", read.getString("value.replan.status"));
        String planId = read.getString("value.plan.planId");
        Map<String, String> versions = new LinkedHashMap<>(read.getMap("value.plan.versions"));
        assertFalse(versions.isEmpty());
        Map<String, Integer> planned = new LinkedHashMap<>();
        for (Map<String, Object> q : read.<Map<String, Object>>getList("value.plan.quantities")) {
            int n = ((Number) q.get("quantity")).intValue();
            if (n > 0) planned.put((String) q.get("derivativeId"), n);
        }
        assertTrue(planned.containsKey(ProductionPlanPorts.SALOON_330E), "the fixture demand orders a 330e: " + planned);
        assertTrue(planned.size() >= 2, "a supported line is needed too: " + planned);

        // An employee cannot submit.
        String body = body(command(), planId, versions);
        as(employee).body(body).post(REQUESTS).then().statusCode(403);
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM production_requests"));

        // Greg submits exactly that plan.
        String commandId = command();
        String submit = body(commandId, planId, versions);
        JsonPath sent = JsonPath.from(as(greg).body(submit).post(REQUESTS).then().statusCode(200).extract().asString());
        assertEquals("ok", sent.getString("status"));
        List<Map<String, Object>> lines = sent.getList("value.requests");
        assertEquals(planned.size(), lines.size());
        Map<String, Map<String, Object>> byLine = new LinkedHashMap<>();
        lines.forEach(l -> byLine.put((String) l.get("lineId"), l));
        assertEquals(planned.keySet(), byLine.keySet());
        Map<String, JsonNode> catalogue = catalogue();
        for (var e : planned.entrySet()) {
            Map<String, Object> line = byLine.get(e.getKey());
            assertEquals(e.getValue().intValue(), ((Number) line.get("quantity")).intValue());
            assertEquals(catalogue.get(e.getKey()).get("model").asText(), line.get("model"));
            assertEquals(catalogue.get(e.getKey()).get("derivative").asText(), line.get("derivative"));
        }
        assertEquals("refused", byLine.get(ProductionPlanPorts.SALOON_330E).get("state"));
        String supported = null;
        int supportedQuantity = 0;
        for (var l : byLine.entrySet()) {
            if (!ProductionPlanPorts.SALOON_330E.equals(l.getKey())) {
                assertEquals("requested", l.getValue().get("state"));
                supported = (String) l.getValue().get("requestId");
                supportedQuantity = ((Number) l.getValue().get("quantity")).intValue();
            }
        }
        assertNotNull(supported);

        // The rows are durable, with the same numbers.
        assertEquals(planned.size(), count(dataSource.get(), "SELECT count(*) FROM production_requests"));
        List<String> rows = rows();
        for (var e : planned.entrySet()) {
            JsonNode m = catalogue.get(e.getKey());
            String expect = e.getKey() + "|" + m.get("model").asText() + "|" + m.get("derivative").asText() + "|" + e.getValue();
            assertTrue(rows.contains(expect), expect + " not in " + rows);
        }

        // A retry is the same submission and sends nothing again.
        long orders = count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders");
        assertTrue(orders >= 1);
        as(greg).body(submit).post(REQUESTS).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.submissionId", equalTo(sent.getString("value.submissionId")));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
        assertEquals(planned.size(), count(dataSource.get(), "SELECT count(*) FROM production_requests"));

        // Stock changed since the preview: a new command with the old versions is refused and writes nothing.
        inputs.stockVersion("stock-v2");
        long submissions = count(dataSource.get(), "SELECT count(*) FROM production_submissions");
        as(greg).body(body(command(), planId, versions)).post(REQUESTS).then().statusCode(409)
                .body("code", equalTo("replan-needed")).body("changedInputs", hasItem("stock"));
        assertEquals(submissions, count(dataSource.get(), "SELECT count(*) FROM production_submissions"));
        assertEquals(orders, count(dataSource.get(), "SELECT count(*) FROM production_synthetic_orders"));
        inputs.stockVersion("stock-v1");

        // The refused 330e line is an answer already, so the read shows the replan with only that refusal behind it.
        JsonPath early = JsonPath.from(as(greg).get(PLAN_PATH).then().statusCode(200).extract().asString());
        assertEquals("replanned", early.getString("value.replan.status"));
        assertEquals(List.of("refused"), early.getList("value.replan.responses.state"));

        // Later, the presenter scripts Production's confirmation of the supported line.
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
        as(presenter).body(scriptBody(supported, "confirm", supportedQuantity)).post(RESPONSES).then().statusCode(200);
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM confirmed_supply_queue c JOIN production_confirmations p "
                + "ON p.supply_id = c.supply_id AND p.run_id = c.run_id WHERE p.request_id = ?", supported));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                + "AND payload->>'requestId' = ?", supported));

        // Greg's order-plan read now reports the replan.
        JsonPath after = JsonPath.from(as(greg).get(PLAN_PATH).then().statusCode(200).extract().asString());
        assertEquals("replanned", after.getString("value.replan.status"));
        assertEquals(planId, after.getString("value.replan.submittedPlanId"));
        assertNotNull(after.getString("value.replan.currentPlanId"));
        assertEquals(after.getString("value.plan.planId"), after.getString("value.replan.currentPlanId"));
        assertEquals(planned.size(), after.getList("value.replan.requests").size());
        assertEquals(2, after.getList("value.replan.responses").size());
        assertEquals("confirmed", after.getString("value.replan.after.state"));
    }

    private static String body(String commandId, String planId, Map<String, String> versions) throws Exception {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("commandId", commandId);
        m.put("planId", planId);
        m.put("versions", versions);
        return JSON.writeValueAsString(m);
    }

    /** derivativeId to its Production names, from the seed policy's catalogue. */
    private static Map<String, JsonNode> catalogue() throws Exception {
        JsonNode seed = JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of("../../server/gcsp/policy/seed-v1.json")));
        Map<String, JsonNode> out = new LinkedHashMap<>();
        collect(seed, out);
        assertFalse(out.isEmpty());
        return out;
    }

    private static void collect(JsonNode node, Map<String, JsonNode> out) {
        if (node.isObject()) {
            JsonNode derivatives = node.get("derivatives");
            if (derivatives != null && derivatives.isArray() && derivatives.size() > 0 && derivatives.get(0).has("production")) {
                derivatives.forEach(d -> out.put(d.get("derivativeId").asText(), d.get("production")));
            }
            node.elements().forEachRemaining(n -> collect(n, out));
        } else if (node.isArray()) {
            node.forEach(n -> collect(n, out));
        }
    }

    private List<String> rows() throws SQLException {
        List<String> out = new ArrayList<>();
        try (Connection c = dataSource.get().getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT line_id, model, derivative, quantity FROM production_requests");
                ResultSet rs = ps.executeQuery()) {
            while (rs.next()) out.add(rs.getString(1) + "|" + rs.getString(2) + "|" + rs.getString(3) + "|" + rs.getInt(4));
        }
        return out;
    }
}
