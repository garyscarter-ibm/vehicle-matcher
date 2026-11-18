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

    /** The two employees plus a presenter, so a started app can tick and move the run clock. */
    public static class WithPresenter extends Accept {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> config = super.getConfigOverrides();
            String accounts = config.get("gcsp.oidc.accounts");
            config.put("gcsp.oidc.accounts", accounts.substring(0, accounts.length() - 1)
                    + ",{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]");
            return config;
        }
    }

    /** A transport timeout on an accept, then reconciliation through the registered tick. */
    public static class Timeout extends WithPresenter {}

    /** Stale run and expiry while a decline is pending, each in its own started app. */
    public static class Expiry extends WithPresenter {}
}
