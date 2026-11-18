package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import java.util.List;
import java.util.Map;

/** The generated-claim profile with ordering selected as remote; its loopback settings come from the ordering resource. */
public class GeneratedClaimRemoteOrderingProfile extends GeneratedClaimRemoteOfferProfile {

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> c = super.getConfigOverrides();
        c.put("gcsp.ordering.provider", "remote");
        c.put("gcsp.ordering.timeout", "2s");
        return c;
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(GeneratedClaimRemoteOfferResource.class),
                new TestResourceEntry(GeneratedClaimRemoteOrderingResource.class));
    }
}
