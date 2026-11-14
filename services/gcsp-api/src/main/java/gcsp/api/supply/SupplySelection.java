package gcsp.api.supply;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the stock source and release policy once at startup; an unknown or unusable setting stops the service. */
@ApplicationScoped
@Startup
public class SupplySelection {

    public static final String NONE = "none";
    public static final String TRANCHE_PLAN = "tranche-plan";
    private static final Logger LOG = Logger.getLogger(SupplySelection.class);

    /** The selected provider and policy; policyMode is none (unconfigured) or file. */
    public record Selected(SupplyProvider provider, ReleasePolicy policy, String policyMode) {}

    @ConfigProperty(name = "gcsp.supply.provider", defaultValue = NONE)
    String providerName;

    @ConfigProperty(name = "gcsp.supply.tranche-plan-file")
    Optional<String> planFile;

    @ConfigProperty(name = "gcsp.supply.policy-file")
    Optional<String> policyFile;

    private volatile Selected selected;

    @PostConstruct
    void init() {
        selected = select(providerName, planFile.orElse(null), policyFile.orElse(null));
        LOG.infof("GCSP supply provider: %s, release policy: %s", selected.provider().mode(), selected.policyMode());
    }

    public SupplyProvider provider() {
        return selected.provider();
    }

    public ReleasePolicy policy() {
        return selected.policy();
    }

    public String policyMode() {
        return selected.policyMode();
    }

    /** Pure selection rule, static so every refusal is unit-testable without a server. */
    public static Selected select(String provider, String planFile, String policyFile) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        SupplyProvider chosen;
        switch (name) {
            case NONE:
                chosen = new UnconfiguredProvider();
                break;
            case TRANCHE_PLAN:
                chosen = tranchePlan(planFile);
                break;
            default:
                throw new IllegalStateException("Unknown gcsp.supply.provider '" + name + "'; supported: none, "
                        + TRANCHE_PLAN);
        }
        if (policyFile == null || policyFile.isBlank()) return new Selected(chosen, new UnconfiguredPolicy(), NONE);
        Path file = Path.of(policyFile.trim());
        if (!Files.isRegularFile(file) || !Files.isReadable(file)) {
            throw new IllegalStateException("gcsp.supply.policy-file is set but cannot be read: " + file);
        }
        return new Selected(chosen, new RetainedPolicyFile(file), "file");
    }

    private static SupplyProvider tranchePlan(String planFile) {
        if (planFile == null || planFile.isBlank()) {
            throw new IllegalStateException("gcsp.supply.provider=tranche-plan needs gcsp.supply.tranche-plan-file");
        }
        try {
            return TranchePlanProvider.fromFile(Path.of(planFile.trim()));
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("gcsp.supply.tranche-plan-file cannot be used: " + planFile.trim()
                    + " (" + e.getClass().getSimpleName() + ")");
        }
    }
}
