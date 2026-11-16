package gcsp.api.comparison;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.comparison.RetainedComparisonResults.Refused;
import gcsp.api.comparison.RetainedComparisonResults.Retained;
import gcsp.api.evidence.CanonicalJson;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The retained envelope check against the real file, with tiny mutations built in memory. */
class RetainedComparisonResultsTest {

    static final String PROCESS_ID = "process-comparison-94c7760154fa5a05d5d6dc9b7c768fa0";
    static final String DIGEST = "d388e3371ea4a7f3c3665102e9452e7ccd0940b685b64fa2d623e7e47a3f3027";
    private static final ObjectMapper JSON = new ObjectMapper();

    static ObjectNode envelope() throws Exception {
        try (InputStream in = RetainedComparisonResults.class.getClassLoader()
                .getResourceAsStream(RetainedComparisonResults.DEFAULT_RESOURCE)) {
            return (ObjectNode) JSON.readTree(in);
        }
    }

    /** Re-signs the envelope so only the mutated field can fail. */
    private static ObjectNode signed(ObjectNode envelope) {
        envelope.put("digest", CanonicalJson.digest(envelope.get("result")));
        return envelope;
    }

    @Test
    void theBundledFileIsVerifiedWithTheNodeIdAndDigest() {
        List<String> refusals = new ArrayList<>();
        List<Retained> loaded = RetainedComparisonResults.load(List.of(), refusals::add);
        assertTrue(refusals.isEmpty());
        assertEquals(1, loaded.size());
        Retained r = loaded.get(0);
        assertEquals(PROCESS_ID, r.resultId());
        assertEquals(DIGEST, r.digest());
        assertEquals("process-only", r.experimentId());
        assertEquals("process-comparison", r.kind());
        assertEquals("gcsp-policy-v1", r.policyVersion());
    }

    @Test
    void aChangedResultFailsItsDigest() throws Exception {
        ObjectNode e = envelope();
        ((ObjectNode) e.get("result")).put("completedAt", "2026-11-09T18:12:24.450Z");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(e));
    }

    @Test
    void aWrongFormatIsRefused() throws Exception {
        ObjectNode e = envelope();
        e.put("format", "gcsp-experiment-comparison-result-v1");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(e));
        e.put("format", "something-else");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(e));
    }

    @Test
    void aWrongCaveatIsRefusedEvenWhenReSigned() throws Exception {
        ObjectNode e = envelope();
        ((ObjectNode) e.get("result")).put("caveat", "Calculated fit is observed satisfaction.");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(signed(e)));
    }

    @Test
    void anUnknownExperimentOrSchemaIsRefusedEvenWhenReSigned() throws Exception {
        ObjectNode e = envelope();
        ((ObjectNode) e.get("result")).put("experimentId", "mystery");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(signed(e)));
        ObjectNode f = envelope();
        ((ObjectNode) f.get("result")).put("schemaVersion", 2);
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(signed(f)));
    }

    @Test
    void anExperimentEnvelopeNeedsAWhatIfExperimentAndArms() throws Exception {
        ObjectNode e = envelope();
        e.put("format", RetainedComparisonResults.EXPERIMENT_FORMAT);
        ObjectNode result = (ObjectNode) e.get("result");
        result.put("kind", "experiment-comparison");
        assertThrows(Refused.class, () -> RetainedComparisonResults.verify(signed(e)));
        result.put("experimentId", "points");
        JsonNode seeds = result.remove("perSeed");
        result.set("arms", seeds);
        Retained r = null;
        try {
            r = RetainedComparisonResults.verify(signed(e));
        } catch (Refused refused) {
            throw new AssertionError(refused);
        }
        assertTrue(r.resultId().startsWith("points-comparison-"));
        assertEquals("points-comparison-".length() + 32, r.resultId().length());
    }

    @Test
    void aMissingFileIsReportedWithoutItsPath() {
        List<String> refusals = new ArrayList<>();
        List<Retained> loaded = RetainedComparisonResults.load(List.of(java.nio.file.Path.of("/nonexistent/secret-name.json")),
                refusals::add);
        assertTrue(loaded.isEmpty());
        assertEquals(1, refusals.size());
        assertTrue(!refusals.get(0).contains("secret-name"));
    }
}
