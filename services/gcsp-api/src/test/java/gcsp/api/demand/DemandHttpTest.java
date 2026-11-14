package gcsp.api.demand;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Greg over HTTP on the shared test database: only Greg reads demand, and the presenter's suitability is refused to him. */
@QuarkusTest
@TestProfile(DemandHttpProfiles.Greg.class)
class DemandHttpTest {

    private static final String DEMAND = "/api/gcsp/v1/greg/demand";

    @jakarta.inject.Inject
    gcsp.api.persistence.Persistence persistence;

    private static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + DemandHttpProfiles.TOKEN);
    }

    /** Briefs left by other tests have no employee row; give each one an owner so the shared run is readable. */
    private static void ownEveryBrief() throws Exception {
        try (var c = java.sql.DriverManager.getConnection(DemandHttpProfiles.URL); var st = c.createStatement()) {
            st.execute("SET search_path TO gcsp_app");
            st.execute("INSERT INTO employees (environment_id, run_id, employee_id, attributes) SELECT h.environment_id, h.run_id, "
                    + "h.employee_id, '{\"companyId\":\"co-http\",\"schemeId\":\"sch-http\"}'::jsonb FROM brief_heads h "
                    + "WHERE h.environment_id = 'test-app-env' AND h.run_id = 'run-1' AND h.brief_version > 0 ON CONFLICT DO NOTHING");
        }
    }

    @Test
    void gregReadsDemandWithNoStore() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownEveryBrief();
        as().get(DEMAND).then().statusCode(200).header("Cache-Control", equalTo("no-store"))
                .contentType(containsString("application/json")).body("status", equalTo("ok"))
                .body("value.privacy.policyVersion", equalTo("gcsp-policy-v1")).body("value.asOf", notNullValue());
    }

    @Test
    void anyQueryIs400AndNeverReadsTheRun() {
        as().queryParam("sample", "1").get(DEMAND).then().statusCode(400).header("Cache-Control", equalTo("no-store"))
                .contentType(containsString("application/json")).body("status", equalTo("invalid"))
                .body("code", equalTo("unsupported-query")).body("retryable", equalTo(false))
                .body("reasons[0].field", equalTo("query"))
                .body("reasons[0].reason", equalTo("Demand uses the current trusted role and run, without display sampling."));
    }

    @Test
    void gregCannotReadThePresentersSuitability() {
        as().get("/api/gcsp/v1/presenter/suitability").then().statusCode(403).contentType(containsString("application/json"))
                .body("status", equalTo("forbidden")).body("code", equalTo("role-required"));
    }

    @Test
    void noBearerIs401Json() {
        given().get(DEMAND).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
        given().get("/api/gcsp/v1/presenter/suitability").then().statusCode(401).body("code", equalTo("bearer-missing"));
    }
}
