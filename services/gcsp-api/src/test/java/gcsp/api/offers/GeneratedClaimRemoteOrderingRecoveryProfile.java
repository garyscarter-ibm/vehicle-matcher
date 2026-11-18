package gcsp.api.offers;

import gcsp.api.JwksServerResource;
import java.util.List;

/** The retained remote ordering profile and settings, with the lost-acknowledgement substitute as its ordering stub. */
public class GeneratedClaimRemoteOrderingRecoveryProfile extends GeneratedClaimRemoteOrderingProfile {

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class),
                new TestResourceEntry(GeneratedClaimRemoteOfferResource.class),
                new TestResourceEntry(GeneratedClaimRemoteOrderingRecoveryResource.class));
    }
}
