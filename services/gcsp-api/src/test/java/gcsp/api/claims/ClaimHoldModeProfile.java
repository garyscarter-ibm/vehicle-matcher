package gcsp.api.claims;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The claim dev composition over its own schema with no global test alternative in force, so ordering is the real bean. */
public class ClaimHoldModeProfile implements QuarkusTestProfile {

    static final String SCHEMA = "gcsp_s_acctdev_claimholdmode_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>(ClaimCompositionSeed.config(SCHEMA));
        c.merge("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,gcsp.api.documents.DocumentsTestPorts$Policy,"
                + "gcsp.api.documents.DocumentsTestPorts$Cases,gcsp.api.documents.DocumentsTestPorts$Clock", (a, b) -> a + "," + b);
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
