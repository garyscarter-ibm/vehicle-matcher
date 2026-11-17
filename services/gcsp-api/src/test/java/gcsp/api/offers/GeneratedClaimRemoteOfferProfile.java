package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import java.util.List;
import java.util.Map;

/** Retains the tested same-instant clock, with real selected candidates and source inputs instead of a seeded offer. */
public class GeneratedClaimRemoteOfferProfile extends OidcRemoteOfferProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = super.getConfigOverrides();
        c.put("gcsp.allocation.candidates.provider", "recommendation");
        c.put("gcsp.oidc.accounts", "["
                + "{\"subject\":\"sub-employee-a\",\"roles\":[\"employee\"],\"employeeId\":\"employee-paula\"},"
                + "{\"subject\":\"sub-employee-b\",\"roles\":[\"employee\"],\"employeeId\":\"E-1002\"}]");
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(GeneratedClaimRemoteOfferResource.class));
    }
}
