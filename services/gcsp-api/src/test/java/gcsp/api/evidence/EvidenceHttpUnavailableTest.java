package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** No provider: an explicit unavailable result for every read, and an honest UP readiness. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.None.class)
class EvidenceHttpUnavailableTest {

    @Test
    void everyReadIsSourceUnavailable() {
        for (String path : new String[] {"/configurations/UkVGMTpSRUZFUkVOQ0U=", "/vins/WBA33DB08TC426611",
                "/stock/1d736acd-674c-4bb1-8b6b-45dc56906442"}) {
            employee().get(BASE + path).then().statusCode(503).body("status", equalTo("unavailable"))
                    .body("code", equalTo("vehicle-source-unavailable")).body("retryable", equalTo(true));
        }
        employee().get("/api/gcsp/v1/vehicle-images/bmw-display-" + "a".repeat(20) + ".webp").then().statusCode(503)
                .body("code", equalTo("vehicle-images-unavailable"));
    }

    @Test
    void readinessIsUpWithProviderNone() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'vehicle-evidence' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.provider", equalTo("none"));
    }
}
