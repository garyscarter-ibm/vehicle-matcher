package gcsp.api.demand;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** The presenter over HTTP on the shared test database: suitability is theirs alone, and the selectors are strict. */
@QuarkusTest
@TestProfile(DemandHttpProfiles.Presenter.class)
class SuitabilityHttpTest {

    private static final String PATH = "/api/gcsp/v1/presenter/suitability";

    @Inject
    gcsp.api.persistence.Persistence persistence;

    private static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + DemandHttpProfiles.TOKEN);
    }

    @Test
    void thePresenterReadsSuitabilityWithNoStore() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        as().get(PATH).then().statusCode(200).header("Cache-Control", equalTo("no-store"))
                .contentType(containsString("application/json")).body("status", equalTo("ok"))
                .body("value.release", equalTo("all")).body("value.policy.version", equalTo("gcsp-policy-v1"))
                .body("value.policy.allocationRule", equalTo("renewalDueThenFitThenSeededLottery"))
                .body("value.paging.cars.size", equalTo(8)).body("value.paging.buddies.size", equalTo(4))
                .body("value.asOf", notNullValue());
        as().queryParam("release", "latest").queryParam("page", "9").queryParam("buddyPage", "2").get(PATH).then().statusCode(200)
                .body("value.release", equalTo("latest")).body("value.paging.cars.page", notNullValue());
    }

    @Test
    void badSelectorsAre400() {
        String[][] bad = {{"page", "0"}, {"page", "01"}, {"page", "-1"}, {"page", "x"}, {"page", "12345678"}, {"buddyPage", "0"},
            {"release", "newest"}, {"release", "ALL"}, {"employeeId", "e"}};
        for (String[] q : bad) {
            as().queryParam(q[0], q[1]).get(PATH).then().statusCode(400).header("Cache-Control", equalTo("no-store"))
                    .contentType(containsString("application/json")).body("status", equalTo("invalid"))
                    .body("code", equalTo("unsupported-query")).body("retryable", equalTo(false))
                    .body("reasons[0].field", equalTo("query"))
                    .body("reasons[0].reason", equalTo("Choose a release and positive page numbers only."));
        }
        as().queryParam("page", "1", "2").get(PATH).then().statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    void thePresenterCannotReadGregsDemand() {
        as().get("/api/gcsp/v1/greg/demand").then().statusCode(403).contentType(containsString("application/json"))
                .body("status", equalTo("forbidden")).body("code", equalTo("role-required"));
    }
}
