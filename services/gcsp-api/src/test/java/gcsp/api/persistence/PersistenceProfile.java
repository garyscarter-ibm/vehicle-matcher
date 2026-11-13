package gcsp.api.persistence;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.Map;

/** Points the app at the native test cluster, in its own schema's database via GCSP_TEST_DATABASE_URL. */
public class PersistenceProfile implements QuarkusTestProfile {

    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");

    @Override
    public Map<String, String> getConfigOverrides() {
        if (URL == null || URL.isBlank()) return Map.of();
        return Map.of(
                "quarkus.datasource.active", "true",
                "quarkus.flyway.active", "true",
                "quarkus.datasource.jdbc.url", URL,
                "quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app",
                "quarkus.flyway.schemas", "gcsp_app",
                "gcsp.environment-id", "test-app-env",
                "gcsp.database.expected-name", "gcsp_test_dev");
    }
}
