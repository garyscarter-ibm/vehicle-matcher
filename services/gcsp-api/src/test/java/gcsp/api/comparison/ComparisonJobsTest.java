package gcsp.api.comparison;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** The job service without the container: shutdown, the limit, and restart recovery against one schema. */
class ComparisonJobsTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final PolicyService POLICY = new PolicyService(new RetainedFilePolicySource());

    private static ComparisonJobs jobs(ComparisonFixture f, ComparisonReplay replay) throws Exception {
        return new ComparisonJobs(f.pool(), new RunContext(ComparisonFixture.ENV, "run-1", "comparison"), POLICY,
                context -> Instant.now(), replay, true, "unit");
    }

    private static JsonNode body(String command) throws Exception {
        return MAPPER.readTree("{\"experimentId\":\"process-only\",\"commandId\":\"" + command + "\"}");
    }

    private static String status(ComparisonFixture f) throws Exception {
        return f.text("SELECT status || '|' || coalesce(reason, '') FROM comparison_jobs");
    }

    private static void awaitEnd(ComparisonFixture f) throws Exception {
        for (int i = 0; i < 300 && "running".equals(f.text("SELECT status FROM comparison_jobs")); i++) Thread.sleep(50);
    }

    @Test
    void shuttingDownMarksARunningJobInterruptedAndStopsTheExecutor() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            CountDownLatch entered = new CountDownLatch(1);
            ComparisonJobs jobs = jobs(f, request -> ComparisonJobPorts.held(request, entered, new CountDownLatch(1)));
            assertEquals(202, jobs.start("greg", body("close-1")).http());
            assertTrue(entered.await(30, TimeUnit.SECONDS));
            jobs.close();
            assertEquals("interrupted|The backend stopped before the comparison finished.", status(f));
            assertNotNull(f.text("SELECT finished_at FROM comparison_jobs"));
            jobs.close();
        }
    }

    @Test
    void aJobPastItsLimitFailsWithTheLimitReason() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            CountDownLatch entered = new CountDownLatch(1);
            ComparisonJobs jobs = jobs(f, request -> ComparisonJobPorts.held(request, entered, new CountDownLatch(1)));
            jobs.timeoutMillisOverride = 1000L;
            assertEquals(202, jobs.start("greg", body("limit-1")).http());
            awaitEnd(f);
            assertEquals("failed|The comparison was stopped at its limit of 1 seconds.", status(f));
            jobs.close();
        }
    }

    @Test
    void anOtherExceptionFailsWithoutLeakingItsText() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            ComparisonJobs jobs = jobs(f, request -> {
                throw new IllegalStateException("secret internal detail");
            });
            assertEquals(202, jobs.start("greg", body("boom-1")).http());
            awaitEnd(f);
            assertEquals("failed|The comparison could not be completed.", status(f));
            jobs.close();
        }
    }

    @Test
    void aReplayThatTakesTheInterruptIsStoppedBetweenSteps() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            CountDownLatch entered = new CountDownLatch(1);
            ComparisonJobs jobs = jobs(f, request -> {
                entered.countDown();
                Thread.currentThread().interrupt();
                return ComparisonJobPorts.record(request);
            });
            assertEquals(202, jobs.start("greg", body("between-1")).http());
            awaitEnd(f);
            assertEquals("failed|The comparison could not be completed.", status(f));
            jobs.close();
        }
    }

    @Test
    void startupRecoveryInterruptsOnlyRowsOfAnotherInstance() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            f.update("INSERT INTO comparison_jobs (environment_id, job_id, experiment_id, status, request, seeds_done, seeds_total, "
                    + "steps_done, steps_total, started_at, requested_by, command_id, input_digest, instance_id, version) "
                    + "VALUES (?, 'old', 'points', 'running', '{}'::jsonb, 2, 3, 5, 6, now(), 'greg', 'c', 'd', 'gone', 3)",
                    ComparisonFixture.ENV);
            ComparisonJobs jobs = jobs(f, request -> ComparisonJobPorts.record(request));
            assertEquals(1, jobs.recoverStale());
            assertEquals("interrupted|The backend restarted before the comparison finished.", status(f));
            assertEquals("2|5|4", f.text("SELECT seeds_done || '|' || steps_done || '|' || version FROM comparison_jobs"));
            assertEquals(0, jobs.recoverStale());
            jobs.close();
        }
    }
}
