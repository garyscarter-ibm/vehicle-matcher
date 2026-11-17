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

/** The selected CDI port and the startup path; account stays none here, so the selected calculation must refuse. */
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
    void startupInjectsTheSelectedCalculationWhichIgnoresTheCallersAccountRecord() throws Exception {
        // The request carries a complete account record; selected account=none still refuses.
        Unavailable refused = assertInstanceOf(Unavailable.class, candidates.evaluate(RecommendationCandidatesTest.request()));
        assertEquals(SelectedAccountCandidates.UNAVAILABLE, refused.code());
    }

    @Test
    void recommendationOverSelectedRecordsComputesTheCanonicalDecisions() throws Exception {
        EligibleCandidates selected = CandidatesSelection.select("recommendation", SourceFixture.policy(),
                SourceFixture.records("paula"));
        assertInstanceOf(SelectedAccountCandidates.class, selected);
        Evaluated result = assertInstanceOf(Evaluated.class, selected.evaluate(RecommendationCandidatesTest.request()));
        assertEquals("eligible", result.decisions().get(0).gateStatus());
        assertEquals(Double.valueOf(100), result.decisions().get(0).score());
        assertEquals("ineligible", result.decisions().get(1).gateStatus());
        assertEquals("gcsp-policy-v1", result.versions().path("policy").asText());
    }

    @Test
    void unsetBlankAndNonePreserveTheRefusingDefault() throws Exception {
        for (String provider : new String[] {null, "", "  ", "none", " none "}) {
            EligibleCandidates selected = CandidatesSelection.select(provider, SourceFixture.policy(),
                    SourceFixture.records("paula"));
            assertInstanceOf(UnconfiguredCandidates.class, selected);
            assertEquals("recommendation-unavailable", assertInstanceOf(Unavailable.class, selected.evaluate(null)).code());
        }
        assertInstanceOf(SelectedAccountCandidates.class,
                CandidatesSelection.select(" recommendation ", SourceFixture.policy(), SourceFixture.records("paula")));
    }

    @Test
    void anUnknownProviderFailsStartupInitialization() throws Exception {
        CandidatesSelection selection = new CandidatesSelection();
        selection.provider = "unrecognised";
        selection.policy = SourceFixture.policy();
        selection.records = SourceFixture.records("paula");
        IllegalStateException failure = assertThrows(IllegalStateException.class, selection::init);
        assertTrue(failure.getMessage().contains(CandidatesSelection.KEY));
        assertTrue(failure.getMessage().contains("unrecognised"));
        assertTrue(failure.getMessage().contains("none, recommendation"));
    }
}
