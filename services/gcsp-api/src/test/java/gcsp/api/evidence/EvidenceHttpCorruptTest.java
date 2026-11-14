package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** A store whose content fails validation does not stop startup: reads are 503 and readiness is DOWN. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.Corrupt.class)
class EvidenceHttpCorruptTest {

    @Test
    void readsAre503AndReadinessIsDown() {
        employee().get(BASE + "/configurations/UkVGMTpSRUZFUkVOQ0U=").then().statusCode(503)
                .body("code", equalTo("vehicle-source-unavailable"));
        employee().get(BASE + "/vins/WBA33DB08TC426611").then().statusCode(503);
        given().get("/q/health/ready").then().statusCode(503)
                .body("checks.find { it.name == 'vehicle-evidence' }.status", equalTo("DOWN"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.state", equalTo("unavailable"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.code", equalTo("selected-corpus-invalid"));
        given().get("/q/health/live").then().statusCode(200);
    }
}
