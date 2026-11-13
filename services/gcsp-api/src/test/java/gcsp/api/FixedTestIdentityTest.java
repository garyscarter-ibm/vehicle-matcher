package gcsp.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Contract shape for GET /api/gcsp/v1/context with the test-only principal. */
@QuarkusTest
@TestProfile(FixedTestIdentityProfile.class)
class FixedTestIdentityTest {

    @Test
    void validTokenReturnsTheContractShape() {
        Map<String, Object> body = given().header("Authorization", "Bearer " + FixedTestIdentityProfile.TOKEN)
                .when().get("/api/gcsp/v1/context").then()
                .statusCode(200)
                .contentType(containsString("application/json"))
                .body(not(containsString(FixedTestIdentityProfile.TOKEN)))
                .extract().jsonPath().getMap("$");
        org.junit.jupiter.api.Assertions.assertEquals(Map.of(
                "status", "ok",
                "value", Map.of(
                        "subject", "test-provider-subject",
                        "roles", List.of("employee"),
                        "environmentId", "isolated-dev",
                        "runId", "server-current-run",
                        "employeeId", "server-mapped-id",
                        "policyVersion", "retained-version",
                        "capabilities", List.of("account:read"))), body);
    }

    @Test
    void wrongTokenIs401Json() {
        given().header("Authorization", "Bearer forged").when().get("/api/gcsp/v1/context").then()
                .statusCode(401)
                .contentType(containsString("application/json"))
                .body("status", equalTo("unauthenticated"))
                .body("code", equalTo("bearer-invalid"));
    }

    @Test
    void unmappedSubjectIsTypedRefusalNotSyntheticEmployee() {
        given().header("Authorization", "Bearer " + FixedTestIdentityProfile.UNMAPPED)
                .when().get("/api/gcsp/v1/context").then()
                .statusCode(403)
                .contentType(containsString("application/json"))
                .body("status", equalTo("forbidden"))
                .body("code", equalTo("subject-not-mapped"))
                .body(not(containsString("employeeId")));
    }

    @Test
    void readinessReportsTheTestProvider() {
        given().when().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'identity-port' }.data.provider", equalTo("fixed-test"));
    }
}
