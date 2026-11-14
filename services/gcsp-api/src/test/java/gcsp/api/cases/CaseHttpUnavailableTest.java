package gcsp.api.cases;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** With persistence off, an authorised case read is 503 case-unavailable with a JSON body. */
@QuarkusTest
@TestProfile(CaseHttpNoDatabaseProfile.class)
class CaseHttpUnavailableTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    private RequestSpecification as(String subject, String role) throws Exception {
        return given().header("Authorization", "Bearer " + CaseHttpProfile.bearer(signingJwk, subject, role));
    }

    @Test
    void employeeHelpIsUnavailableWithoutPersistence() throws Exception {
        as(CaseHttpProfile.SUB_A, "employee").get("/api/gcsp/v1/help").then().statusCode(503)
                .contentType(containsString("application/json")).body("status", equalTo("unavailable"))
                .body("code", equalTo("case-unavailable")).body("retryable", equalTo(true));
    }

    @Test
    void gregListIsUnavailableWithoutPersistence() throws Exception {
        as(CaseHttpProfile.SUB_GREG, "greg").get("/api/gcsp/v1/scheme-team/cases").then().statusCode(503)
                .contentType(containsString("application/json")).body("code", equalTo("case-unavailable"));
    }
}
