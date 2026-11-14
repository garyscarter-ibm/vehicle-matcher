package gcsp.api.comparison;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.postgresql.ds.PGSimpleDataSource;
import org.junit.jupiter.api.Assumptions;

/** HTTP profiles for the job tests. Each runs in its own schema of the native test database, dropped at JVM exit. */
public final class ComparisonJobProfiles {

    private ComparisonJobProfiles() {}

    static Map<String, String> config(String schema, boolean reruns) {
        Map<String, String> m = new HashMap<>(ComparisonHttpProfiles.config(true));
        if (ComparisonHttpProfiles.URL != null && !ComparisonHttpProfiles.URL.isBlank()) {
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            m.put("quarkus.flyway.schemas", schema);
            m.put("quarkus.flyway.default-schema", schema);
            Runtime.getRuntime().addShutdownHook(new Thread(() -> drop(schema)));
        }
        m.put("gcsp.comparison.reruns", Boolean.toString(reruns));
        m.put("gcsp.comparison.code-revision", "job-test");
        return m;
    }

    private static void drop(String schema) {
        try (Connection c = ComparisonFixture.plain(ComparisonHttpProfiles.URL).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        } catch (SQLException e) {
            // best effort; the schema is small and uniquely named
        }
    }

    static String schema(String tag) {
        return "gcsp_cj_" + tag + "_" + Long.toHexString(System.nanoTime());
    }

    /** Reruns on, with the synthetic replay. */
    public static class Running extends ComparisonHttpProfiles.Base {
        static final String SCHEMA = schema("run");

        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA, true);
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(ComparisonJobPorts.Replay.class);
        }
    }

    /** Reruns off. */
    public static class RerunsOff extends ComparisonHttpProfiles.Base {
        static final String SCHEMA = schema("off");

        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA, false);
        }
    }

    /** Reruns on with the default replay, which is honestly unavailable. */
    public static class DefaultReplay extends ComparisonHttpProfiles.Base {
        static final String SCHEMA = schema("dflt");

        @Override
        public Map<String, String> getConfigOverrides() {
            return config(SCHEMA, true);
        }
    }

    static PGSimpleDataSource pool(String schema) throws SQLException {
        Assumptions.assumeTrue(ComparisonHttpProfiles.URL != null && !ComparisonHttpProfiles.URL.isBlank());
        PGSimpleDataSource ds = ComparisonFixture.plain(ComparisonHttpProfiles.URL);
        ds.setCurrentSchema(schema);
        return ds;
    }
}
