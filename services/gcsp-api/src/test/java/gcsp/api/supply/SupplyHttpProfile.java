package gcsp.api.supply;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/** Native test database in schema gcsp_app, a presenter principal and the synthetic tranche plan with its policy. */
public class SupplyHttpProfile implements QuarkusTestProfile {

    static final String TOKEN = "supply-presenter-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>();
        if (URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            m.put("quarkus.flyway.schemas", "gcsp_app");
            m.put("gcsp.environment-id", "test-app-env");
            m.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "test-presenter");
        m.put("gcsp.identity.fixed-test.roles", role());
        m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        m.put("gcsp.identity.fixed-test.policy-version", "retained-version");
        m.put("gcsp.identity.fixed-test.capabilities", "presenter:control,presenter:inspect");
        m.put("gcsp.supply.provider", provider());
        m.put("gcsp.supply.tranche-plan-file", abs("tranche-plan.json"));
        m.put("gcsp.supply.policy-file", abs("policy.json"));
        return m;
    }

    String role() {
        return "presenter";
    }

    String provider() {
        return "tranche-plan";
    }

    static String abs(String name) {
        return Path.of("src/test/resources/supply/" + name).toAbsolutePath().toString();
    }

    /** No stock source: a delivered tick is recorded and stays pending. */
    public static class NoProvider extends SupplyHttpProfile {
        @Override
        String provider() {
            return "none";
        }
    }

    /** A signed-in account without the presenter role. */
    public static class NotPresenter extends SupplyHttpProfile {
        @Override
        String role() {
            return "greg";
        }
    }
}
