package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * Env-gated, about an hour: Greg starts the full process-only job through the HTTP route on the startup composition
 * (real replay, policy timeout); it must succeed and store a result, written to GCSP_COMPARISON_E2E_OUT for comparison.
 */
@QuarkusTest
@TestProfile(ComparisonJobProfiles.DefaultReplay.class)
class ComparisonJobFullSizeTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    ComparisonJobs jobs;

    @Test
    void aGregStartedJobRunsToSuccessAndStoresItsResult() throws Exception {
        String out = System.getenv("GCSP_COMPARISON_E2E_OUT");
        Assumptions.assumeTrue(out != null && !out.isBlank() && persistence.active(),
                "GCSP_COMPARISON_E2E_OUT and GCSP_TEST_DATABASE_URL are not both set");
        ((ComparisonJobs) ClientProxy.unwrap(jobs)).timeoutMillisOverride = null; // the policy limit applies
        JsonPath started = as(greg()).contentType("application/json")
                .body("{\"experimentId\":\"process-only\",\"commandId\":\"e2e-full-1\"}").post("/api/gcsp/v1/comparison/jobs")
                .then().statusCode(202).extract().jsonPath();
        String jobId = started.getString("value.jobId");
        long began = System.nanoTime();
        JsonPath end;
        while (true) {
            end = as(greg()).queryParam("jobId", jobId).get("/api/gcsp/v1/comparison/jobs/latest").then().statusCode(200)
                    .extract().jsonPath();
            if (!"running".equals(end.getString("value.status"))) break;
            Thread.sleep(30_000);
        }
        System.out.println("E2E job " + jobId + " " + end.getString("value.status") + " after "
                + (System.nanoTime() - began) / 1_000_000_000 + " s, reason=" + end.getString("value.reason"));
        assertEquals("succeeded", end.getString("value.status"), end.prettify());
        assertEquals(6, end.getInt("value.progress.stepsDone"));
        String stored = as(greg()).queryParam("experimentId", "process-only").get("/api/gcsp/v1/comparison/results/latest")
                .then().statusCode(200).extract().asString();
        JsonPath result = JsonPath.from(stored);
        assertEquals(end.getString("value.resultId"), result.getString("value.resultId"));
        assertEquals("run", result.getString("value.origin"));
        Files.createDirectories(Path.of(out));
        Files.writeString(Path.of(out, "e2e-result.json"), stored);
    }

    private String greg() {
        return ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
    }
}
