package gcsp.api.claims;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;

/** The documented dev composition over a schema of its own; the claims tests drive the real beans through HTTP. */
public class ClaimCompositionProfile implements QuarkusTestProfile {

    private static final String SCHEMA = "gcsp_s_acctdev_claims_" + Long.toHexString(System.nanoTime());

    @Override
    public Map<String, String> getConfigOverrides() {
        return ClaimCompositionSeed.config(SCHEMA);
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
