package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import gcsp.api.allocation.BuddyJourneyProfiles;
import gcsp.api.allocation.BuddyJourneyResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The FUCQ-464 Buddy composition plus the offer-journey policy suffix, with the production wall PolicyClock left bound. */
public final class OfferJourneyProfiles {

    private OfferJourneyProfiles() {}

    /** No PolicyClock alternative: offers must read the run clock through OfferClock. */
    public static class Accept implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = new HashMap<>(BuddyJourneyProfiles.config("local-synthetic"));
            c.put("gcsp.environment.policy-version", "gcsp-policy-v1+offer-journey-v1");
            return c;
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class),
                    new TestResourceEntry(BuddyJourneyResource.class, Map.of("mode", "local")));
        }
    }

    /** A distinct profile class gives the decline journey its own app, schema and run clock. */
    public static class Decline extends Accept {}

    /** FUCQ-519: its own app and schema, so the run-selector reads see an untouched pending offer. */
    public static class RunIdQuery extends Accept {}

    /** FUCQ-510: provider demo, so a presenter reset starts a new run that must re-adopt the journey set. */
    public static class ResetDecline extends Accept {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = new HashMap<>(super.getConfigOverrides());
            c.put("gcsp.scenario.provider", "demo");
            return c;
        }
    }
}
