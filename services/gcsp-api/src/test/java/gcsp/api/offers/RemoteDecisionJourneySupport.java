package gcsp.api.offers;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.Trigger;
import gcsp.api.allocation.BuddyJourneySupport;
import io.agroal.api.AgroalDataSource;
import jakarta.inject.Inject;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

abstract class RemoteDecisionJourneySupport {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String API = "/api/gcsp/v1";
    static final String EMPLOYEE = "employee-paula";
    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;
    @ConfigProperty(name = "gcsp.test.remote-decision.control-url")
    String controlUrl;
    @Inject
    AgroalDataSource dataSource;
    @Inject
    Allocation allocation;
    @Inject
    OfferDecisions decisions;
    String owner;
    String offerId;
    String policyVersion;

    void prepareOffer() throws Exception {
        owner = new BuddyJourneySupport(dataSource, signingJwk).token("sub-employee-a", "employee");
        JsonNode context = get(API + "/context").get("value");
        assertEquals(EMPLOYEE, context.path("employeeId").asText());
        policyVersion = context.path("policyVersion").asText();
        assertTrue(policyVersion.endsWith("+offer-journey-v1"));
        assertInstanceOf(AllocationResult.Completed.class, allocation.service().allocate(
                new AllocationScope(OffersPg.ENV, "run-1", policyVersion, DecisionEnv.NOW,
                        count("SELECT clock_version FROM run_clocks WHERE run_id = 'run-1'")),
                new Trigger("stock-released", "remote-decision-journey", List.of(), List.of())));
        offerId = text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", EMPLOYEE);
        assertEquals("pending", view().path("state").asText());
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'buddy-claim' AND state = 'acknowledged'"));
    }

    JsonNode view() throws Exception {
        return get(API + "/offers/" + offerId).get("value");
    }

    ObjectNode command(String id, String decision) throws Exception {
        JsonNode view = view();
        ObjectNode body = JSON.createObjectNode().put("commandId", id).put("decision", decision)
                .put("runId", view.path("runId").asText()).put("expectedQuoteVersion", 1)
                .put("expectedOfferVersion", view.path("offerVersion").asLong())
                .put("expectedHoldVersion", view.path("holdVersion").asLong());
        if ("accept".equals(decision)) {
            body.put("termsDigest", get(API + "/manual/order/terms").path("value").path("termsDigest").asText())
                    .put("expectedReturnMileage", 5400);
            body.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        } else {
            body.put("reasonCode", get(API + "/offers/" + offerId + "/decision-reasons")
                    .path("value").path("reasons").get(0).path("code").asText());
        }
        return body;
    }

    JsonNode post(ObjectNode command, int status) throws Exception {
        return JSON.readTree(given().header("Authorization", "Bearer " + owner).contentType("application/json")
                .body(command.toString()).post(API + "/offers/" + offerId + "/decision")
                .then().statusCode(status).extract().asString());
    }

    JsonNode get(String path) throws Exception {
        return JSON.readTree(given().header("Authorization", "Bearer " + owner).get(path)
                .then().statusCode(200).extract().asString());
    }

    JsonNode script(String execute, String reconcile) throws Exception {
        ObjectNode script = JSON.createObjectNode();
        if (execute != null) script.put("execute", execute);
        if (reconcile != null) script.put("reconcile", reconcile);
        return control("/script", script);
    }

    JsonNode stats(String operation) throws Exception {
        return control("/stats", null).path("operations").path(operation);
    }

    private JsonNode control(String path, JsonNode body) throws Exception {
        try (HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build()) {
            HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(controlUrl + path)).timeout(Duration.ofSeconds(3));
            if (body != null) request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString()));
            HttpResponse<String> response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, response.statusCode());
            return JSON.readTree(response.body());
        }
    }

    void pending(String operation, String custody, String lastKnown) throws Exception {
        String offerState = "selection-pending".equals(custody) ? "decision-pending" : "release-pending";
        JsonNode view = view();
        assertEquals("pending", view.path("state").asText());
        assertEquals(offerState, view.path("reason").asText());
        assertEquals(0, view.path("availableActions").size());
        assertEquals(custody, text("SELECT state FROM custody_holds"));
        assertEquals(offerState, text("SELECT state FROM buddy_offers"));
        assertEquals(lastKnown, text("SELECT outcome->>'lastKnownState' FROM pending_operations WHERE operation_id = ?", operation));
        assertEquals(0, count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
    }

    JsonNode originalReceipt(String command) throws Exception {
        return JSON.readTree(text("SELECT result::text FROM command_receipts WHERE command_id = ?",
                "offer-decision:" + offerId + ":" + command));
    }

    long count(String sql, Object... arguments) throws SQLException {
        return Long.parseLong(text(sql, arguments));
    }

    String text(String sql, Object... arguments) throws SQLException {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < arguments.length; i++) statement.setObject(i + 1, arguments[i]);
            try (ResultSet rows = statement.executeQuery()) {
                assertTrue(rows.next(), sql);
                return rows.getString(1);
            }
        }
    }
}
