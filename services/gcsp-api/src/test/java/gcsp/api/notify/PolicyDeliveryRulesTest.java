package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** notify.delivery.v1 is read from the retained canonical policy, never from literals in notify code. */
class PolicyDeliveryRulesTest {

    @Test
    void readsTheCanonicalDeliveryRules() {
        DeliveryRules.Result r = new PolicyDeliveryRules(new PolicyService(new RetainedFilePolicySource()))
                .read("run-1", Instant.parse("2026-11-14T00:00:00Z"));
        DeliveryRules.Rules rules = assertInstanceOf(DeliveryRules.Rules.class, r);
        assertEquals(3, rules.maxAttempts());
        assertEquals(30, rules.retryBaseSeconds());
        assertEquals(300, rules.retryMaximumSeconds());
        assertEquals(true, rules.valid() && rules.policyVersion() != null && !rules.policyVersion().isBlank());
    }

    @Test
    void beforeAnyPolicyIsInForceItIsUnavailable() {
        assertInstanceOf(DeliveryRules.Unavailable.class,
                new PolicyDeliveryRules(new PolicyService(new RetainedFilePolicySource()))
                        .read("run-1", Instant.parse("2000-01-01T00:00:00Z")));
    }
}
