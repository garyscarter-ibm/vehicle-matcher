package gcsp.api.recommendation;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;
import org.postgresql.ds.PGSimpleDataSource;

/** Profiles of the recommendation HTTP tests; the database ones use a private schema (fixed name, dropped when the JVM exits). */
final class RecommendationHttpProfiles {

    static final String TOKEN = "recommendation-token";
    static final String ENV = "test-app-env";
    static final String RUN = "run-1";
    static final String NOW = "2026-11-05T09:00:00.000Z";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA = "gcsp_rec_http";

    static {
        if (URL != null && !URL.isBlank()) {
            Runtime.getRuntime().addShutdownHook(new Thread(RecommendationHttpProfiles::dropSchema));
        }
    }

    private RecommendationHttpProfiles() {}

    static PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(URL);
        ds.setCurrentSchema(SCHEMA);
        return ds;
    }

    private static void dropSchema() {
        try (Connection c = pool().getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        } catch (SQLException e) {
            System.err.println("Could not drop test schema " + SCHEMA);
        }
    }

    static Map<String, String> identity(String roles, String employeeId, String runId) {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "fixed-test");
        m.put("gcsp.identity.fixed-test.token", TOKEN);
        m.put("gcsp.identity.fixed-test.subject", "recommendation-subject");
        m.put("gcsp.identity.fixed-test.roles", roles);
        m.put("gcsp.identity.fixed-test.environment-id", ENV);
        m.put("gcsp.identity.fixed-test.run-id", runId);
        if (employeeId != null) m.put("gcsp.identity.fixed-test.employee-id", employeeId);
        m.put("gcsp.identity.fixed-test.policy-version", "gcsp-policy-v1");
        m.put("gcsp.identity.fixed-test.capabilities", "account:read");
        return m;
    }

    static Map<String, String> database(Map<String, String> m, String provider) {
        m.put("gcsp.account.provider", provider);
        m.put("gcsp.account.fixed-now", NOW);
        if (URL == null || URL.isBlank()) {
            m.put("quarkus.datasource.active", "false");
            m.put("quarkus.flyway.active", "false");
            return m;
        }
        m.put("quarkus.datasource.active", "true");
        m.put("quarkus.flyway.active", "true");
        m.put("quarkus.datasource.jdbc.url", URL);
        m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
        m.put("quarkus.flyway.schemas", SCHEMA);
        m.put("quarkus.flyway.default-schema", SCHEMA);
        m.put("gcsp.environment-id", ENV);
        m.put("gcsp.database.expected-name", "gcsp_test_dev");
        return m;
    }

    /** Paula, the repository account provider, the pinned clock and the active run-1. */
    public static class Paula implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return database(identity("employee", "employee-paula", RUN), "repository");
        }
    }

    /** A principal whose run is not the active one. */
    public static class StaleRun implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return database(identity("employee", "employee-paula", "run-0"), "repository");
        }
    }

    /** A greg principal: refused before anything is read. */
    public static class Greg implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return database(identity("greg", null, RUN), "repository");
        }
    }

    /** An employee with persistence switched off. */
    public static class NoDatabase implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> m = identity("employee", "employee-paula", RUN);
            m.put("quarkus.datasource.active", "false");
            m.put("quarkus.flyway.active", "false");
            return m;
        }
    }

    /** An employee with persistence but no account provider. */
    public static class NoAccountProvider implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return database(identity("employee", "employee-paula", RUN), "none");
        }
    }
}
