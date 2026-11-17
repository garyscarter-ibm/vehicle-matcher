package gcsp.api.supply;

import gcsp.api.policy.PolicyReleaseAdapter;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
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
    public static final String DEMO = "demo";
    public static final String POLICY_SERVICE = "policy-service";
    private static final Logger LOG = Logger.getLogger(SupplySelection.class);

    /** The selected provider and policy; policyMode is none (unconfigured), file or policy-service. */
    public record Selected(SupplyProvider provider, ReleasePolicy policy, String policyMode) {}

    /** What the choices may bind to: PolicyService (demo stock), its release reader, and confirmed supply. */
    public record Deps(PolicyService policy, ReleasePolicy releasePolicy, ConfirmedSupplyLookup lookup,
            RunCueLookup cues) {
        static final Deps NONE = new Deps(null, null, null, RunCueLookup.NONE);

        public Deps(PolicyService policy, ReleasePolicy releasePolicy, ConfirmedSupplyLookup lookup) {
            this(policy, releasePolicy, lookup, RunCueLookup.NONE);
        }
    }

    @ConfigProperty(name = "gcsp.supply.provider", defaultValue = NONE)
    String providerName;

    @ConfigProperty(name = "gcsp.supply.tranche-plan-file")
    Optional<String> planFile;

    @ConfigProperty(name = "gcsp.supply.policy-file")
    Optional<String> policyFile;

    @Inject
    PolicyService policyService;

    @Inject
    PolicyReleaseAdapter policyRelease;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @ConfigProperty(name = "gcsp.environment-id")
    Optional<String> environmentId;

    private volatile Selected selected;

    @PostConstruct
    void init() {
        ConfirmedSupplyLookup lookup = new PostgresConfirmedSupplyLookup(dataSource::get, () -> environmentId.orElse("").trim());
        RunCueLookup cues = new PostgresRunCueLookup(dataSource::get, () -> environmentId.orElse("").trim());
        selected = select(providerName, planFile.orElse(null), policyFile.orElse(null),
                new Deps(policyService, policyRelease, lookup, cues));
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
        return select(provider, planFile, policyFile, Deps.NONE);
    }

    public static Selected select(String provider, String planFile, String policyFile, Deps deps) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        SupplyProvider chosen;
        switch (name) {
            case NONE:
                chosen = new UnconfiguredProvider();
                break;
            case TRANCHE_PLAN:
                chosen = tranchePlan(planFile);
                break;
            case DEMO:
                if (deps.policy() == null || deps.lookup() == null) {
                    throw new IllegalStateException("gcsp.supply.provider=demo needs PolicyService and the database");
                }
                chosen = new DemoSupplyProvider(deps.policy(), deps.lookup(), deps.cues());
                break;
            default:
                throw new IllegalStateException("Unknown gcsp.supply.provider '" + name + "'; supported: none, "
                        + TRANCHE_PLAN + ", " + DEMO);
        }
        if (policyFile == null || policyFile.isBlank()) {
            return deps.releasePolicy() == null ? new Selected(chosen, new UnconfiguredPolicy(), NONE)
                    : new Selected(chosen, deps.releasePolicy(), POLICY_SERVICE);
        }
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
