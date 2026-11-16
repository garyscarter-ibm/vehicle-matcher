package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Greg starts and reruns comparison jobs over HTTP; the presenter only reads. Uses the synthetic replay. */
@QuarkusTest
@TestProfile(ComparisonJobProfiles.Running.class)
class ComparisonJobHttpTest {

    private static final String JOBS = "/api/gcsp/v1/comparison/jobs";
    private static final String LATEST = JOBS + "/latest";
    private static final String PROCESS = "{\"experimentId\":\"process-only\",\"commandId\":\"%s\"}";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    ComparisonJobs jobs;

    private String employee;
    private String greg;
    private String presenter;

    @BeforeEach
    void identities() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        employee = ComparisonHttpSupport.token(jwk, "sub-employee", "employee");
        greg = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        presenter = ComparisonHttpSupport.token(jwk, "sub-presenter", "presenter");
        ComparisonJobPorts.gate = null;
        ComparisonJobPorts.entered = new CountDownLatch(1);
    }

    private JsonPath start(String body, int status) {
        return as(greg).contentType("application/json").body(body).post(JOBS).then().statusCode(status).extract().jsonPath();
    }

    private JsonPath awaitEnd(String jobId) throws Exception {
        for (int i = 0; i < 300; i++) {
            JsonPath view = as(greg).queryParam("jobId", jobId).get(LATEST).then().statusCode(200).extract().jsonPath();
            if (!"running".equals(view.getString("value.status"))) return view;
            Thread.sleep(100);
        }
        throw new AssertionError("job did not finish: " + jobId);
    }

    private String count(String sql) throws Exception {
        try (Connection c = ComparisonJobProfiles.pool(ComparisonJobProfiles.Running.SCHEMA).getConnection();
                PreparedStatement ps = c.prepareStatement(sql); ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getString(1);
        }
    }

    @Test
    void gregStartsAJobThatRunsToSuccessAndStoresItsResult() throws Exception {
        JsonPath pending = start(PROCESS.formatted("start-1"), 202);
        assertEquals("pending", pending.getString("status"));
        assertEquals("running", pending.getString("value.status"));
        assertEquals("process-only", pending.getString("value.experimentId"));
        assertEquals(3, (int) pending.getInt("value.progress.seedsTotal"));
        assertEquals(6, (int) pending.getInt("value.progress.stepsTotal"));
        assertNull(pending.get("value.request.change"));
        String jobId = pending.getString("value.jobId");
        assertTrue(jobId.startsWith("comparison-job-"));
        JsonPath end = awaitEnd(jobId);
        assertEquals("succeeded", end.getString("value.status"));
        assertEquals(3, (int) end.getInt("value.progress.seedsDone"));
        assertEquals(6, (int) end.getInt("value.progress.stepsDone"));
        assertNotNull(end.getString("value.finishedAt"));
        assertNull(end.get("value.reason"));
        String resultId = end.getString("value.resultId");
        assertTrue(resultId.startsWith("process-comparison-"));
        assertEquals(true, end.getBoolean("reruns"));
        as(greg).queryParam("experimentId", "process-only").get("/api/gcsp/v1/comparison/results/latest").then().statusCode(200)
                .body("value.resultId", equalTo(resultId)).body("value.origin", equalTo("run"))
                .body("value.result.manifest.codeRevision", equalTo("job-test"));
        assertEquals("1", count("SELECT count(*) FROM comparison_results WHERE origin = 'retained'"));
        assertEquals("0", count("SELECT count(*) FROM outbox_events"), "a comparison sends no mail");
        as(presenter).get(LATEST).then().statusCode(200).body("value.jobId", notNullValue());
    }

    @Test
    void theSameCommandReturnsTheSameJobAndAChangedInputIsRefused() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        ComparisonJobPorts.gate = gate;
        String jobId;
        try {
            JsonPath first = start(PROCESS.formatted("same-1"), 202);
            jobId = first.getString("value.jobId");
            assertTrue(ComparisonJobPorts.entered.await(30, TimeUnit.SECONDS));
            JsonPath again = start(PROCESS.formatted("same-1"), 202);
            assertEquals(jobId, again.getString("value.jobId"));
            assertEquals("pending", again.getString("status"));
        } finally {
            gate.countDown();
        }
        awaitEnd(jobId);
        JsonPath done = start(PROCESS.formatted("same-1"), 200);
        assertEquals(jobId, done.getString("value.jobId"));
        assertEquals("ok", done.getString("status"));
        String changed = "{\"commandId\":\"same-1\",\"experimentId\":\"points\",\"change\":{\"value\":1.5,\"basis\":\"A basis.\"}}";
        assertEquals("command-input-changed", start(changed, 409).getString("code"));
    }

    @Test
    void aSecondStartWhileOneRunsIsRefusedWithTheRunningJob() throws Exception {
        CountDownLatch gate = new CountDownLatch(1);
        ComparisonJobPorts.gate = gate;
        String jobId;
        try {
            jobId = start(PROCESS.formatted("busy-1"), 202).getString("value.jobId");
            assertTrue(ComparisonJobPorts.entered.await(30, TimeUnit.SECONDS));
            JsonPath busy = start(PROCESS.formatted("busy-2"), 409);
            assertEquals("job-running", busy.getString("code"));
            assertEquals(jobId, busy.getString("jobId"));
            assertEquals("A comparison is already running. Wait for it to finish.", busy.getString("reason"));
            as(presenter).get(LATEST).then().statusCode(200).body("value.status", equalTo("running"));
        } finally {
            gate.countDown();
        }
        awaitEnd(jobId);
    }

    @Test
    void onlyGregCommandsAndThePresenterReads() throws Exception {
        for (String token : new String[] {presenter, employee}) {
            as(token).contentType("application/json").body(PROCESS.formatted("role-1")).post(JOBS).then().statusCode(403)
                    .body("code", equalTo("role-required"));
        }
        as(employee).get(LATEST).then().statusCode(403);
        RestAssured.given().contentType("application/json").body(PROCESS.formatted("role-1")).post(JOBS).then().statusCode(401);
        assertEquals("0", count("SELECT count(*) FROM comparison_jobs WHERE command_id = 'role-1'"));
        int status = as(presenter).get(LATEST).then().extract().statusCode();
        assertTrue(status == 200 || status == 404, "presenter read answered " + status);
    }

    @Test
    void invalidBodiesAreRefusedBeforeAnyRow() throws Exception {
        String before = count("SELECT count(*) FROM comparison_jobs");
        assertEquals("commandId", start("{\"experimentId\":\"process-only\"}", 400).getString("reasons[0].field"));
        assertEquals("commandId", start("{\"experimentId\":\"process-only\",\"commandId\":\"\"}", 400).getString("reasons[0].field"));
        String longId = "x".repeat(129);
        assertEquals("commandId", start("{\"experimentId\":\"process-only\",\"commandId\":\"" + longId + "\"}", 400)
                .getString("reasons[0].field"));
        JsonPath unknown = start("{\"experimentId\":\"mystery\",\"commandId\":\"bad-1\"}", 400);
        assertEquals("experimentId", unknown.getString("reasons[0].field"));
        assertEquals("Choose one of the known comparison experiments.", unknown.getString("reasons[0].reason"));
        JsonPath extra = start("{\"experimentId\":\"process-only\",\"commandId\":\"bad-2\",\"seeds\":[\"a\"]}", 400);
        assertEquals("seeds", extra.getString("reasons[0].field"));
        String sweep = "{\"commandId\":\"bad-3\",\"experimentId\":\"hold-sweep\",\"change\":{\"values\":[900,1800,3600,7200,14400,28800],"
                + "\"basis\":\"A basis.\"}}";
        JsonPath over = start(sweep, 400);
        assertEquals("invalid", over.getString("status"));
        assertEquals("change.values", over.getString("reasons[0].field"));
        assertEquals("hold.buddy.durationSeconds", over.getString("reasons[0].key"));
        as(greg).contentType("application/json").body("not json").post(JOBS).then().statusCode(400);
        assertEquals(before, count("SELECT count(*) FROM comparison_jobs"));
    }

    @Test
    void readValidatesItsQueryAndAnUnknownJobIsNotFound() {
        as(greg).queryParam("zebra", "1").get(LATEST).then().statusCode(400).body("code", equalTo("unsupported-query"))
                .body("reasons.field", contains("zebra"));
        as(greg).queryParam("jobId", "").get(LATEST).then().statusCode(400).body("code", equalTo("invalid-query"))
                .body("reasons[0].reason", equalTo("Give one job id."));
        as(greg).queryParam("jobId", "a", "b").get(LATEST).then().statusCode(400).body("code", equalTo("invalid-query"));
        as(greg).queryParam("jobId", "comparison-job-none").get(LATEST).then().statusCode(404)
                .body("status", equalTo("not-found")).body("reruns", equalTo(true));
    }

    @Test
    void thereIsNoCancelRestartOrDeleteRoute() {
        for (String path : new String[] {JOBS + "/comparison-job-x/cancel", JOBS + "/comparison-job-x/restart", JOBS + "/comparison-job-x"}) {
            for (String method : new String[] {"POST", "PUT", "DELETE"}) {
                int status = as(greg).contentType("application/json").body("{}").request(method, path).then().extract().statusCode();
                assertTrue(status == 404 || status == 405, method + " " + path + " answered " + status);
            }
        }
    }

    @Test
    void aJobAnotherInstanceLeftRunningReadsAsInterruptedWithItsProgress() throws Exception {
        String id = "comparison-job-stale-" + System.nanoTime();
        try (Connection c = ComparisonJobProfiles.pool(ComparisonJobProfiles.Running.SCHEMA).getConnection();
                PreparedStatement ps = c.prepareStatement("INSERT INTO comparison_jobs (environment_id, job_id, experiment_id, status, "
                        + "request, seeds_done, seeds_total, steps_done, steps_total, started_at, requested_by, command_id, "
                        + "input_digest, instance_id, version) SELECT environment_id, ?, 'process-only', 'running', "
                        + "'{\"experimentId\":\"process-only\",\"change\":null}'::jsonb, 1, 3, 3, 6, now(), 'sub-greg', ?, 'd', "
                        + "'another-instance', 4 FROM environment_identity")) {
            ps.setString(1, id);
            ps.setString(2, id);
            ps.executeUpdate();
        }
        JsonPath view = as(presenter).queryParam("jobId", id).get(LATEST).then().statusCode(200).extract().jsonPath();
        assertEquals("interrupted", view.getString("value.status"));
        assertEquals("The backend restarted before the comparison finished.", view.getString("value.reason"));
        assertEquals(1, (int) view.getInt("value.progress.seedsDone"));
        assertEquals(3, (int) view.getInt("value.progress.stepsDone"));
        assertNotNull(view.getString("value.finishedAt"));
        assertEquals(0, jobs.recoverStale());
        awaitEnd(start(PROCESS.formatted("after-stale"), 202).getString("value.jobId"));
    }
}
