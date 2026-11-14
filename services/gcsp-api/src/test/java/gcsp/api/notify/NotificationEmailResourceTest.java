package gcsp.api.notify;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.SQLException;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The employee's own notification email: read, set, replay, refusals and clearing. Needs GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(NotifyEmployeeProfile.class)
class NotificationEmailResourceTest {

    private static final String PATH = "/api/gcsp/v1/manual/notification-email";
    private static final String PRESENTER_PATH = "/api/gcsp/v1/presenter/outbox";
    private static final String AUTH = "Bearer " + NotifyEmployeeProfile.TOKEN;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @BeforeEach
    void employeeHasNoAddressYet() throws SQLException {
        if (!persistence.active()) return;
        RunContext run = NotifySeed.run(persistence);
        NotifySeed.employee(dataSource.get(), run, NotifyEmployeeProfile.EMPLOYEE_ID, "Alex Example");
        NotifySeed.clearRecipient(dataSource.get(), run, NotifyEmployeeProfile.EMPLOYEE_ID);
    }

    @Test
    void anEmployeeCannotReadThePresenterOutbox() {
        given().header("Authorization", AUTH).get(PRESENTER_PATH).then().statusCode(403)
                .body("code", equalTo("role-required"));
    }

    @Test
    void withoutARecordTheAddressIsNullAtVersionZero() {
        requireDatabase();
        given().header("Authorization", AUTH).get(PATH).then().statusCode(200)
                .body("status", equalTo("ok"))
                .body("value.deliveryEmail", nullValue())
                .body("value.version", equalTo(0));
    }

    @Test
    void aSetAddressIsReadBackAtVersionOne() {
        requireDatabase();
        post(body(NotifySeed.uniqueId("cmd-set"), 0, "alex@example.invalid")).then().statusCode(200)
                .body("status", equalTo("ok"))
                .body("value.deliveryEmail", equalTo("alex@example.invalid"))
                .body("value.version", equalTo(1));
        given().header("Authorization", AUTH).get(PATH).then().statusCode(200)
                .body("value.deliveryEmail", equalTo("alex@example.invalid"))
                .body("value.version", equalTo(1));
    }

    @Test
    void aReplayOfTheSameCommandAndBodyReturnsTheSameResult() {
        requireDatabase();
        String json = body(NotifySeed.uniqueId("cmd-replay"), 0, "replay@example.invalid");
        post(json).then().statusCode(200).body("value.version", equalTo(1));
        post(json).then().statusCode(200)
                .body("value.deliveryEmail", equalTo("replay@example.invalid"))
                .body("value.version", equalTo(1));
    }

    @Test
    void aReusedCommandIdWithADifferentBodyIsRefused() {
        requireDatabase();
        String commandId = NotifySeed.uniqueId("cmd-changed");
        post(body(commandId, 0, "first@example.invalid")).then().statusCode(200);
        post(body(commandId, 0, "second@example.invalid")).then().statusCode(409)
                .body("status", equalTo("conflict"))
                .body("code", equalTo("command-input-changed"));
    }

    @Test
    void aStaleExpectedVersionIsRefused() {
        requireDatabase();
        post(body(NotifySeed.uniqueId("cmd-stale"), 3, "stale@example.invalid")).then().statusCode(409)
                .body("status", equalTo("conflict"))
                .body("code", equalTo("stale-version"));
    }

    @Test
    void invalidRequestsReturnTheReasonsBody() {
        requireDatabase();
        String commandId = NotifySeed.uniqueId("cmd-bad");
        post(body(commandId, 0, "not-an-email")).then().statusCode(400)
                .body("status", equalTo("invalid"))
                .body("code", equalTo("notification-email-invalid"))
                .body("reasons[0].field", equalTo("deliveryEmail"))
                .body("reasons[0].reason", equalTo(
                        "Enter a valid email address, or clear it to stop email notifications."));
        post("{\"commandId\":\"" + commandId + "\",\"expectedVersion\":0,\"deliveryEmail\":null,\"role\":\"employee\"}")
                .then().statusCode(400).body("code", equalTo("notification-email-invalid"));
        post("{\"commandId\":").then().statusCode(400).body("code", equalTo("notification-email-invalid"));
        given().header("Authorization", AUTH).queryParam("employeeId", "E-9999").get(PATH).then().statusCode(400)
                .body("code", equalTo("notification-email-invalid"))
                .body("reasons[0].field", equalTo("deliveryEmail"));
    }

    @Test
    void clearingWithNullStopsEmailAndAdvancesTheVersion() {
        requireDatabase();
        post(body(NotifySeed.uniqueId("cmd-clear-a"), 0, "clear@example.invalid")).then().statusCode(200)
                .body("value.version", equalTo(1));
        post(body(NotifySeed.uniqueId("cmd-clear-b"), 1, null)).then().statusCode(200)
                .body("value.deliveryEmail", nullValue())
                .body("value.version", equalTo(2));
        given().header("Authorization", AUTH).get(PATH).then().statusCode(200)
                .body("value.deliveryEmail", nullValue())
                .body("value.version", equalTo(2));
    }

    private void requireDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    private static io.restassured.response.Response post(String json) {
        return given().header("Authorization", AUTH).contentType("application/json").body(json).post(PATH);
    }

    /** A JSON body with exactly the three fields; the values here are fixed test strings with no quotes. */
    private static String body(String commandId, long expectedVersion, String deliveryEmail) {
        String email = deliveryEmail == null ? "null" : "\"" + deliveryEmail + "\"";
        return "{\"commandId\":\"" + commandId + "\",\"expectedVersion\":" + expectedVersion
                + ",\"deliveryEmail\":" + email + "}";
    }
}
