package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Unavailable;
import gcsp.api.allocation.UnconfiguredCandidates;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Exercises the selected CDI port and the same initialization path that startup invokes. */
@QuarkusTest
@TestProfile(CandidatesSelectionTest.RecommendationProfile.class)
class CandidatesSelectionTest {

    @Inject
    EligibleCandidates candidates;

    public static class RecommendationProfile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(CandidatesSelection.KEY, "recommendation");
        }
    }

    @Test
    void startupInjectsTheRealSelectedCalculation() throws Exception {
        Evaluated result = assertInstanceOf(Evaluated.class, candidates.evaluate(RecommendationCandidatesTest.request()));
        assertEquals("eligible", result.decisions().get(0).gateStatus());
        assertEquals(Double.valueOf(100), result.decisions().get(0).score());
        assertEquals("ineligible", result.decisions().get(1).gateStatus());
        assertEquals("gcsp-policy-v1", result.versions().path("policy").asText());
    }

    @Test
    void unsetBlankAndNonePreserveTheRefusingDefault() {
        for (String provider : new String[] {null, "", "  ", "none", " none "}) {
            EligibleCandidates selected = CandidatesSelection.select(provider, SourceFixture.policy());
            assertInstanceOf(UnconfiguredCandidates.class, selected);
            assertEquals("recommendation-unavailable", assertInstanceOf(Unavailable.class, selected.evaluate(null)).code());
        }
        assertInstanceOf(RecommendationCandidates.class, CandidatesSelection.select(" recommendation ", SourceFixture.policy()));
    }

    @Test
    void anUnknownProviderFailsStartupInitialization() {
        CandidatesSelection selection = new CandidatesSelection();
        selection.provider = "unrecognised";
        selection.policy = SourceFixture.policy();
        IllegalStateException failure = assertThrows(IllegalStateException.class, selection::init);
        assertTrue(failure.getMessage().contains(CandidatesSelection.KEY));
        assertTrue(failure.getMessage().contains("unrecognised"));
        assertTrue(failure.getMessage().contains("none, recommendation"));
    }
}
