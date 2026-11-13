package gcsp.api;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/** Test-only principal; the selection rule refuses fixed-test outside test launch mode. */
public class FixedTestIdentityProfile implements QuarkusTestProfile {

    static final String TOKEN = "test-access-token";
    static final String UNMAPPED = "test-unmapped-token";

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "gcsp.identity.provider", "fixed-test",
                "gcsp.identity.fixed-test.token", TOKEN,
                "gcsp.identity.fixed-test.unmapped-token", UNMAPPED,
                "gcsp.identity.fixed-test.subject", "test-provider-subject",
                "gcsp.identity.fixed-test.roles", "employee",
                "gcsp.identity.fixed-test.environment-id", "isolated-dev",
                "gcsp.identity.fixed-test.run-id", "server-current-run",
                "gcsp.identity.fixed-test.employee-id", "server-mapped-id",
                "gcsp.identity.fixed-test.policy-version", "retained-version",
                "gcsp.identity.fixed-test.capabilities", "account:read");
    }
}
