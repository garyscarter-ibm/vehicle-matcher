package gcsp.api.notify;

import gcsp.api.JwksServerResource;
import gcsp.api.allocation.BuddyJourneyProfiles;
import gcsp.api.allocation.BuddyJourneyResource;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The deployed composition (no test clock alternative) with the Buddy journey seed and Brevo pointed at a loopback stub. */
public class NotificationJourneyProfile implements QuarkusTestProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = BuddyJourneyProfiles.config("local-synthetic");
        c.put("gcsp.database.expected-name", "gcsp_dev20261113037");
        c.put("gcsp.mail.transport", "brevo");
        c.put("gcsp.mail.brevo.api-key", "test-key-not-a-secret");
        c.put("gcsp.mail.from", "gcsp-test@example.test");
        c.put("gcsp.mail.from-name", "GCSP test");
        c.put("quarkus.arc.exclude-types", "gcsp.api.offers.OffersTestPorts$Records,"
                + "gcsp.api.documents.DocumentsTestPorts$Policy,gcsp.api.documents.DocumentsTestPorts$Cases,"
                + "gcsp.api.documents.DocumentsTestPorts$Clock");
        return c;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of();
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(BuddyJourneyResource.class, Map.of("mode", "local")),
                new TestResourceEntry(StubResource.class));
    }

    /** Starts the stub before Quarkus reads config; the test reaches it through STUB. */
    public static class StubResource implements QuarkusTestResourceLifecycleManager {
        static volatile BrevoStub stub;

        @Override
        public Map<String, String> start() {
            try {
                stub = new BrevoStub();
            } catch (IOException e) {
                throw new IllegalStateException("The Brevo stub could not start", e);
            }
            return Map.of("gcsp.mail.brevo.endpoint", stub.endpoint().toString());
        }

        @Override
        public void stop() {
            if (stub != null) stub.close();
            stub = null;
        }
    }
}
