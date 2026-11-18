package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The startup rule's decisions that need no database; the adoption itself is PolicyAdoptionPostgresTest's. */
class LearnedModelActivationTest {

    static final String MODEL = "sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d";
    static final String VERSION = "gcsp-policy-v1+learned-model-v1";

    private static LearnedModelActivation with(String version, String model) {
        LearnedModelActivation a = new LearnedModelActivation();
        a.persistence = new Persistence();
        a.selection = new LearningSelection();
        a.selection.artifactDir = Optional.empty();
        a.selection.init();
        a.policyVersion = Optional.ofNullable(version);
        a.activeModel = Optional.ofNullable(model);
        a.environmentId = Optional.of("env");
        a.runId = Optional.of("run-1");
        return a;
    }

    @Test
    void neitherSettingMeansOffAndNothingIsDone() {
        assertEquals("not-configured", with("gcsp-policy-v1", null).ensure());
        assertEquals("not-configured", with(null, null).ensure());
        assertEquals("not-configured", with("", "").ensure());
        assertEquals("not-configured", with("gcsp-policy-v1+offer-journey-v1", "").ensure());
    }

    @Test
    void oneSettingWithoutTheOtherStopsStartupNamingBoth() {
        for (LearnedModelActivation a : new LearnedModelActivation[] {with(VERSION, null), with(VERSION, " "),
                with("gcsp-policy-v1", MODEL)}) {
            IllegalStateException e = assertThrows(IllegalStateException.class, a::ensure);
            assertTrue(e.getMessage().contains("GCSP_LEARNING_ACTIVE_MODEL"), e.getMessage());
            assertTrue(e.getMessage().contains("GCSP_POLICY_VERSION"), e.getMessage());
        }
    }

    @Test
    void anInvalidOrUnknownArtifactIdStopsStartup() {
        IllegalStateException bad = assertThrows(IllegalStateException.class, () -> with(VERSION, "sha256:abc").ensure());
        assertTrue(bad.getMessage().contains("sha256:"), bad.getMessage());
        String unknown = "sha256:" + "0".repeat(64);
        IllegalStateException missing = assertThrows(IllegalStateException.class, () -> with(VERSION, unknown).ensure());
        assertTrue(missing.getMessage().contains("not readable and verified"), missing.getMessage());
        assertTrue(missing.getMessage().contains("artifact-unavailable"), missing.getMessage());
    }

    @Test
    void aVerifiedModelWithoutPersistenceStopsStartup() {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> with(VERSION, MODEL).ensure());
        assertTrue(e.getMessage().contains("PostgreSQL"), e.getMessage());
    }

    @Test
    void theObserverRunsAfterTheOfferJourneyPolicyAndTheClock() {
        assertTrue(LearnedModelActivation.AFTER_CLOCK == jakarta.interceptor.Interceptor.Priority.LIBRARY_AFTER + 30);
    }
}
