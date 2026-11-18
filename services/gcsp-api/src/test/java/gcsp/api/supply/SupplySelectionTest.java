package gcsp.api.supply;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.policy.PolicyReleaseAdapter;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The startup rule for the stock source and policy: no silent fallback, refusals stop startup. */
class SupplySelectionTest {

    static final String PLAN = Path.of("src/test/resources/supply/tranche-plan.json").toAbsolutePath().toString();
    static final String POLICY = Path.of("src/test/resources/supply/policy.json").toAbsolutePath().toString();

    private static final PolicyService SERVICE =
            new PolicyService(new RetainedFilePolicySource(Path.of("../../server/gcsp/policy/seed-v1.json"), List.of()));
    private static final SupplySelection.Deps DEPS = new SupplySelection.Deps(SERVICE, new PolicyReleaseAdapter(SERVICE),
            (run, ids) -> Map.of());

    @TempDir
    Path dir;

    @Test
    void defaultIsNoneWithAnUnconfiguredPolicy() {
        for (String name : new String[] {null, "", "  ", "none"}) {
            SupplySelection.Selected s = SupplySelection.select(name, null, null);
            assertInstanceOf(UnconfiguredProvider.class, s.provider());
            assertInstanceOf(UnconfiguredPolicy.class, s.policy());
            assertEquals("none", s.policyMode());
        }
    }

    @Test
    void tranchePlanReadsTheFileAndAPolicyFileSelectsTheRetainedReader() {
        SupplySelection.Selected s = SupplySelection.select("tranche-plan", PLAN, POLICY);
        assertEquals("tranche-plan", s.provider().mode());
        assertInstanceOf(RetainedPolicyFile.class, s.policy());
        assertEquals("file", s.policyMode());
    }

    @Test
    void unknownProviderStopsStartupNamingTheSupportedValues() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> SupplySelection.select("synthetic", PLAN, null));
        assertTrue(e.getMessage().contains("none") && e.getMessage().contains("tranche-plan")
                && e.getMessage().contains("demo"));
    }

    @Test
    void demoNeedsPolicyServiceAndBindsItsReleasePolicyByDefault() {
        SupplySelection.Selected s = SupplySelection.select("demo", null, null, DEPS);
        assertEquals("demo", s.provider().mode());
        assertInstanceOf(DemoSupplyProvider.class, s.provider());
        assertInstanceOf(PolicyReleaseAdapter.class, s.policy());
        assertEquals("policy-service", s.policyMode());
        assertThrows(IllegalStateException.class, () -> SupplySelection.select("demo", null, null));
    }

    @Test
    void withPolicyServiceBoundEveryProviderReadsThePolicyServiceUnlessAFileOverrides() {
        assertEquals("policy-service", SupplySelection.select("none", null, null, DEPS).policyMode());
        assertEquals("policy-service", SupplySelection.select("tranche-plan", PLAN, null, DEPS).policyMode());
        SupplySelection.Selected file = SupplySelection.select("demo", null, POLICY, DEPS);
        assertInstanceOf(RetainedPolicyFile.class, file.policy());
        assertEquals("file", file.policyMode());
    }

    @Test
    void tranchePlanNeedsAReadableValidPlan() throws Exception {
        assertThrows(IllegalStateException.class, () -> SupplySelection.select("tranche-plan", null, null));
        assertThrows(IllegalStateException.class, () -> SupplySelection.select("tranche-plan", "", null));
        assertThrows(IllegalStateException.class,
                () -> SupplySelection.select("tranche-plan", dir.resolve("missing.json").toString(), null));
        Path bad = Files.writeString(dir.resolve("bad.json"), "{\"label\":\"x\"}");
        assertThrows(IllegalStateException.class, () -> SupplySelection.select("tranche-plan", bad.toString(), null));
        Path notJson = Files.writeString(dir.resolve("text.json"), "not json");
        assertThrows(IllegalStateException.class,
                () -> SupplySelection.select("tranche-plan", notJson.toString(), null));
    }

    @Test
    void aSetButUnreadablePolicyFileStopsStartupEvenWithNoProvider() {
        assertThrows(IllegalStateException.class,
                () -> SupplySelection.select("none", null, dir.resolve("missing-policy.json").toString()));
        assertThrows(IllegalStateException.class, () -> SupplySelection.select("none", null, dir.toString()));
    }
}
