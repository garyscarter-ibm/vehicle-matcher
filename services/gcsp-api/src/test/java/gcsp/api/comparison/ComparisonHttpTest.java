package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The stored comparison results over HTTP with OIDC identities and the native test database. */
@QuarkusTest
@TestProfile(ComparisonHttpProfiles.WithDatabase.class)
class ComparisonHttpTest {

    private static final String LATEST = "/api/gcsp/v1/comparison/results/latest";
    private static final String PROCESS = "/api/gcsp/v1/comparison/process/latest";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    ComparisonStartup startup;

    private String employee;
    private String greg;
    private String presenter;

    @BeforeEach
    void identities() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        employee = ComparisonHttpSupport.token(jwk, "sub-employee", "employee");
        greg = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        presenter = ComparisonHttpSupport.token(jwk, "sub-presenter", "presenter");
    }

    @Test
    void gregAndThePresenterReadTheRetainedProcessResult() {
        for (String token : new String[] {greg, presenter}) {
            as(token).get(PROCESS).then().statusCode(200).body("status", equalTo("ok"))
                    .body("value.resultId", equalTo(RetainedComparisonResultsTest.PROCESS_ID))
                    .body("value.origin", equalTo("retained"))
                    .body("value.resultDigest", equalTo(RetainedComparisonResultsTest.DIGEST))
                    .body("value.policyVersion", equalTo("gcsp-policy-v1"))
                    .body("value.activePolicyVersion", notNullValue())
                    .body("value.policyCurrent", notNullValue()).body("value.storedAt", notNullValue())
                    .body("value.result.kind", equalTo("process-comparison"))
                    .body("value.result.caveat", equalTo("Calculated fit is not observed satisfaction."));
            as(token).queryParam("experimentId", "process-only").get(LATEST).then().statusCode(200)
                    .body("value.resultId", equalTo(RetainedComparisonResultsTest.PROCESS_ID));
        }
        org.junit.jupiter.api.Assertions.assertTrue(startup.summary().startsWith("imported:"), startup.summary());
    }

    @Test
    void theAllExperimentsReadListsEveryExperimentInOrder() {
        as(greg).get(LATEST).then().statusCode(200)
                .body("value.activePolicyVersion", notNullValue())
                .body("value.experiments.experimentId", contains("process-only", "order-mix", "points", "hold-sweep"))
                .body("value.experiments", hasSize(4))
                .body("value.experiments[0].latest.resultId", equalTo(RetainedComparisonResultsTest.PROCESS_ID))
                .body("value.experiments[1].latest", nullValue())
                .body("value.experiments[3].latest", nullValue());
    }

    @Test
    void anExperimentWithNothingStoredIsNotFound() {
        as(presenter).queryParam("experimentId", "points").get(LATEST).then().statusCode(404)
                .body("status", equalTo("not-found"));
    }

    @Test
    void anEmployeeIsRefusedAndNoTokenIsUnauthorized() {
        as(employee).get(LATEST).then().statusCode(403).body("code", equalTo("role-required"));
        as(employee).get(PROCESS).then().statusCode(403).body("code", equalTo("role-required"));
        given().get(LATEST).then().statusCode(401);
        given().get(PROCESS).then().statusCode(401);
    }

    @Test
    void unsupportedQueriesNameEachField() {
        as(greg).queryParam("experimentId", "points").queryParam("zebra", "1").queryParam("alpha", "1").get(LATEST)
                .then().statusCode(400).body("code", equalTo("unsupported-query"))
                .body("reasons.field", contains("alpha", "zebra"));
        as(greg).queryParam("experimentId", "points").get(PROCESS).then().statusCode(400)
                .body("code", equalTo("unsupported-query")).body("reasons.field", contains("experimentId"));
    }

    @Test
    void anUnknownEmptyOrRepeatedExperimentIsInvalid() {
        as(greg).queryParam("experimentId", "mystery").get(LATEST).then().statusCode(400)
                .body("code", equalTo("invalid-experiment"))
                .body("reasons[0].reason", equalTo("Choose one of the known comparison experiments."));
        as(greg).queryParam("experimentId", "").get(LATEST).then().statusCode(400)
                .body("code", equalTo("invalid-experiment"));
        as(greg).queryParam("experimentId", "points", "points").get(LATEST).then().statusCode(400)
                .body("code", equalTo("invalid-experiment"));
    }

    @Test
    void thereIsNoWriteRoute() {
        int status = as(greg).post(LATEST).then().extract().statusCode();
        org.junit.jupiter.api.Assertions.assertNotEquals(200, status);
    }
}
