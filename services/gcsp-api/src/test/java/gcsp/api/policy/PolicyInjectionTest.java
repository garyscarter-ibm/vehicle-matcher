package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** The default profile (no database, no identity provider) serves the classpath copy of the retained seed. */
@QuarkusTest
class PolicyInjectionTest {

    @Inject
    PolicyService service;

    @Test
    void injectedServiceReadsTheClasspathSeed() {
        PolicyResult result = service.getActiveVersion(new PolicyRead("run-1", "2026-11-04T12:00:00Z", null));
        assertTrue(result.ok());
        assertEquals("gcsp-policy-v1", result.policyVersion());
    }
}
