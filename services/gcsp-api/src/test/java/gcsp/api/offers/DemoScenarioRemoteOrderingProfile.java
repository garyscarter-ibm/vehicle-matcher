package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import gcsp.api.ordering.LoopbackOrderingResource;
import java.util.List;
import java.util.Map;

/** The Buddy offer journey with demo preparation and the real remote ordering provider; no seeded people. */
public class DemoScenarioRemoteOrderingProfile extends OfferJourneyProfiles.ResetDecline {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = super.getConfigOverrides();
        c.put("gcsp.ordering.provider", "remote");
        c.put("gcsp.ordering.timeout", "2s");
        c.put("gcsp.oidc.accounts", "["
                + "{\"subject\":\"sub-paula\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
                + "{\"subject\":\"sub-presenter\",\"roles\":[\"presenter\"]}]");
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(DemoScenarioStockResource.class),
                new TestResourceEntry(LoopbackOrderingResource.class));
    }
}
