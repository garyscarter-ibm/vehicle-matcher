package gcsp.api.account;

import java.util.HashMap;
import java.util.Map;

/** AccountHttpProfile with the repository provider over the native cluster's gcsp_app schema, in active run-1. */
public class RepositoryHttpProfile extends AccountHttpProfile {

    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String ENV = "test-app-env";
    static final String RUN = "run-1";

    @Override
    String provider() {
        return URL == null || URL.isBlank() ? "none" : "repository";
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = new HashMap<>(super.getConfigOverrides());
        if (URL != null && !URL.isBlank()) {
            c.put("quarkus.datasource.active", "true");
            c.put("quarkus.flyway.active", "true");
            c.put("quarkus.datasource.jdbc.url", URL);
            c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            c.put("quarkus.flyway.schemas", "gcsp_app");
            c.put("gcsp.environment-id", ENV);
            c.put("gcsp.database.expected-name", "gcsp_test_dev");
            c.put("gcsp.environment.id", ENV);
            c.put("gcsp.environment.run-id", RUN);
        }
        return c;
    }
}
