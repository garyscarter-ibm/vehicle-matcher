package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The startup rule for the return provider and policy: no silent fallback, refusals stop startup. */
class ReturnSelectionTest {

    static final String POLICY = Path.of("src/test/resources/returns/policy.json").toAbsolutePath().toString();

    @TempDir Path dir;

    @Test
    void defaultIsNoneWithAnUnconfiguredPolicy() {
        for (String name : new String[] {null, "", "  ", "none"}) {
            ReturnSelection.Selected s = ReturnSelection.select(name, null);
            assertEquals("none", s.providerName());
            assertInstanceOf(UnconfiguredReturnPolicy.class, s.policy());
            assertEquals("none", s.policyMode());
            ReturnProviderPort p = ReturnSelection.provider(s.providerName(), () -> {
                throw new AssertionError("none needs no database");
            });
            assertEquals("none", p.mode());
            assertEquals(ReturnProviderPort.Status.UNAVAILABLE, p.offerSlots(new SlotPolicy(1, 1, 60, java.util.List.of("09:00")), ReturnsFixture.T0).status());
        }
    }

    @Test
    void syntheticAndLiveStubAreSelectable() throws Exception {
        assertEquals("synthetic", ReturnSelection.select("synthetic", null).providerName());
        assertEquals("live-stub", ReturnSelection.select(" live-stub ", null).providerName());
        try (ReturnsFixture f = ReturnsFixture.create()) {
            assertInstanceOf(SyntheticReturnProvider.class, ReturnSelection.provider("synthetic", () -> {
                try {
                    return f.pool();
                } catch (java.sql.SQLException e) {
                    throw new IllegalStateException(e);
                }
            }));
        }
        assertInstanceOf(LiveReturnProviderStub.class, ReturnSelection.provider("live-stub", () -> null));
        assertInstanceOf(UnconfiguredReturnProvider.class, ReturnSelection.provider("synthetic", () -> {
            throw new IllegalStateException("Persistence is not configured");
        }));
    }

    @Test
    void anUnknownProviderStopsStartupNamingTheSupportedValues() {
        for (String name : new String[] {"live", "tranche-plan", "Synthetic", "fake"}) {
            IllegalStateException e = assertThrows(IllegalStateException.class, () -> ReturnSelection.select(name, null));
            assertTrue(e.getMessage().contains("none") && e.getMessage().contains("synthetic")
                    && e.getMessage().contains("live-stub"));
        }
    }

    @Test
    void aPolicyFileSelectsTheRetainedReader() {
        ReturnSelection.Selected s = ReturnSelection.select("none", POLICY);
        assertInstanceOf(RetainedReturnPolicy.class, s.policy());
        assertEquals("file", s.policyMode());
        assertInstanceOf(ReturnPolicyReading.Ok.class, s.policy().read("run-1", ReturnsFixture.T0, ReturnsFixture.POLICY_VERSION));
    }

    @Test
    void aSetButUnreadablePolicyFileStopsStartup() throws Exception {
        assertThrows(IllegalStateException.class, () -> ReturnSelection.select("none", dir.resolve("missing.json").toString()));
        assertThrows(IllegalStateException.class, () -> ReturnSelection.select("none", dir.toString()));
        Path ok = Files.writeString(dir.resolve("p.json"), "{}");
        assertInstanceOf(RetainedReturnPolicy.class, ReturnSelection.select("none", ok.toString()).policy());
    }
}
