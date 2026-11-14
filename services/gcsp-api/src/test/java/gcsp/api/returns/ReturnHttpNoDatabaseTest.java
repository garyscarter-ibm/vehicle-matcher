package gcsp.api.returns;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** Without persistence every operation answers 503 persistence-not-configured, as JSON, and readiness stays UP. */
@QuarkusTest
@TestProfile(ReturnHttpProfiles.NoDatabase.class)
class ReturnHttpNoDatabaseTest {

    private static io.restassured.specification.RequestSpecification employee() {
        return given().header("Authorization", "Bearer returns-token").contentType("application/json");
    }

    @Test
    void everyOperationIsUnavailableAsJson() {
        employee().queryParam("orderUuid", "o-1").get("/api/gcsp/v1/return-plan").then().statusCode(503)
                .contentType(containsString("application/json")).body("status", equalTo("unavailable"))
                .body("code", equalTo("persistence-not-configured")).body("retryable", equalTo(false));
        employee().body("{\"commandId\":\"c\",\"orderUuid\":\"o-1\",\"choice\":\"same-visit\",\"slotId\":\"s\","
                + "\"expectedVersion\":0}").post("/api/gcsp/v1/return-plan/request").then().statusCode(503)
                .body("code", equalTo("persistence-not-configured"));
    }

    @Test
    void readinessIsUpAndReportsNoAdapters() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'returns' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'returns' }.data.provider", equalTo("none"));
    }
}
