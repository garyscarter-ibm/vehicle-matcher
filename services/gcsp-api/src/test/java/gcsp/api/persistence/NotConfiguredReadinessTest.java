package gcsp.api.persistence;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/** Without GCSP_DATABASE_URL the datasource is inactive and readiness says so, not a fake database UP. */
@QuarkusTest
class NotConfiguredReadinessTest {

    @Test
    void readinessReportsNotConfigured() {
        given().when().get("/q/health/ready").then()
                .statusCode(200)
                .body("checks.find { it.name == 'persistence' }.data.state", equalTo("not-configured"))
                .body("checks.find { it.name == 'persistence' }.data.environmentId", nullValue());
    }
}
