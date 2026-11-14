package gcsp.api.evidence;

import java.util.Map;

/** The lookup provider with persistence on in its own schema, and an employee in the claimed environment's run-1. */
public class EvidenceHttpStockProfile extends EvidenceHttpProfile {

    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    static final String SCHEMA = "gcsp_evidence_http";
    static final String ENV = "evidence-stock-env";

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = super.getConfigOverrides();
        m.put("gcsp.identity.fixed-test.environment-id", ENV);
        m.put("gcsp.identity.fixed-test.run-id", "run-1");
        if (URL != null && !URL.isBlank()) {
            m.put("quarkus.datasource.active", "true");
            m.put("quarkus.flyway.active", "true");
            m.put("quarkus.datasource.jdbc.url", URL);
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
            m.put("quarkus.flyway.schemas", SCHEMA);
            m.put("quarkus.flyway.default-schema", SCHEMA);
            m.put("gcsp.environment-id", ENV);
            m.put("gcsp.database.expected-name", "gcsp_test_dev");
        }
        return m;
    }
}
