package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.PROVIDERS;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** The alternate-offline shape keeps the application contract, with routing on the same corpus. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.Alternate.class)
class EvidenceHttpProvidersTest {

    @Test
    void sameRequestsGiveTheAlternateGoldenOutputs() throws Exception {
        for (int index : new int[] {0, 1, 2}) {
            EvidenceHttpTest.assertSuccess(index, "alternate", EvidenceHttpSupport.url(PROVIDERS.get("cases").get(index).get("request")));
        }
    }

    @Test
    void unknownAndInvalidIdsKeepTheEnvelope() {
        employee().get(BASE + "/vins/WBA33DB08TC426612").then().statusCode(404).body("code", equalTo("vehicle-not-found"));
        employee().get(BASE + "/vins/x").then().statusCode(400);
    }

    @Test
    void readinessNamesTheProvider() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'vehicle-evidence' }.data.provider", equalTo("alternate-offline"));
    }
}
