package gcsp.api.brief;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

/** Production defaults until the real adapters exist; each is replaced by providing another bean. */
public final class BriefDefaults {

    private BriefDefaults() {}

    /** No copy of policy and no fallback: until the PolicyService adapter exists every brief command is unavailable. */
    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredPolicy implements BriefPolicyPort {
        @Override
        public Optional<BriefAssumptions> assumptions(String policyVersion) {
            return Optional.empty();
        }
    }

    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredAccount implements BriefAccountPort {
        @Override
        public Optional<AccountFacts> facts(String environmentId, String runId, String employeeId) {
            return Optional.empty();
        }
    }

    /** No Java offers exist yet, so there is nothing to list and nothing accepted. */
    @DefaultBean
    @ApplicationScoped
    public static class NoOffers implements BriefOfferPort {
        @Override
        public List<Offer> offers(String environmentId, String runId, String employeeId) {
            return List.of();
        }
    }
}
