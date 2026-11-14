package gcsp.api.cases;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The case policy port over the canonical PolicyService and the retained seed. */
class PolicyCaseAdapterTest {

    private static final PolicyService SERVICE = new PolicyService(
            new RetainedFilePolicySource(Path.of("../../server/gcsp/policy/seed-v1.json"), List.of()));
    private static final PolicyClock CLOCK = context -> Instant.parse("2026-11-05T09:00:00Z");

    private static PolicyCaseAdapter adapter(String run) {
        return new PolicyCaseAdapter(SERVICE, CLOCK, Optional.of("env"), Optional.of(run));
    }

    @Test
    void theSeedVersionGivesAllNineRowsAndAValidCasePolicy() {
        var rows = adapter("run-1").assumptions("gcsp-policy-v1").orElseThrow();
        assertEquals(CasePolicy.KEYS, List.copyOf(rows.keySet()));
        CasePolicy p = CasePolicy.load(adapter("run-1"), "gcsp-policy-v1").orElseThrow();
        assertEquals("scheme-team", p.ownerRole());
        assertEquals(24, p.dueHours());
        assertFalse(p.extensionPermitted());
    }

    @Test
    void anUnknownVersionABlankRunOrABlankVersionIsEmpty() {
        assertTrue(adapter("run-1").assumptions("no-such-version").isEmpty());
        assertTrue(adapter("").assumptions("gcsp-policy-v1").isEmpty());
        assertTrue(adapter("run-1").assumptions(" ").isEmpty());
    }
}
