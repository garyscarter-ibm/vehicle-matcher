package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import java.sql.SQLException;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Reviewed adoption on the native test cluster: the successor, pinned reads, the unchanged base and replay. */
class PolicyAdoptionPostgresTest {

    static final String V1 = "gcsp-policy-v1";
    static final String TARGET = V1 + "+offer-journey-v1";
    static final String DECLINE = "offer.declineReasons.v1";
    static final String FOLLOWUP = "offer.followupQuestions.v1";
    static final String AFTER = "2026-11-05T09:30:00Z";

    PolicyPg pg;
    PolicyAdoption adoption;

    @BeforeEach
    void setUp() throws Exception {
        pg = PolicyPg.create();
        adoption = new PolicyAdoption(pg.source, pg.file, pg.database, pg.activation);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (pg != null) {
            pg.close();
        }
    }

    private PolicyAdoption.Result adopt(Instant now) {
        return adoption.adopt(new RunContext(PolicyPg.ENV, "run-1", "startup"), "offer-journey-v1", TARGET, now, V1);
    }

    private PolicyResult read(String key, String pin) {
        return pg.service.getAssumption(key, new PolicyRead("run-1", AFTER, pin));
    }

    @Test
    void adoptingCreatesTheSuccessorWithBothKeysAndLeavesTheBaseUnchanged() throws Exception {
        assertFalse(read(DECLINE, V1).ok());
        PolicyAdoption.Result result = adopt(PolicyPg.T0);
        assertTrue(result.ok(), result.toString());
        assertEquals("adopted", result.status());
        assertTrue(result.written());
        assertTrue(result.activation().ok(), result.activation().body().toString());

        PolicyResult reasons = read(DECLINE, TARGET);
        assertTrue(reasons.ok(), reasons.body().toString());
        assertEquals(TARGET, reasons.policyVersion());
        assertTrue(reasons.value().get("value").get("reasons").size() > 0);
        assertTrue(read(FOLLOWUP, TARGET).ok());
        // The existing rule the decline path needs is carried over, and the base is untouched.
        assertTrue(read("offer.declinedCar.exclusion", TARGET).ok());
        assertFalse(read(DECLINE, V1).ok());
        assertFalse(read(FOLLOWUP, V1).ok());
        assertEquals(TARGET, pg.service.getActiveVersion(new PolicyRead("run-1", AFTER, null)).policyVersion());
        assertEquals(TARGET, pg.activation.activatedPolicyVersion(PolicyPg.ENV, "run-1").orElse(null));

        JsonNode stored = Seeds.MAPPER.readTree(pg.text("SELECT adoption::text FROM policy_versions WHERE policy_version = ?",
                TARGET));
        assertEquals("offer-journey-v1", stored.get("definitionSetId").textValue());
        assertEquals(ReviewedDefinitionsTest.NODE_DIGEST, stored.get("digest").textValue());
        assertEquals(2, stored.get("addedKeys").size());
        assertEquals(Instant.parse("2026-11-05T09:00:00Z"),
                Instant.parse(pg.text("SELECT to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') "
                        + "FROM policy_versions WHERE policy_version = ?", TARGET)));
        assertEquals(V1, pg.text("SELECT source_version FROM policy_versions WHERE policy_version = ?", TARGET));
        assertEquals(2, pg.count("SELECT count(*) FROM policy_versions"));
    }

    @Test
    void aReplayAndARestartWriteNothing() throws Exception {
        assertTrue(adopt(PolicyPg.T0).written());
        java.util.List<Long> before = pg.policyRows();
        PolicyAdoption.Result again = adopt(PolicyPg.T0.plusSeconds(60));
        assertEquals("present", again.status());
        assertFalse(again.written());
        PolicyPg after = pg.restarted();
        PolicyAdoption restarted = new PolicyAdoption(after.source, after.file, after.database, after.activation);
        assertEquals("present", restarted.adopt(new RunContext(PolicyPg.ENV, "run-1", "startup"), "offer-journey-v1",
                TARGET, PolicyPg.T0.plusSeconds(120), V1).status());
        assertEquals(before, pg.policyRows());
    }

    @Test
    void aWrongBaseOrUnknownSetIsRefusedWithoutWriting() throws Exception {
        PolicyAdoption.Result wrong = adoption.adopt(new RunContext(PolicyPg.ENV, "run-1", "startup"), "offer-journey-v1",
                "other+offer-journey-v1", PolicyPg.T0, "other");
        assertEquals("refused", wrong.status());
        assertTrue(wrong.detail().contains("not the version in force"), wrong.detail());
        assertEquals("refused", adoption.adopt(new RunContext(PolicyPg.ENV, "run-1", "startup"), "presenter-controls-v1",
                TARGET, PolicyPg.T0, V1).status());
        assertEquals(0, pg.count("SELECT count(*) FROM policy_versions"));
    }
}
