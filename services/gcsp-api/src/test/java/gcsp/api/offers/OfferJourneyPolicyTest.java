package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The startup rule's decisions that need no database; the adoption itself is PolicyAdoptionPostgresTest's. */
class OfferJourneyPolicyTest {

    private static OfferJourneyPolicy with(String version, String env, String run) {
        OfferJourneyPolicy p = new OfferJourneyPolicy();
        p.persistence = new Persistence();
        p.policyVersion = Optional.ofNullable(version);
        p.environmentId = Optional.ofNullable(env);
        p.runId = Optional.ofNullable(run);
        return p;
    }

    @Test
    void anyOtherConfiguredVersionDoesNothing() {
        assertEquals("not-configured", with("gcsp-policy-v1", "env", "run-1").ensure());
        assertEquals("not-configured", with(null, null, null).ensure());
        assertEquals("not-configured", with("", "", "").ensure());
    }

    @Test
    void theSuffixWithoutPersistenceStopsStartupWithAClearMessage() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> with("gcsp-policy-v1+offer-journey-v1", "env", "run-1").ensure());
        assertTrue(e.getMessage().contains("GCSP_POLICY_VERSION=gcsp-policy-v1+offer-journey-v1"), e.getMessage());
        assertTrue(e.getMessage().contains("PostgreSQL"), e.getMessage());
    }

    @Test
    void theObserverRunsAfterTheRunClockAndTheComparisonJobs() {
        assertTrue(OfferJourneyPolicy.AFTER_CLOCK > jakarta.interceptor.Interceptor.Priority.LIBRARY_AFTER + 10);
    }

    @Test
    void theSuccessorAlsoUsesTheExistingPersistedStartupAdoption() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> with("gcsp-policy-v1+offer-journey-v2", "env", "run-1").ensure());
        assertTrue(e.getMessage().contains("PostgreSQL"), e.getMessage());
    }
}
