package gcsp.api.demand;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/** The three Quarkus profiles of the demand and suitability HTTP tests: Greg, the presenter, and no database. */
public final class DemandHttpProfiles {

    static final String TOKEN = "demand-token";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");

    private DemandHttpProfiles() {}

    /** The run clock the projections read; kept if another test already seeded it. */
    static void ensureRunClock() throws java.sql.SQLException {
        try (var c = java.sql.DriverManager.getConnection(URL); var st = c.createStatement()) {
            st.execute("SET search_path TO gcsp_app");
            st.execute("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, fixture_version, "
                    + "starts_at, named_times) VALUES ('test-app-env', 'run-1', now(), 1, 's1', 'f1', now(), '{}'::jsonb) "
                    + "ON CONFLICT DO NOTHING");
        }
    }

    static Map<String, String> identity(String roles) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "demand-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        m.put("gcsp.identity.fixed-test.policy-version", "gcsp-policy-v1");
        m.put("gcsp.identity.fixed-test.capabilities", "greg:read");
        return m;
    }

    static Map<String, String> persisted(String roles) {
        Map<String, String> m = identity(roles);
        if (URL == null || URL.isBlank()) return noDatabase(m);
        m.put("quarkus.datasource.active", "true");
        m.put("quarkus.flyway.active", "true");
        m.put("quarkus.datasource.jdbc.url", URL);
        m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
        m.put("quarkus.flyway.schemas", "gcsp_app");
        m.put("gcsp.environment-id", "test-app-env");
        m.put("gcsp.database.expected-name", URL.replaceAll("^.*/([^/?]+)(\\?.*)?$", "$1"));
        return m;
    }

    static Map<String, String> noDatabase(Map<String, String> m) {
        m.put("quarkus.datasource.active", "false");
        m.put("quarkus.flyway.active", "false");
        return m;
    }

    static Set<Class<?>> ports() {
        return Set.of(DemandHttpPorts.SeedPolicy.class, DemandHttpPorts.EligibleEvaluation.class, DemandHttpPorts.EmptyOffers.class);
    }

    /** Greg with the shared test database. */
    public static class Greg implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return persisted("greg");
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return ports();
        }
    }

    /** The presenter with the shared test database. */
    public static class Presenter implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return persisted("presenter");
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return ports();
        }
    }

    /** Both roles, persistence switched off. */
    public static class NoDatabase implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return noDatabase(identity("greg,presenter"));
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return ports();
        }
    }
}
