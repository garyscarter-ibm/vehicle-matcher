package gcsp.api.notify;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.hamcrest.Matchers.equalTo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.SQLException;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Presenter access to the outbox, its refusals, and the drain's wiring. Database tests need GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(NotifyPresenterProfile.class)
class PresenterOutboxResourceTest {

    private static final String PATH = "/api/gcsp/v1/presenter/outbox";
    private static final String EMPLOYEE_PATH = "/api/gcsp/v1/manual/notification-email";
    private static final String AUTH = "Bearer " + NotifyPresenterProfile.TOKEN;
    private static final String ADDRESS = "private.person@example.invalid";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    Notifications notifications;

    @Inject
    NotificationDrain drain;

    @Test
    void withoutABearerTheOutboxIsUnauthorized() {
        given().when().get(PATH).then().statusCode(401).body("code", equalTo("bearer-missing"));
    }

    @Test
    void anyQueryParameterIsRefused() {
        given().header("Authorization", AUTH).queryParam("employeeId", "E-1001").get(PATH).then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
    }

    @Test
    void theOutboxIsReadOnly() {
        int status = given().header("Authorization", AUTH).post(PATH).then().extract().statusCode();
        assertNotEquals(200, status);
    }

    @Test
    void thePresenterCannotReadAnEmployeeNotificationEmail() {
        given().header("Authorization", AUTH).get(EMPLOYEE_PATH).then().statusCode(403)
                .body("code", equalTo("role-required"));
        given().header("Authorization", AUTH).contentType("application/json")
                .body("{\"commandId\":\"c\",\"expectedVersion\":0,\"deliveryEmail\":null}")
                .post(EMPLOYEE_PATH).then().statusCode(403).body("code", equalTo("role-required"));
    }

    @Test
    void presenterSeesSafeFieldsAndNeverTheAddress() throws Exception {
        requireDatabase();
        RunContext run = NotifySeed.run(persistence);
        String employeeId = NotifySeed.uniqueId("E-P");
        AgroalDataSource ds = dataSource.get();
        NotifySeed.employee(ds, run, employeeId, "Alex Example");
        NotifySeed.recipientAddress(ds, run, employeeId, ADDRESS);
        String offerId = NotifySeed.uniqueId("offer");
        String eventId = NotifySeed.offer(persistence, offerId, employeeId);
        NotifySeed.delivered(ds, run, eventId, message(employeeId, offerId));

        String raw = given().header("Authorization", AUTH).get(PATH).then().statusCode(200)
                .body("status", equalTo("ok")).body("value.runId", equalTo("run-1")).extract().asString();

        assertFalse(raw.contains(ADDRESS), "the outbox must never carry a delivery address");
        assertFalse(raw.contains("deliveryEmail"));
        assertFalse(raw.contains("payload"));
        assertFalse(raw.contains("provider"));
        JsonNode row = find(raw, eventId);
        assertNotNull(row, "the seeded notification is listed");
        assertEquals("sent", row.path("state").asText());
        assertEquals("captured", row.path("transport").asText());
        assertEquals("Your offer is ready", row.path("subject").asText());
        assertEquals("/gcsp/offers/" + offerId, row.path("offerLink").asText());
        assertEquals(employeeId, row.path("recipient").path("employeeId").asText());
        assertEquals("Alex Example", row.path("recipient").path("name").asText());
    }

    @Test
    void drainLeavesNotificationsPendingWhileRulesAreUnbound() throws SQLException {
        requireDatabase();
        RunContext run = NotifySeed.run(persistence);
        AgroalDataSource ds = dataSource.get();
        String employeeId = NotifySeed.uniqueId("E-D");
        NotifySeed.employee(ds, run, employeeId, "Drain Example");
        String eventId = NotifySeed.offer(persistence, NotifySeed.uniqueId("offer"), employeeId);

        drain.drainNow();

        assertInstanceOf(DispatchResult.Unavailable.class, notifications.dispatcher().dispatchPending());
        assertEquals("pending", NotifySeed.text(ds,
                "SELECT state FROM outbox_events WHERE environment_id = ? AND run_id = ? AND event_id = ?",
                run.environmentId(), run.runId(), eventId));
        assertEquals("0", NotifySeed.text(ds,
                "SELECT count(*) FROM notification_deliveries WHERE environment_id = ? AND run_id = ? AND event_id = ?",
                run.environmentId(), run.runId(), eventId));
    }

    private void requireDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    private static JsonNode find(String raw, String jobId) throws java.io.IOException {
        for (JsonNode row : JSON.readTree(raw).path("value").path("messages")) {
            if (jobId.equals(row.path("jobId").asText())) return row;
        }
        return null;
    }

    private static OfferMessage message(String employeeId, String offerId) {
        return new OfferMessage(new OfferMessage.Recipient(employeeId, "Alex Example"), "Your offer is ready",
                "Your offer is ready. Open it: /gcsp/offers/" + offerId, "<p>Your offer is ready</p>",
                "/gcsp/offers/" + offerId, null);
    }
}
