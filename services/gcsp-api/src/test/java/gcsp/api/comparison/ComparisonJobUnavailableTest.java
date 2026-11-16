package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** With the default replay a started job ends failed with the fixed reason and stores no result. */
@QuarkusTest
@TestProfile(ComparisonJobProfiles.DefaultReplay.class)
class ComparisonJobUnavailableTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Test
    void theDefaultReplayFailsTheJobHonestly() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        String greg = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        JsonPath started = as(greg).contentType("application/json")
                .body("{\"experimentId\":\"process-only\",\"commandId\":\"dflt-1\"}").post("/api/gcsp/v1/comparison/jobs")
                .then().statusCode(202).extract().jsonPath();
        String jobId = started.getString("value.jobId");
        JsonPath end = null;
        for (int i = 0; i < 200; i++) {
            end = as(greg).queryParam("jobId", jobId).get("/api/gcsp/v1/comparison/jobs/latest").then().statusCode(200)
                    .extract().jsonPath();
            if (!"running".equals(end.getString("value.status"))) break;
            Thread.sleep(100);
        }
        assertEquals("failed", end.getString("value.status"));
        assertEquals("The route replay is not available in this service yet.", end.getString("value.reason"));
        org.junit.jupiter.api.Assertions.assertNull(end.get("value.resultId"));
        assertEquals(0, (int) end.getInt("value.progress.stepsDone"));
        try (Connection c = ComparisonJobProfiles.pool(ComparisonJobProfiles.DefaultReplay.SCHEMA).getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM comparison_results WHERE origin = 'run'");
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            assertEquals(0, rs.getInt(1));
        }
    }
}
