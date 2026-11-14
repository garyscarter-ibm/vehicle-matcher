package gcsp.api.approvals;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The startup rule for the approval provider and policy: no silent fallback, refusals stop startup. */
class ApprovalSelectionTest {

    static final String SEED = Path.of("../../server/gcsp/policy/seed-v1.json").toAbsolutePath().toString();

    @TempDir
    Path dir;

    @Test
    void defaultIsNoneWithAnUnconfiguredPolicy() {
        for (String name : new String[] {null, "", "  ", "none"}) {
            ApprovalSelection.Selected s = ApprovalSelection.select(name, null);
            assertEquals("none", s.provider());
            assertInstanceOf(UnconfiguredApprovalPolicy.class, s.policy());
            assertEquals("none", s.policyMode());
        }
        assertInstanceOf(UnconfiguredApprovalPolicy.class, ApprovalSelection.select("synthetic", "  ").policy());
    }

    @Test
    void everySupportedProviderMapsToItsStatusAdapter() {
        assertEquals("none", ApprovalSelection.statusFor("none", null).mode());
        assertEquals("synthetic", ApprovalSelection.statusFor("synthetic", null).mode());
        assertEquals("live", ApprovalSelection.statusFor("live-stub", null).mode());
    }

    @Test
    void unknownProviderStopsStartupNamingTheSupportedValues() {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> ApprovalSelection.select("tranche-plan", null));
        assertTrue(e.getMessage().contains("none") && e.getMessage().contains("synthetic")
                && e.getMessage().contains("live-stub"), e.getMessage());
    }

    @Test
    void aPolicyFileIsReadableOrStartupStops() throws Exception {
        ApprovalSelection.Selected s = ApprovalSelection.select("synthetic", SEED);
        assertInstanceOf(RetainedApprovalPolicy.class, s.policy());
        assertEquals("file", s.policyMode());
        assertThrows(IllegalStateException.class, () -> ApprovalSelection.select("synthetic", dir.resolve("missing.json").toString()));
        assertThrows(IllegalStateException.class, () -> ApprovalSelection.select("none", dir.toString()));
        Path ok = Files.writeString(dir.resolve("p.json"), "{}");
        assertEquals("file", ApprovalSelection.select("none", ok.toString()).policyMode());
    }

    @Test
    void anUnconfiguredPolicyKnowsNoVersion() {
        assertInstanceOf(ApprovalPolicyPort.VersionNotFound.class,
                new UnconfiguredApprovalPolicy().entries("gcsp-policy-v1", java.util.List.of("k")));
    }
}
