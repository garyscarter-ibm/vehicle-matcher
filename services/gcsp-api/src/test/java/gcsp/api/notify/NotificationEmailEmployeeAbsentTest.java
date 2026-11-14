package gcsp.api.notify;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** An employee the run has no record of gets a truthful 404, on read and on write. Needs GCSP_TEST_DATABASE_URL. */
@QuarkusTest
@TestProfile(NotifyUnseededEmployeeProfile.class)
class NotificationEmailEmployeeAbsentTest {

    private static final String PATH = "/api/gcsp/v1/manual/notification-email";
    private static final String AUTH = "Bearer " + NotifyUnseededEmployeeProfile.TOKEN;

    @Inject
    Persistence persistence;

    @Test
    void readingWithoutAnEmployeeRecordIsNotFound() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        given().header("Authorization", AUTH).get(PATH).then().statusCode(404)
                .body("code", equalTo("employee-not-found"))
                .body("reason", equalTo("Your employee record is not available."));
    }

    @Test
    void writingWithoutAnEmployeeRecordIsNotFound() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        given().header("Authorization", AUTH).contentType("application/json")
                .body("{\"commandId\":\"cmd-absent\",\"expectedVersion\":0,\"deliveryEmail\":null}")
                .post(PATH).then().statusCode(404).body("code", equalTo("employee-not-found"));
    }
}
