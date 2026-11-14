package gcsp.api.notify;

import java.util.HashMap;
import java.util.Map;

/** Fixed-test identity with the drain paused for the notify HTTP tests, plus the native database when its URL is set. */
final class NotifyProfiles {

    private NotifyProfiles() {}

    static Map<String, String> of(String token, String roles, String employeeId, String capabilities) {
        Map<String, String> config = new HashMap<>();
        config.put("gcsp.identity.provider", "fixed-test");
        config.put("gcsp.identity.fixed-test.token", token);
        config.put("gcsp.identity.fixed-test.subject", "notify-test-subject");
        config.put("gcsp.identity.fixed-test.roles", roles);
        config.put("gcsp.identity.fixed-test.environment-id", "test-app-env");
        config.put("gcsp.identity.fixed-test.run-id", "run-1");
        config.put("gcsp.identity.fixed-test.policy-version", "notify-test");
        config.put("gcsp.identity.fixed-test.capabilities", capabilities);
        if (employeeId != null) config.put("gcsp.identity.fixed-test.employee-id", employeeId);
        config.put("gcsp.notify.drain-interval", "10m");
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        if (url != null && !url.isBlank()) {
            config.put("quarkus.datasource.active", "true");
            config.put("quarkus.flyway.active", "true");
            config.put("quarkus.datasource.jdbc.url", url);
            config.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
            config.put("quarkus.flyway.schemas", "gcsp_app");
            config.put("gcsp.environment-id", "test-app-env");
            config.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return config;
    }
}
