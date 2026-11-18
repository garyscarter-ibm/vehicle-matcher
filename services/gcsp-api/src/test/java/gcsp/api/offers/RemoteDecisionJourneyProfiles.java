package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import java.util.List;
import java.util.Map;

/** Separate started applications keep each generated offer and scripted remote lifecycle independent. */
public final class RemoteDecisionJourneyProfiles {

    private RemoteDecisionJourneyProfiles() {}

    public static class Accept extends GeneratedClaimRemoteOfferProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> config = super.getConfigOverrides();
            config.put("gcsp.environment.policy-version", "gcsp-policy-v1+offer-journey-v1");
            return config;
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class),
                    new TestResourceEntry(RemoteDecisionJourneyResource.class));
        }
    }

    public static class Decline extends Accept {}

    public static class RejectedDecline extends Accept {}
}
