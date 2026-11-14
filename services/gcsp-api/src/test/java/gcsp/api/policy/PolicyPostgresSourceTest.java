package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The PostgreSQL read path on the native test cluster: base materialization, digests, caching and tampering. */
class PolicyPostgresSourceTest {

    PolicyPg pg;

    @BeforeEach
    void setUp() throws Exception {
        pg = PolicyPg.create();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (pg != null) {
            pg.close();
        }
    }

    @Test
    void firstReadMaterializesTheBaseOnceAndLaterReadsReturnTheSameList() throws Exception {
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
        List<JsonNode> first = pg.source.loadVersions("run-1");
        assertEquals(1, first.size());
        assertEquals("gcsp-policy-v1", first.get(0).get("policyVersion").textValue());
        assertEquals(1, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals("reviewed-repository-seed", pg.text("SELECT publisher FROM policy_versions"));
        assertEquals("gcsp-policy-v1", pg.text("SELECT source_version FROM policy_versions"));
        assertEquals(PolicyDigest.of(first.get(0)), pg.text("SELECT seed_digest FROM policy_versions"));
        assertSame(first, pg.source.loadVersions("run-1"));
        assertTrue(pg.service.getActiveVersion(new PolicyRead("run-1", "2026-11-05T09:00:00Z", null)).ok());
    }

    @Test
    void twoConcurrentFirstReadsConvergeOnOneBaseRow() throws Exception {
        PolicyPg other = pg.restarted();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Callable<List<JsonNode>> a = () -> gated(ready, go, pg);
            Callable<List<JsonNode>> b = () -> gated(ready, go, other);
            Future<List<JsonNode>> fa = pool.submit(a);
            Future<List<JsonNode>> fb = pool.submit(b);
            ready.await();
            go.countDown();
            assertEquals(1, fa.get(30, TimeUnit.SECONDS).size());
            assertEquals(1, fb.get(30, TimeUnit.SECONDS).size());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(1, pg.count("SELECT count(*) FROM policy_documents"));
    }

    private static List<JsonNode> gated(CountDownLatch ready, CountDownLatch go, PolicyPg p) throws Exception {
        ready.countDown();
        go.await();
        return p.source.loadVersions("run-1");
    }

    @Test
    void runsShareOneStoredDocumentPerDigest() throws Exception {
        pg.retire("run-1", "run-2");
        pg.source.loadVersions("run-1");
        pg.source.loadVersions("run-2");
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(1, pg.count("SELECT count(*) FROM policy_documents"));
    }

    @Test
    void anUnknownRunIsUnavailableWithoutLeakingSqlOrUrls() throws Exception {
        PolicySourceException e = assertThrows(PolicySourceException.class, () -> pg.source.loadVersions("no-such-run"));
        assertEquals(PolicySourceException.UNAVAILABLE, e.code());
        assertFalse(e.getMessage().contains("SELECT") || e.getMessage().contains("jdbc") || e.getMessage().contains("policy_"));
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
        PolicyResult result = pg.service.getActiveVersion(new PolicyRead("no-such-run", "2026-11-05T09:00:00Z", null));
        assertEquals("unavailable", result.status());
        assertFalse(result.body().toString().contains("jdbc"));
    }

    @Test
    void anUnreachableDatabaseIsUnavailableWithoutLeakingTheUrl() throws Exception {
        PolicyPg down = pg.rewired(FaultDataSource::unreachable);
        PolicyResult result = down.service.getActiveVersion(new PolicyRead("run-1", "2026-11-05T09:00:00Z", null));
        assertEquals("unavailable", result.status());
        assertEquals("source-unavailable", result.code());
        assertFalse(result.body().toString().contains("secret-host"));
    }

    @Test
    void aRetiredRunStillReadsAndMaterializesItsBase() throws Exception {
        pg.retire("run-1", "run-2");
        assertTrue(pg.service.getActiveVersion(new PolicyRead("run-1", "2026-11-05T09:00:00Z", null)).ok());
        assertEquals(1, pg.count("SELECT count(*) FROM policy_versions WHERE run_id = 'run-1'"));
    }

    @Test
    void aRestartedPoolReadsThePersistedVersionsAndDigests() throws Exception {
        ObjectNode change = PolicyPg.holdChange("c-1", "gcsp-policy-v1", "v2", "2026-11-05T10:00:00.000Z", 180);
        assertTrue(pg.service.publishPolicyVersion(PolicyPg.greg("run-1"), change).ok());
        List<JsonNode> before = pg.source.loadVersions("run-1");
        PolicyPg restarted = pg.restarted();
        List<JsonNode> after = restarted.source.loadVersions("run-1");
        assertNotSame(before, after);
        assertEquals(2, after.size());
        assertEquals(before, after);
        assertEquals(PolicyDigest.of(before.get(1)), pg.text("SELECT seed_digest FROM policy_versions WHERE policy_version = 'v2'"));
        assertEquals(180, restarted.hold("run-1", "2026-11-05T10:00:00Z", null));
    }

    @Test
    void theCacheFollowsAnotherInstancesPublicationAndKeepsAtMostEightRuns() throws Exception {
        List<JsonNode> cached = pg.source.loadVersions("run-1");
        PolicyPg competing = pg.restarted();
        assertTrue(competing.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", "gcsp-policy-v1", "v2", "2026-11-05T10:00:00.000Z", 180)).ok());
        List<JsonNode> seen = pg.source.loadVersions("run-1");
        assertNotSame(cached, seen);
        assertEquals(2, seen.size());
        for (int i = 2; i <= 10; i++) {
            pg.update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, ?, 'retired', now())",
                    PolicyPg.ENV, "extra-" + i);
        }
        List<JsonNode> run1 = pg.source.loadVersions("run-1");
        for (int i = 2; i <= 10; i++) {
            pg.source.loadVersions("extra-" + i);
        }
        assertNotSame(run1, pg.source.loadVersions("run-1"));
    }

