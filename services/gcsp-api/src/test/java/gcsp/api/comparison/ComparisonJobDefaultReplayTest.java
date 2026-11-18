package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.persistence.Persistence;
import io.quarkus.arc.ClientProxy;
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

/** The container's default replay is the real route replay: a started job runs it in scratch schemas and stops at its limit. */
@QuarkusTest
@TestProfile(ComparisonJobProfiles.DefaultReplay.class)
class ComparisonJobDefaultReplayTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    ComparisonReplay replay;

    @Inject
    ComparisonJobs jobs;

    @Test
    void theDefaultReplayIsTheDatabaseRouteReplay() {
        assertInstanceOf(DatabaseComparisonReplay.class, ClientProxy.unwrap(replay));
    }

    @Test
    void aStartedJobReplaysForRealAndStopsAtItsLimit() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ((ComparisonJobs) ClientProxy.unwrap(jobs)).timeoutMillisOverride = 4000L;
        String greg = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        JsonPath started = as(greg).contentType("application/json")
                .body("{\"experimentId\":\"process-only\",\"commandId\":\"dflt-1\"}").post("/api/gcsp/v1/comparison/jobs")
                .then().statusCode(202).extract().jsonPath();
        String jobId = started.getString("value.jobId");
        JsonPath end = null;
        for (int i = 0; i < 300; i++) {
            end = as(greg).queryParam("jobId", jobId).get("/api/gcsp/v1/comparison/jobs/latest").then().statusCode(200)
                    .extract().jsonPath();
            if (!"running".equals(end.getString("value.status"))) break;
            Thread.sleep(100);
        }
        assertEquals("failed", end.getString("value.status"));
        assertEquals("The comparison was stopped at its limit of 4 seconds.", end.getString("value.reason"));
        assertNull(end.get("value.resultId"));
        try (Connection c = ComparisonJobProfiles.pool(ComparisonJobProfiles.DefaultReplay.SCHEMA).getConnection()) {
            assertEquals(0, count(c, "SELECT count(*) FROM comparison_results WHERE origin = 'run'"));
            assertEquals(0, count(c, "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'cmp\\_%'"));
        }
    }

    private static int count(Connection c, String sql) throws Exception {
        try (PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getInt(1);
        }
    }
}
