package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
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

    @Test
    void referenceMetadataComesFromEachImmutableArtifact() throws Exception {
        String next = "sha256:e5205f65966d87d6895509bda13fa861e87476d843aabecce7bd76bf0e4fffc2";
        for (String id : new String[] {MODEL, next}) {
            ModelArtifact artifact = with(VERSION, id).selection.artifacts().read(id);
            ObjectNode row = LearnedModelActivation.reference(id, artifact, Instant.parse("2026-11-27T10:00:00Z"));
            assertEquals("docs/gcsp/models/artifacts/" + id.substring(7) + ".json", row.path("source").asText());
            assertEquals(id.equals(MODEL) ? "2026-11-06" : "2026-11-26", row.path("sourceDate").asText());
            assertTrue(row.path("basis").asText().contains(artifact.payload().at("/optimizer/status").asText()));
            assertTrue(!row.path("basis").asText().contains("worse Brier"));
        }
    }

    @Test
    void absentOrInvalidTrainingDatesUseExplicitAdoptionObservationWithoutInventingMetrics() {
        ModelArtifact retained = with(VERSION, MODEL).selection.artifacts().read(MODEL);
        for (String date : new String[] {"", "not-an-instant"}) {
            ObjectNode payload = retained.payload().deepCopy();
            ((ObjectNode) payload.at("/trainingSettings/policyRead")).put("asOf", date);
            ((ObjectNode) payload.path("optimizer")).remove("status");
            ModelArtifact unknown = ModelArtifact.create(payload);
            ObjectNode row = LearnedModelActivation.reference(unknown.artifactId(), unknown, Instant.parse("2026-11-27T10:00:00Z"));
            assertEquals("2026-11-27", row.path("sourceDate").asText());
            assertTrue(row.path("basis").asText().contains("Optimizer status: unknown"));
            assertTrue(row.path("basis").asText().contains("Training date unavailable; sourceDate records adoption observation"));
        }
    }

    @Test
    void aDifferentActualOptimizerStatusIsRetainedWithoutReplacingItsEvaluation() {
        ObjectNode payload = with(VERSION, MODEL).selection.artifacts().read(MODEL).payload().deepCopy();
        ((ObjectNode) payload.path("optimizer")).put("status", "converged");
        ModelArtifact changed = ModelArtifact.create(payload);
        ObjectNode row = LearnedModelActivation.reference(changed.artifactId(), changed, Instant.parse("2026-11-27T10:00:00Z"));
        assertTrue(row.path("basis").asText().contains("Optimizer status: converged"));
        assertTrue(!row.path("basis").asText().contains("iteration-limit"));
    }
}
