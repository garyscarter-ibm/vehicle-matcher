package gcsp.api;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.List;
import java.util.Map;

/** Selects the oidc provider against the in-test JWKS server; accounts are synthetic, not real subjects. */
public class OidcTestProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]},"
            + "{\"subject\":\"sub-greg-only\",\"roles\":[\"greg\"]}]";

    @Override
    public Map<String, String> getConfigOverrides() {
        return Map.of(
                "gcsp.identity.provider", "oidc",
                "gcsp.oidc.issuer", ISSUER,
                "gcsp.oidc.audience", AUDIENCE,
                "gcsp.oidc.authorized-party", CLIENT,
                "gcsp.oidc.required-scopes", "gcsp-api",
                "gcsp.oidc.accounts", ACCOUNTS,
                "gcsp.environment.id", "isolated-dev",
                "gcsp.environment.run-id", "test-run-1",
                "gcsp.environment.policy-version", "test-policy-1");
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
