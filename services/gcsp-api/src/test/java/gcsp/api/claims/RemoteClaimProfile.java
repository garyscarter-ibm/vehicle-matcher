package gcsp.api.claims;

import gcsp.api.JwksServerResource;
import gcsp.api.account.ClaimCompositionSeed;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;

/**
 * The documented dev composition with the real HttpClaimStock (provider remote) aimed at a loopback stock endpoint.
 * Schema names are fixed: the profile is loaded by two classloaders, so a clock-derived name would differ between them.
 */
public abstract class RemoteClaimProfile implements QuarkusTestProfile {

    abstract String schema();

    abstract boolean seedRestart();

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = ClaimCompositionSeed.config(schema());
        c.put("gcsp.claims.stock.provider", "remote");
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(RemoteClaimStockResource.class,
                        Map.of("schema", schema(), "seed-restart", Boolean.toString(seedRestart()))));
    }

    /** Claim, release, expiry and duplicate behaviour over a clean schema the test seeds itself. */
    public static class Lifecycle extends RemoteClaimProfile {
        static final String SCHEMA = "gcsp_s_acctdev_remote_c";

        @Override
        String schema() {
            return SCHEMA;
        }

        @Override
        boolean seedRestart() {
            return false;
        }
    }

    /** A schema that a previous process left with a claim whose answer was lost. */
    public static class Restart extends RemoteClaimProfile {
        static final String SCHEMA = "gcsp_s_acctdev_restart_c";

        @Override
        String schema() {
            return SCHEMA;
        }

        @Override
        boolean seedRestart() {
            return true;
        }
    }
}
