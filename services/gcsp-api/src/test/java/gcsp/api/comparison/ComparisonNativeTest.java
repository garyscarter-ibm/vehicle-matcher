package gcsp.api.comparison;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.comparison.ComparisonStore.Inserted;
import gcsp.api.comparison.RetainedComparisonResults.Retained;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The migration, the idempotent import and the immutability rules, against the native test database. */
class ComparisonNativeTest {

    private static Retained bundled() {
        return RetainedComparisonResults.load(List.of(), reason -> {
            throw new AssertionError(reason);
        }).get(0);
    }

    private static final String JOB = "INSERT INTO comparison_jobs (environment_id, job_id, experiment_id, status, request, "
            + "started_at, finished_at, requested_by, command_id, input_digest, instance_id, version) "
            + "VALUES (?, ?, 'process-only', ?, '{}'::jsonb, now(), ?, 'greg', ?, 'd', 'i', 1)";

    @Test
    void importIsIdempotentAndKeepsTheRetainedOrigin() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            ComparisonStore store = new ComparisonStore(f.pool());
            Retained r = bundled();
            assertEquals(Inserted.NEW, store.insert(ComparisonFixture.ENV, r, "retained"));
            assertEquals(Inserted.SAME, store.insert(ComparisonFixture.ENV, r, "retained"));
            assertEquals("1", f.text("SELECT count(*) FROM comparison_results"));
            var latest = store.latest(ComparisonFixture.ENV, "process-only").orElseThrow();
            assertEquals(r.resultId(), latest.resultId());
            assertEquals("retained", latest.origin());
            assertEquals(r.digest(), latest.digest());
            assertEquals(r.digest(), gcsp.api.evidence.CanonicalJson.digest(latest.result()), "jsonb round trip keeps the digest");
            assertTrue(store.latest(ComparisonFixture.ENV, "points").isEmpty());
            assertEquals(1, store.latestAll(ComparisonFixture.ENV).size());
        }
    }

    @Test
    void aConflictingDigestUnderTheSameIdIsLeftUnchanged() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            ComparisonStore store = new ComparisonStore(f.pool());
            Retained r = bundled();
            store.insert(ComparisonFixture.ENV, r, "retained");
            Retained other = new Retained(r.resultId(), r.experimentId(), r.kind(), r.completedAt(), r.policyVersion(),
                    "0".repeat(64), r.result());
            assertEquals(Inserted.CONFLICT, store.insert(ComparisonFixture.ENV, other, "retained"));
            assertEquals(r.digest(), f.text("SELECT result_digest FROM comparison_results"));
        }
    }

    @Test
    void storedResultsCannotBeChangedOrDeleted() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            new ComparisonStore(f.pool()).insert(ComparisonFixture.ENV, bundled(), "retained");
            assertThrows(SQLException.class, () -> f.update("UPDATE comparison_results SET origin = 'run'"));
            assertThrows(SQLException.class, () -> f.update("DELETE FROM comparison_results"));
            assertEquals("retained", f.text("SELECT origin FROM comparison_results"));
        }
    }

    @Test
    void theLatestResultIsTheNewestCompletion() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            ComparisonStore store = new ComparisonStore(f.pool());
            Retained r = bundled();
            Retained newer = new Retained("process-comparison-zzzz", r.experimentId(), r.kind(),
                    r.completedAt().plusSeconds(60), r.policyVersion(), "1".repeat(64), r.result());
            store.insert(ComparisonFixture.ENV, newer, "run");
            store.insert(ComparisonFixture.ENV, r, "retained");
            assertEquals("process-comparison-zzzz", store.latest(ComparisonFixture.ENV, "process-only").orElseThrow().resultId());
            assertEquals("process-comparison-zzzz", store.latestAll(ComparisonFixture.ENV).get("process-only").resultId());
        }
    }

    @Test
    void oneRunningJobPerEnvironmentAndTerminalJobsAreFinal() throws Exception {
        try (ComparisonFixture f = ComparisonFixture.create()) {
            String env = ComparisonFixture.ENV;
            f.update(JOB, env, "job-1", "running", null, "c1");
            assertThrows(SQLException.class, () -> f.update(JOB, env, "job-2", "running", null, "c2"));
            assertThrows(SQLException.class, () -> f.update(JOB, env, "job-3", "succeeded", null, "c3"));
            assertThrows(SQLException.class, () -> f.update(JOB, env, "job-4", "running", java.sql.Timestamp.from(java.time.Instant.now()), "c4"));
            f.update("UPDATE comparison_jobs SET status = 'failed', finished_at = now(), reason = 'x', version = 2 WHERE job_id = 'job-1'");
            f.update(JOB, env, "job-2", "running", null, "c2");
            assertThrows(SQLException.class, () -> f.update("UPDATE comparison_jobs SET status = 'running', finished_at = NULL WHERE job_id = 'job-1'"));
            assertThrows(SQLException.class, () -> f.update("UPDATE comparison_jobs SET reason = 'again' WHERE job_id = 'job-1'"));
            assertThrows(SQLException.class, () -> f.update("DELETE FROM comparison_jobs WHERE job_id = 'job-1'"));
            assertThrows(SQLException.class, () -> f.update("UPDATE comparison_jobs SET result_id = 'missing' WHERE job_id = 'job-2'"));
        }
    }
}
