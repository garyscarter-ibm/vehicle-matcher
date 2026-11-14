package gcsp.api.account;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** oidc identity plus the hr-snapshot provider over a file generated from the Node goldens at startup. */
public class AccountHttpProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String KID = "test-key-1";
    static final Path SNAPSHOT = Paths.get("target", "account-http", "hr-export.json").toAbsolutePath();
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
            + "{\"subject\":\"sub-jordan\",\"roles\":[\"employee\"],\"employeeId\":\"employee-jordan\"},"
            + "{\"subject\":\"sub-nobody\",\"roles\":[\"employee\"],\"employeeId\":\"employee-nobody\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]";

    String provider() {
        return "hr-snapshot";
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        GoldenFixture paula = new GoldenFixture("paula");
        try {
            HrExportFixture.write(SNAPSHOT,
                    HrExportFixture.export(List.of(paula, new GoldenFixture("jordan"))));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", AUDIENCE);
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", paula.scope.environmentId());
        c.put("gcsp.environment.run-id", paula.scope.runId());
        c.put("gcsp.environment.policy-version", paula.scope.policyVersion());
        c.put("gcsp.account.provider", provider());
        c.put("gcsp.account.hr-snapshot.path", SNAPSHOT.toString());
        c.put("gcsp.account.fixed-now", paula.now);
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }

    /** Same identity, provider "none". */
    public static class NoProvider extends AccountHttpProfile {
        @Override
        String provider() {
            return "none";
        }
    }
}
