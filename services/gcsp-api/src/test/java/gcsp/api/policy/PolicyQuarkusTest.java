package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.PersistenceProfile;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.List;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** With persistence on, CDI selects the PostgreSQL source and a publication round-trips. Skips without the URL. */
@QuarkusTest
@TestProfile(PersistenceProfile.class)
class PolicyQuarkusTest {

    @Inject
    PolicyService service;

    @Inject
    PolicySource source;

    @Inject
    Persistence persistence;

    @Inject
    PolicyActivation activation;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @Test
    void thePostgresSourceIsSelectedAndAPublicationRoundTripsThroughCdi() throws Exception {
        assertInstanceOf(PostgresPolicySource.class, ClientProxy.unwrap(source));
        String run = persistence.guard().currentRun().runId();
        Principal greg = new Principal("greg-quarkus", List.of("greg"), "test-app-env", run, null, "gcsp-policy-v1", List.of());
        String version = "quarkus-" + Long.toHexString(System.nanoTime());
        String from = PolicyClock.iso(java.time.Instant.now().plusSeconds(3600));
        PolicyResult active = service.getActiveVersion(new PolicyRead(run, PolicyClock.iso(java.time.Instant.now()), null));
        assertTrue(active.ok(), active.body().toString());
        PolicyResult accepted = service.publishPolicyVersion(greg, PolicyPg.holdChange("cmd-" + version, active.policyVersion(),
                version, from, 321));
        assertTrue(accepted.ok(), accepted.body().toString());
        String later = PolicyClock.iso(java.time.Instant.now().plusSeconds(7200));
        PolicyResult read = service.getAssumption(PolicyPg.HOLD, new PolicyRead(run, later, null));
        assertEquals(version, read.policyVersion());
        assertEquals(321, read.value().get("value").intValue());
        assertTrue(activation.activatedPolicyVersion("test-app-env", run).isPresent());
        PolicyResult employee = service.publishPolicyVersion(new Principal("e", List.of("employee"), "test-app-env", run, "e1",
                "gcsp-policy-v1", List.of()), PolicyPg.holdChange("cmd-x-" + version, version, version + "x", from, 1));
        assertEquals("forbidden", employee.status());
    }
}
