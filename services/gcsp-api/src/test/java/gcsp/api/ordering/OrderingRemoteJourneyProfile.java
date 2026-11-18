package gcsp.api.ordering;

import gcsp.api.JwksServerResource;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The ordering journey with the real HttpOrderingProvider (provider=remote) aimed at a loopback endpoint: real RS256
 * identity, a private schema, demo-prepared people and no test alternative in force. One profile per journey class.
 */
public class OrderingRemoteJourneyProfile extends OrderingJourneyProfile {

    private final String suffix;

    public OrderingRemoteJourneyProfile() {
        this("a");
    }

    OrderingRemoteJourneyProfile(String suffix) {
        this.suffix = suffix;
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = new HashMap<>(super.getConfigOverrides());
        m.put("gcsp.ordering.provider", "remote");
        m.put("gcsp.ordering.timeout", "2s");
        // Jordan (no current contract) is the second employee, and the presenter may sweep.
        m.put("gcsp.oidc.accounts", "["
                + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
                + "{\"subject\":\"sub-jordan\",\"roles\":[\"employee\"],\"employeeId\":\"employee-jordan\"},"
                + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]");
        if (m.containsKey("quarkus.flyway.default-schema")) {
            String schema = "gcsp_s_ordremote_" + suffix + "_"
                    + OrderingJourneyProfile.SCHEMA.substring("gcsp_s_ordjourney_".length());
            m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", schema);
            m.put("quarkus.flyway.schemas", schema);
            m.put("quarkus.flyway.default-schema", schema);
        }
        return m;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class), new TestResourceEntry(LoopbackOrderingResource.class));
    }

    /** Paula's handoff is refused by the provider. */
    public static class Refused extends OrderingRemoteJourneyProfile {
        public Refused() {
            super("r");
        }
    }

    /** Lost acknowledgement, repeated command and restart. */
    public static class Lost extends OrderingRemoteJourneyProfile {
        public Lost() {
            super("l");
        }
    }
}
