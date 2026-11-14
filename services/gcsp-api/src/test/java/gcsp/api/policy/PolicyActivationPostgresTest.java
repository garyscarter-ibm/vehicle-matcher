package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.SQLException;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Activation on the native test cluster: first insert, publication then activation, CAS retry and refusals. */
class PolicyActivationPostgresTest {

    static final String V1 = "gcsp-policy-v1";
    static final String AT = "2026-11-05T10:00:00.000Z";

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
    void anAbsentActivationIsInsertedAndRepeatedCallsWriteNothingMore() throws Exception {
        assertEquals(Optional.empty(), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
        PolicyResult first = pg.activation.activate(PolicyPg.ctx("run-1"));
        assertTrue(first.ok(), first.body().toString());
        assertEquals(V1, first.value().get("policyVersion").textValue());
        assertEquals("2026-11-05T09:00:00.000Z", first.value().get("asOf").textValue());
        JsonNode run = first.value().get("run");
        assertEquals("run-1", run.get("runId").textValue());
        assertEquals(PolicyPg.ENV, run.get("environmentId").textValue());
        assertEquals("active", run.get("status").textValue());
        assertEquals(Optional.of(V1), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
        long revision = pg.revision("run-1");
        long receipts = pg.count("SELECT count(*) FROM command_receipts");
        assertTrue(pg.activation.activate(PolicyPg.ctx("run-1")).ok());
        assertEquals(revision, pg.revision("run-1"));
        assertEquals(receipts, pg.count("SELECT count(*) FROM command_receipts"));
        assertEquals(1, pg.count("SELECT version FROM policy_run_activation"));
    }

    @Test
    void publicationThenActivationBecomesActiveWithTheNewVersionOnceItsDateArrives() throws Exception {
        PolicyResult published = pg.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180));
        assertTrue(published.ok(), published.body().toString());
        JsonNode activation = published.value().get("activation");
        // The successor is dated an hour ahead, so the run stays on v1 until the clock reaches it.
        assertEquals("active", activation.get("status").textValue());
        assertEquals(V1, activation.get("policyVersion").textValue());
        assertFalse(activation.get("publishedVersionActive").booleanValue());
        assertFalse(published.value().get("activationRequired").booleanValue());
        assertEquals(Optional.of(V1), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));

        pg.clock.now = PolicyPg.T0.plusSeconds(3601);
        PolicyResult later = pg.activation.activate(PolicyPg.ctx("run-1"));
        assertTrue(later.ok());
        assertEquals("policy-v2", later.value().get("policyVersion").textValue());
        assertEquals(Optional.of("policy-v2"), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
        assertEquals(2, pg.count("SELECT version FROM policy_run_activation"));
    }

    @Test
    void aPublicationDatedNowIsActiveInTheSameCall() throws Exception {
        PolicyResult published = pg.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", "2026-11-05T09:00:00.000Z", 180));
        assertTrue(published.ok(), published.body().toString());
        JsonNode activation = published.value().get("activation");
        assertEquals("active", activation.get("status").textValue());
        assertEquals("policy-v2", activation.get("policyVersion").textValue());
        assertTrue(activation.get("publishedVersionActive").booleanValue());
        assertEquals("2026-11-05T09:00:00.000Z", activation.get("asOf").textValue());
        assertEquals(Optional.of("policy-v2"), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
    }

    @Test
    void aVersionCasRaceIsRetriedAndTheLaterWriterWins() throws Exception {
        assertTrue(pg.activation.activate(PolicyPg.ctx("run-1")).ok());
        assertTrue(pg.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        pg.clock.now = PolicyPg.T0.plusSeconds(3601);
        AtomicInteger raced = new AtomicInteger();
        PolicyPg racing = pg.rewired(ds -> FaultDataSource.before(ds, "UPDATE policy_run_activation", () -> {
            if (raced.getAndIncrement() == 0) {
                try {
                    // A competitor bumps the activation version after our read and before our CAS.
                    pg.update("UPDATE policy_run_activation SET as_of = as_of + interval '1 second', version = version + 1");
                } catch (SQLException e) {
                    throw new IllegalStateException(e);
                }
            }
        }));
        racing.clock.now = pg.clock.now;
        PolicyResult result = racing.activation.activate(PolicyPg.ctx("run-1"));
        assertTrue(result.ok(), result.body().toString());
        assertEquals("policy-v2", result.value().get("policyVersion").textValue());
        assertEquals(2, raced.get(), "first CAS lost to the competitor, the retry won");
        assertEquals(Optional.of("policy-v2"), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
        assertEquals(3, pg.count("SELECT version FROM policy_run_activation"));
    }

    @Test
    void aCasThatKeepsLosingEndsInARetryableConflict() throws Exception {
        assertTrue(pg.activation.activate(PolicyPg.ctx("run-1")).ok());
        assertTrue(pg.service.publishPolicyVersion(PolicyPg.greg("run-1"),
                PolicyPg.holdChange("c-1", V1, "policy-v2", AT, 180)).ok());
        PolicyPg racing = pg.rewired(ds -> FaultDataSource.before(ds, "UPDATE policy_run_activation", () -> {
            try {
                pg.update("UPDATE policy_run_activation SET version = version + 1");
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
        }));
        racing.clock.now = PolicyPg.T0.plusSeconds(3601);
        PolicyResult result = racing.activation.activate(PolicyPg.ctx("run-1"));
        assertEquals("conflict", result.status());
        assertEquals("policy-activation-conflict", result.code());
        assertTrue(result.body().get("retryable").booleanValue());
        assertEquals(Optional.of(V1), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
    }

    @Test
    void aRetiredOrUnknownRunIsStaleRun() throws Exception {
        pg.retire("run-1", "run-2");
        for (String run : new String[] {"run-1", "no-such-run"}) {
            PolicyResult result = pg.activation.activate(PolicyPg.ctx(run));
            assertEquals("stale-run", result.status(), run);
            assertEquals("This page is out of date. Reload to see the latest.", result.body().get("reason").textValue());
        }
        assertEquals(0, pg.count("SELECT count(*) FROM policy_run_activation"));
        assertEquals(Optional.empty(), pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1"));
    }

    @Test
    void policyReadFailuresPassThrough() throws Exception {
        pg.source.loadVersions("run-1");
        pg.update("ALTER TABLE policy_documents DISABLE TRIGGER policy_documents_immutable");
        pg.update("UPDATE policy_documents SET document = jsonb_set(document, '{source}', '\"tampered\"')");
        PolicyPg fresh = pg.restarted();
        PolicyResult result = fresh.activation.activate(PolicyPg.ctx("run-1"));
        assertEquals("invalid", result.status());
        assertEquals("source-invalid", result.code());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_run_activation"));
    }

    @Test
    void anUnreachableDatabaseIsUnavailableAndRetryable() throws Exception {
        PolicyPg down = pg.rewired(FaultDataSource::unreachable);
        PolicyResult result = down.activation.activate(PolicyPg.ctx("run-1"));
        assertEquals("unavailable", result.status());
        assertEquals("policy-activation-unavailable", result.code());
        assertTrue(result.body().get("retryable").booleanValue());
        assertFalse(result.body().toString().contains("secret-host"));
    }

    @Test
    void activationRowsRefuseAVersionThatDoesNotExistForTheRun() throws Exception {
        pg.source.loadVersions("run-1");
        org.junit.jupiter.api.Assertions.assertThrows(SQLException.class, () -> pg.update(
                "INSERT INTO policy_run_activation (environment_id, run_id, policy_version, as_of) VALUES (?, 'run-1', 'ghost', now())",
                PolicyPg.ENV));
    }
}
