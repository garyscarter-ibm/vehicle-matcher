package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
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

/** Publication on the native test cluster: dated and pinned reads, replay, concurrency, atomicity and refusals. */
class PolicyPublishPostgresTest {

    static final String V1 = "gcsp-policy-v1";
    static final String AT = "2026-11-05T10:00:00.000Z";
    static final String BEFORE = "2026-11-05T09:30:00Z";
    static final String AFTER = "2026-11-05T10:30:00Z";

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

    private PolicyResult publish(ObjectNode change) {
        return pg.service.publishPolicyVersion(PolicyPg.greg("run-1"), change);
    }

    @Test
    void aPublicationChangesLaterReadsButNotEarlierOnesOrPinnedQuotes() throws Exception {
        ObjectNode priceBefore = (ObjectNode) pg.service.getPointsCost(contextFor("G20 Saloon|320i"), car("G20 Saloon|320i"),
                new PolicyRead("run-1", BEFORE, null)).value();
        String priceKey = priceBefore.get("key").textValue();
        int oldPoints = priceBefore.get("monthlyPoints").intValue();
        PolicyResult accepted = publish(PolicyPg.change("c-1", V1, "policy-v2", AT,
                PolicyPg.patch("assumptions", PolicyPg.HOLD, "value", 180),
                PolicyPg.patch("pricePlans", priceKey, "value", oldPoints + 111, "monthlyPoints", oldPoints + 111)));
        assertTrue(accepted.ok(), accepted.body().toString());
        assertEquals("policy-v2", accepted.policyVersion());
        JsonNode value = accepted.value();
        assertTrue(value.get("accepted").booleanValue());
        assertEquals(AT, value.get("effectiveFrom").textValue());
        assertEquals("greg-subject", value.get("publisher").textValue());
        assertEquals("2026-11-05T09:00:00.000Z", value.get("publishedAt").textValue());
        assertEquals("1.0.0", accepted.body().get("contractVersion").textValue());

        assertEquals(120, pg.hold("run-1", BEFORE, null));
        assertEquals(180, pg.hold("run-1", AFTER, null));
        assertEquals(180, pg.hold("run-1", AT.replace(".000", ""), null));
        // A quote pinned to the old version keeps the old terms after the change is in force.
        assertEquals(120, pg.hold("run-1", AFTER, V1));
        PolicyResult pinned = pg.service.getPointsCost(contextFor("G20 Saloon|320i"), car("G20 Saloon|320i"),
                new PolicyRead("run-1", AFTER, V1));
        assertEquals(oldPoints, pinned.value().get("monthlyPoints").intValue());
        assertEquals(oldPoints, pinned.value().get("value").intValue());
        PolicyResult current = pg.service.getPointsCost(contextFor("G20 Saloon|320i"), car("G20 Saloon|320i"),
                new PolicyRead("run-1", AFTER, null));
        assertEquals(oldPoints + 111, current.value().get("monthlyPoints").intValue());
        assertEquals(oldPoints + 111, current.value().get("value").intValue());
        assertEquals("policy-v2", current.policyVersion());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(2, pg.count("SELECT count(*) FROM policy_documents"));
        assertEquals(V1, pg.text("SELECT source_version FROM policy_versions WHERE policy_version = 'policy-v2'"));
        assertEquals("c-1", pg.text("SELECT command_id FROM policy_versions WHERE policy_version = 'policy-v2'"));
    }

    private static com.fasterxml.jackson.databind.node.ObjectNode car(String key) {
        return Seeds.MAPPER.createObjectNode().put("eligibilityModelKey", key);
    }

    private PolicyContext contextFor(String ignored) {
        JsonNode mapping = pg.service.getAssumption("eligibility.context.mapping",
                new PolicyRead("run-1", BEFORE, null)).value().get("value").get(0);
        return new PolicyContext("run-1", mapping.get("companyId").textValue(), mapping.get("schemeId").textValue(),
                mapping.get("gradeIds").get(1).textValue());
    }

