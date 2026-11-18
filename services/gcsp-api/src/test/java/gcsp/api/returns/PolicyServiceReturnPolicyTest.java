package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The canonical adapter over the classpath seed (gcsp-policy-v1): the same validation as the retained file. */
class PolicyServiceReturnPolicyTest {

    static final Instant AFTER = Instant.parse("2026-11-10T09:00:00Z");

    final PolicyService service = new PolicyService(new RetainedFilePolicySource());

    @Test
    void theSeedYieldsTheTwoChoices() {
        ReturnPolicyReading r = new PolicyServiceReturnPolicy(service, null).read("run-1", AFTER, "gcsp-policy-v1");
        ReturnPolicy p = assertInstanceOf(ReturnPolicyReading.Ok.class, r).policy();
        assertEquals("gcsp-policy-v1", p.policyVersion());
        assertEquals(List.of("same-visit", "separate"), p.choices().stream().map(ReturnPolicy.Choice::id).toList());
        assertEquals(6, p.assumptions().size());
    }

    @Test
    void anUnknownVersionABeforeEffectiveInstantOrNoInstantIsUnavailable() {
        PolicyServiceReturnPolicy policy = new PolicyServiceReturnPolicy(service, null);
        assertInstanceOf(ReturnPolicyReading.Unavailable.class, policy.read("run-1", AFTER, "gcsp-policy-v9"));
        assertInstanceOf(ReturnPolicyReading.Unavailable.class, policy.read("run-1", null, "gcsp-policy-v1"));
        assertInstanceOf(ReturnPolicyReading.Unavailable.class,
                policy.read("run-1", Instant.parse("2026-11-01T00:00:00Z"), "gcsp-policy-v1"));
        assertInstanceOf(ReturnPolicyReading.Unavailable.class, policy.read("run-1", AFTER, null));
    }

    @Test
    void theConfiguredVersionIsTheCurrentOneElseTheActiveVersion() {
        assertEquals("gcsp-policy-v1", new PolicyServiceReturnPolicy(service, " gcsp-policy-v1 ").currentVersion("run-1"));
        assertEquals("configured-v2", new PolicyServiceReturnPolicy(service, "configured-v2").currentVersion("run-1"));
        assertEquals("gcsp-policy-v1", new PolicyServiceReturnPolicy(service, "").currentVersion("run-1"));
        assertNull(new PolicyServiceReturnPolicy(new PolicyService(run -> {
            throw new IllegalStateException("down");
        }), null).currentVersion("run-1"));
    }
}
