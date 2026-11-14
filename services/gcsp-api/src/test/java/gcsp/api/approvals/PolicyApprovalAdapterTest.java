package gcsp.api.approvals;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The approvals policy port over the canonical PolicyService and retained seed: no fixture, no default. */
class PolicyApprovalAdapterTest {

    private static PolicyApprovalAdapter adapter(String runId) {
        return new PolicyApprovalAdapter(new PolicyService(new RetainedFilePolicySource()),
                ctx -> Instant.parse("2026-11-13T12:00:00Z"), "isolated-dev", runId);
    }

    @Test
    void theFourApprovalKeysLoadAtThePinnedVersionAndGiveTheHrStageList() {
        ApprovalPolicyPort.Read read = adapter("run-1").entries("gcsp-policy-v1", ApprovalPolicy.KEYS);
        ApprovalPolicyPort.Found found = assertInstanceOf(ApprovalPolicyPort.Found.class, read);
        assertEquals(ApprovalPolicy.KEYS.size(), found.entries().size());
        assertTrue(found.entries().values().stream().allMatch(e -> e.isObject() && e.has("value")));
        ApprovalPolicy.Loaded loaded = ApprovalPolicy.load(adapter("run-1"), "gcsp-policy-v1", ApprovalFixture.FULL);
        ApprovalPolicy.Policy p = assertInstanceOf(ApprovalPolicy.Ok.class, loaded).policy();
        assertTrue(p.stageList().contains("HR approval"), p.stageList().toString());
    }

    @Test
    void anUnknownVersionIsVersionNotFoundAndAnUnknownKeyStaysAbsent() {
        assertInstanceOf(ApprovalPolicyPort.VersionNotFound.class, adapter("run-1").entries("nope-v9", ApprovalPolicy.KEYS));
        assertInstanceOf(ApprovalPolicy.OrderScoped.class, ApprovalPolicy.load(adapter("run-1"), "nope-v9", null));
        ApprovalPolicyPort.Found found = assertInstanceOf(ApprovalPolicyPort.Found.class,
                adapter("run-1").entries("gcsp-policy-v1", List.of("no.such.key")));
        assertTrue(found.entries().isEmpty());
    }

    @Test
    void aMissingRunIsASourceFailureNotADefault() {
        assertEquals("policy-source-unavailable", assertInstanceOf(ApprovalPolicyPort.Unavailable.class,
                adapter("").entries("gcsp-policy-v1", ApprovalPolicy.KEYS)).code());
    }
}
