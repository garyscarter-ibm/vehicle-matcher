package gcsp.api.recommendation;

import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.UnconfiguredCandidates;
import gcsp.api.policy.PolicyService;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Selects the allocation calculation once at startup; none refuses and never falls back to synthetic decisions. */
@ApplicationScoped
@Startup
public class CandidatesSelection {

    static final String KEY = "gcsp.allocation.candidates.provider";
    private static final Logger LOG = Logger.getLogger(CandidatesSelection.class);

    @ConfigProperty(name = KEY, defaultValue = "none")
    String provider;

    @Inject
    PolicyService policy;

    private EligibleCandidates selected;

    @PostConstruct
    void init() {
        selected = select(provider, policy);
        LOG.infof("GCSP allocation candidates provider: %s", normalise(provider));
    }

    @Produces
    @ApplicationScoped
    EligibleCandidates candidates() {
        return selected;
    }

    static EligibleCandidates select(String provider, PolicyService policy) {
        return switch (normalise(provider)) {
            case "none" -> new UnconfiguredCandidates();
            case "recommendation" -> new RecommendationCandidates(policy);
            default -> throw new IllegalStateException("Unknown " + KEY + " '" + provider
                    + "'; supported: none, recommendation");
        };
    }

    private static String normalise(String provider) {
        return provider == null || provider.isBlank() ? "none" : provider.trim();
    }
}