    @Test
    void publishingTheSamePricePlanReadsThroughTheEligibilityPathsToo() throws Exception {
        assertTrue(publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 240)).ok());
        PolicyResult eligibility = pg.service.getEligibility(contextFor("x"), car("G20 Saloon|320i"),
                new PolicyRead("run-1", AFTER, null));
        PolicyResult original = pg.service.getEligibility(contextFor("x"), car("G20 Saloon|320i"),
                new PolicyRead("run-1", AFTER, V1));
        assertEquals("policy-v2", eligibility.policyVersion());
        assertEquals(V1, original.policyVersion());
        assertEquals(original.value().get("state"), eligibility.value().get("state"));
    }

    @Test
    void sameCommandReplaysTheOriginalBodyAndChangedInputConflicts() throws Exception {
        ObjectNode change = PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180);
        PolicyResult first = publish(change);
        assertTrue(first.ok());
        pg.clock.now = PolicyPg.T0.plusSeconds(600);
        PolicyResult replay = publish(change.deepCopy());
        assertTrue(replay.ok());
        JsonNode original = first.value().deepCopy();
        ((ObjectNode) original).remove(List.of("activationRequired", "activation"));
        JsonNode again = replay.value().deepCopy();
        ((ObjectNode) again).remove(List.of("activationRequired", "activation"));
        assertEquals(original, again);
        assertEquals("2026-11-05T09:00:00.000Z", again.get("publishedAt").textValue());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(1, pg.count("SELECT count(*) FROM command_receipts WHERE command_id = 'c-1'"));

        ObjectNode changed = PolicyPg.holdChange("c-1", V1, "policy-v3", AT, 181);
        PolicyResult conflict = publish(changed);
        assertEquals("conflict", conflict.status());
        assertEquals("command-input-changed", conflict.code());
        assertFalse(conflict.body().get("accepted").booleanValue());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void twoConcurrentPublishersWithTheSameExpectedVersionHaveExactlyOneWinner() throws Exception {
        PolicyPg other = pg.restarted();
        ObjectNode a = PolicyPg.holdChange("c-a", V1, "policy-a", AT, 150);
        ObjectNode b = PolicyPg.holdChange("c-b", V1, "policy-b", "2026-11-05T11:00:00.000Z", 160);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<PolicyResult> results;
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Future<PolicyResult> fa = pool.submit(gated(ready, go, () -> pg.service.publishPolicyVersion(PolicyPg.greg("run-1"), a)));
            Future<PolicyResult> fb = pool.submit(gated(ready, go, () -> other.service.publishPolicyVersion(PolicyPg.greg("run-1"), b)));
            ready.await();
            go.countDown();
            results = List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
        // Both name the same expected active version, so the loser sees the winner only as a later scheduled
        // version: it is accepted when its date is later than every retained version, and refused when it is not.
        long accepted = results.stream().filter(PolicyResult::ok).count();
        assertTrue(accepted >= 1, results.toString());
        assertEquals(1 + accepted, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(accepted, pg.count("SELECT count(*) FROM policy_versions WHERE command_id IS NOT NULL"));
        for (PolicyResult r : results) {
            assertTrue(r.ok() || "invalid".equals(r.status()) || "stale-version".equals(r.status()), r.body().toString());
        }
    }

    @Test
    void twoConcurrentPublishersForTheSameDateAcceptExactlyOneAndLeaveNoPartialRows() throws Exception {
        PolicyPg other = pg.restarted();
        ObjectNode a = PolicyPg.holdChange("c-a", V1, "policy-a", AT, 150);
        ObjectNode b = PolicyPg.holdChange("c-b", V1, "policy-b", AT, 160);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        List<PolicyResult> results;
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Future<PolicyResult> fa = pool.submit(gated(ready, go, () -> pg.service.publishPolicyVersion(PolicyPg.greg("run-1"), a)));
            Future<PolicyResult> fb = pool.submit(gated(ready, go, () -> other.service.publishPolicyVersion(PolicyPg.greg("run-1"), b)));
            ready.await();
            go.countDown();
            results = List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, results.stream().filter(PolicyResult::ok).count(), results.toString());
        PolicyResult loser = results.stream().filter(r -> !r.ok()).findFirst().orElseThrow();
        assertEquals("invalid", loser.status());
        assertEquals("effectiveFrom", loser.body().get("reasons").get(0).get("field").textValue());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
        assertEquals(2, pg.count("SELECT count(*) FROM policy_documents"));
        assertEquals(1, pg.count("SELECT count(*) FROM command_receipts WHERE command_type = 'policy.publish'"));
    }

    private static <T> Callable<T> gated(CountDownLatch ready, CountDownLatch go, Callable<T> work) {
        return () -> {
            ready.countDown();
            go.await();
            return work.call();
        };
    }

    @Test
    void anInvalidChangeRollsBackEveryRowIncludingTheFirstUseBase() throws Exception {
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
        List<Long> before = pg.policyRows();
        ObjectNode bad = PolicyPg.change("c-bad", V1, "policy-v2", AT, PolicyPg.patch("assumptions", PolicyPg.HOLD, "value", -5));
        PolicyResult result = publish(bad);
        assertEquals("invalid", result.status());
        assertEquals("changes.value", result.body().get("reasons").get(0).get("field").textValue());
        assertEquals(before, pg.policyRows());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
        // The refused command left no receipt, so the same id can be used for a valid change.
        assertTrue(publish(PolicyPg.holdChange("c-bad", V1, "policy-v2", AT, 150)).ok());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void aSnapshotFailingSuccessorWritesNothing() throws Exception {
        pg.source.loadVersions("run-1");
        List<Long> before = pg.policyRows();
        JsonNode priceRow = pg.source.loadVersions("run-1").get(0).get("pricePlans").get(0);
        PolicyResult result = publish(PolicyPg.change("c-snap", V1, "policy-v2", AT,
                PolicyPg.patch("pricePlans", priceRow.get("key").textValue(), "value", 900)));
        assertEquals("invalid", result.status());
        assertEquals("changes", result.body().get("reasons").get(0).get("field").textValue());
        assertEquals(before, pg.policyRows());
    }

    @Test
    void nonGregPrincipalsAndEnvironmentMismatchAreForbiddenAndWriteNothing() throws Exception {
        List<Long> before = pg.policyRows();
        ObjectNode change = PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180);
        PolicyResult employee = pg.service.publishPolicyVersion(PolicyPg.employee("run-1"), change);
        assertEquals("forbidden", employee.status());
        assertEquals("role-required", employee.code());
        assertEquals("This person cannot perform that action.", employee.body().get("reason").textValue());
        assertFalse(employee.body().get("accepted").booleanValue());
        assertNull(employee.policyVersion());
        Principal wrongEnvironment = new Principal("greg-subject", List.of("greg"), "other-env", "run-1", null, V1, List.of());
        PolicyResult mismatch = pg.service.publishPolicyVersion(wrongEnvironment, change);
        assertEquals("forbidden", mismatch.status());
        assertEquals("environment-mismatch", mismatch.code());
        assertEquals("forbidden", pg.service.publishPolicyVersion(null, change).status());
        assertEquals(before, pg.policyRows());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void aStaleExpectedVersionIsRefusedWithTheNodeBody() throws Exception {
        PolicyResult stale = publish(PolicyPg.holdChange("c-1", "old", "policy-v2", AT, 180));
        assertEquals("stale-version", stale.status());
        assertEquals("old", stale.body().get("expectedVersion").textValue());
        assertEquals(V1, stale.body().get("currentVersion").textValue());
        assertEquals("refresh", stale.body().get("action").textValue());
        assertEquals(V1, stale.policyVersion());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void noActiveVersionIsStaleWithANullCurrentVersion() throws Exception {
        pg.clock.now = java.time.Instant.parse("2026-11-01T00:00:00Z");
        PolicyResult stale = publish(PolicyPg.holdChange("c-1", V1, "policy-v2", "2026-11-02T00:00:00.000Z", 180));
        assertEquals("stale-version", stale.status());
        assertTrue(stale.body().get("currentVersion").isNull());
        assertNull(stale.policyVersion());
    }

    @Test
    void anEffectiveDateNotLaterThanEveryRetainedVersionIsInvalid() throws Exception {
        assertTrue(publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        for (String date : List.of(AT, "2026-11-05T09:30:00.000Z", "2026-11-05T08:00:00.000Z")) {
            PolicyResult result = publish(PolicyPg.holdChange("c-" + date, V1, "policy-v3", date, 190));
            assertEquals("invalid", result.status(), date);
            assertEquals("effectiveFrom", result.body().get("reasons").get(0).get("field").textValue());
        }
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void aLaterPublicationAppendsToTheLatestScheduledSnapshot() throws Exception {
        assertTrue(publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        PolicyResult second = publish(PolicyPg.change("c-2", V1, "policy-v3", "2026-11-05T11:00:00.000Z",
                PolicyPg.patch("assumptions", "hold.cart.orderReview.durationSeconds", "value", 900)));
        assertTrue(second.ok(), second.body().toString());
        assertEquals(180, pg.hold("run-1", "2026-11-05T11:30:00Z", null));
        PolicyResult review = pg.service.getAssumption("hold.cart.orderReview.durationSeconds",
                new PolicyRead("run-1", "2026-11-05T11:30:00Z", null));
        assertEquals(900, review.value().get("value").intValue());
        assertEquals("policy-v2", pg.text("SELECT source_version FROM policy_versions WHERE policy_version = 'policy-v3'"));
    }

    @Test
    void aRetiredRunRefusesPublicationButStillReads() throws Exception {
        pg.retire("run-1", "run-2");
        PolicyResult result = publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180));
        assertEquals("conflict", result.status());
        assertEquals("stale-run", result.code());
        assertEquals("This page is out of date. Reload to see the latest.", result.body().get("reason").textValue());
        assertEquals(120, pg.hold("run-1", AFTER, null));
        assertEquals(1, pg.count("SELECT count(*) FROM policy_versions WHERE run_id = 'run-1'"));
        assertEquals(0, pg.count("SELECT count(*) FROM policy_documents WHERE seed_digest NOT IN "
                + "(SELECT seed_digest FROM policy_versions)"));
    }

    @Test
    void aResetStyleNewRunStartsOnTheBaseSeedWhileTheOldRunKeepsItsPublication() throws Exception {
        assertTrue(publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        pg.retire("run-1", "run-2");
        pg.clock.now = PolicyPg.T0.plusSeconds(60);
        assertEquals(120, pg.hold("run-2", AFTER, null));
        assertEquals(V1, pg.service.getActiveVersion(new PolicyRead("run-2", AFTER, null)).policyVersion());
        assertEquals(180, pg.hold("run-1", AFTER, null));
        // The same command id and version name are free to use again in the new run.
        PolicyResult again = pg.service.publishPolicyVersion(PolicyPg.greg("run-2"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 200));
        assertTrue(again.ok(), again.body().toString());
        assertEquals(200, pg.hold("run-2", AFTER, null));
        assertEquals(180, pg.hold("run-1", AFTER, null));
        assertEquals(3, pg.count("SELECT count(*) FROM policy_documents"));
    }

    @Test
    void anEditedRetainedFileDoesNotChangeARunThatAlreadyMaterializedItsBase() throws Exception {
        pg.source.loadVersions("run-1");
        pg.retire("run-1", "run-2");
        ObjectNode edited = Seeds.seed();
        Seeds.assumption(edited, PolicyPg.HOLD).put("value", 999);
        java.nio.file.Path file = java.nio.file.Files.createTempFile("seed", ".json");
        try {
            java.nio.file.Files.writeString(file, edited.toString());
            PolicyService afterEdit = new PolicyService(new PostgresPolicySource(pg.database,
                    new RetainedFilePolicySource(file, List.of())));
            // The run that already stored its base keeps it; a run first read after the edit takes the new file.
            assertEquals(120, afterEdit.getAssumption(PolicyPg.HOLD, new PolicyRead("run-1", AFTER, null)).value().get("value").intValue());
            assertEquals(999, afterEdit.getAssumption(PolicyPg.HOLD, new PolicyRead("run-2", AFTER, null)).value().get("value").intValue());
        } finally {
            java.nio.file.Files.deleteIfExists(file);
        }
    }

    @Test
    void uncertainCommitIsReportedWithItsOperationId() throws Exception {
        PolicyPg flaky = pg.rewired(FaultDataSource::commitThenFail);
        PolicyResult result = flaky.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-u", V1, "policy-v2", AT, 180));
        assertEquals("uncertain", result.status());
        assertEquals("c-u", result.body().get("operationId").textValue());
        assertFalse(result.body().toString().contains("08006"));
        // The change did commit; resubmitting the same command replays it and activation then completes.
        PolicyResult replay = publish(PolicyPg.holdChange("c-u", V1, "policy-v2", AT, 180));
        assertTrue(replay.ok(), replay.body().toString());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void anUnavailableDatabaseIsRetryableWithoutLeakingTheUrl() throws Exception {
        PolicyPg down = pg.rewired(FaultDataSource::unreachable);
        PolicyResult result = down.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180));
        assertEquals("unavailable", result.status());
        assertTrue(result.body().get("retryable").booleanValue());
        assertFalse(result.body().toString().contains("secret-host"));
    }

    @Test
    void anInvalidChangeSetNeverTouchesTheDatabase() throws Exception {
        PolicyResult result = publish(Seeds.MAPPER.createObjectNode().put("commandId", "c-1"));
        assertEquals("invalid", result.status());
        assertEquals("invalid-policy-change", result.code());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void publicationInvalidatesTheSourceCacheForTheRun() throws Exception {
        List<JsonNode> before = pg.source.loadVersions("run-1");
        assertTrue(publish(PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        List<JsonNode> after = pg.source.loadVersions("run-1");
        assertEquals(1, before.size());
        assertEquals(2, after.size());
    }

    @Test
    void activationOnlyFollowsAcommittedPublicationAndNeverUndoesIt() throws Exception {
        PolicyPg breaking = pg.rewired(ds -> FaultDataSource.before(ds, "INSERT INTO policy_run_activation", () -> {
            throw new IllegalStateException("activation write failed");
        }));
        PolicyResult result = breaking.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180));
        assertTrue(result.ok(), result.body().toString());
        JsonNode value = result.value();
        assertTrue(value.get("activationRequired").booleanValue());
        assertEquals("pending", value.get("activation").get("status").textValue());
        assertEquals("policy-v2", value.get("activation").get("policyVersion").textValue());
        assertTrue(value.get("activation").get("retryable").booleanValue());
        assertEquals("Publication was saved. Retry to activate the run.", value.get("activation").get("reason").textValue());
        assertEquals("unavailable", value.get("activation").get("outcome").textValue());
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }
}