    @Test
    void aTamperedDocumentOrDigestIsSourceInvalid() throws Exception {
        pg.source.loadVersions("run-1");
        pg.update("ALTER TABLE policy_documents DISABLE TRIGGER policy_documents_immutable");
        pg.update("UPDATE policy_documents SET document = jsonb_set(document, '{source}', '\"tampered\"')");
        pg.source.invalidate("run-1");
        PolicySourceException e = assertThrows(PolicySourceException.class, () -> pg.restarted().source.loadVersions("run-1"));
        assertEquals(PolicySourceException.INVALID, e.code());
        PolicyResult result = pg.restarted().service.getActiveVersion(new PolicyRead("run-1", "2026-11-05T09:00:00Z", null));
        assertEquals("invalid", result.status());
        assertEquals("source-invalid", result.code());
    }

    @Test
    void aVersionRowPointingAtAMismatchedDocumentIsSourceInvalid() throws Exception {
        pg.retire("run-1", "run-2");
        String bogus = "a".repeat(64);
        pg.update("INSERT INTO policy_documents (seed_digest, document) VALUES (?, '{\"policyVersion\":\"x\"}'::jsonb)", bogus);
        pg.update("INSERT INTO policy_versions (environment_id, run_id, policy_version, effective_from, seed_digest, "
                + "publisher, published_at) VALUES (?, 'run-1', 'x', now(), ?, 'p', now())", PolicyPg.ENV, bogus);
        PolicySourceException e = assertThrows(PolicySourceException.class, () -> pg.source.loadVersions("run-1"));
        assertEquals(PolicySourceException.INVALID, e.code());
    }

    @Test
    void policyDocumentsAndVersionsRefuseUpdateAndDelete() throws Exception {
        pg.source.loadVersions("run-1");
        for (String sql : List.of("UPDATE policy_documents SET document = '{}'::jsonb", "DELETE FROM policy_documents",
                "UPDATE policy_versions SET publisher = 'x'", "DELETE FROM policy_versions")) {
            assertThrows(SQLException.class, () -> pg.update(sql), sql);
        }
        assertEquals(1, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(1, pg.count("SELECT count(*) FROM policy_documents"));
        assertThrows(SQLException.class, () -> pg.update("INSERT INTO policy_versions (environment_id, run_id, policy_version, "
                + "effective_from, seed_digest, publisher, published_at) VALUES (?, 'run-1', '', now(), ?, 'p', now())",
                PolicyPg.ENV, "b".repeat(64)));
        assertThrows(SQLException.class, () -> pg.update("INSERT INTO policy_documents (seed_digest, document) VALUES ('nothex', '{}')"));
    }

    @Test
    void jsonbRoundTripKeepsTheDigestOfEveryNumberInTheSeed() throws Exception {
        ObjectNode seed = Seeds.seed();
        ObjectNode floats = seed.putObject("probe");
        floats.put("quarter", 0.25).put("sevenFour", 7.4).put("tiny", 1e-7).put("whole", 100.0)
                .put("sum", 0.1 + 0.2).put("big", 123456789012.345).put("negative", -0.5).put("zero", 0.0);
        String digest = PolicyDigest.of(seed);
        try (Connection c = pg.pool().getConnection()) {
            PolicyRecords.insertBase(PolicyRecords.on(c), PolicyPg.ENV, "run-1", seed.deepCopy());
            JsonNode back = PolicyRecords.documents(c, List.of(digest)).get(digest);
            assertEquals(digest, PolicyDigest.of(back));
            assertEquals(0.25, back.get("probe").get("quarter").doubleValue());
            assertEquals(0.1 + 0.2, back.get("probe").get("sum").doubleValue());
        }
        // The seed file's own documents (152 non-integer numbers) verify through the real source too.
        assertEquals(1, pg.count("SELECT count(*) FROM policy_documents"));
        ObjectNode plain = Seeds.seed();
        pg.retire("run-1", "run-2");
        List<JsonNode> loaded = pg.source.loadVersions("run-2");
        assertEquals(PolicyDigest.of(plain), PolicyDigest.of(loaded.get(0)));
        assertNull(JsonCompare.diff(plain, loaded.get(0)));
    }
}
