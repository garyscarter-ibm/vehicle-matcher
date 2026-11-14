package gcsp.api.approvals;

import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Chooses the approval provider and policy source once at startup; an unknown or unusable setting stops the service. */
@ApplicationScoped
@Startup
public class ApprovalSelection {

    public static final String NONE = "none";
    public static final String SYNTHETIC = "synthetic";
    public static final String LIVE_STUB = "live-stub";
    private static final Logger LOG = Logger.getLogger(ApprovalSelection.class);

    /** The provider name and the policy source; policyMode is none (unconfigured) or file. */
    public record Selected(String provider, ApprovalPolicyPort policy, String policyMode) {}

    @ConfigProperty(name = "gcsp.approvals.provider", defaultValue = NONE)
    String providerName;

    @ConfigProperty(name = "gcsp.approvals.policy-file")
    Optional<String> policyFile;

    private volatile Selected selected;

    @PostConstruct
    void init() {
        selected = select(providerName, policyFile.orElse(null));
        LOG.infof("GCSP approvals provider: %s, policy: %s", selected.provider(), selected.policyMode());
    }

    public String provider() {
        return selected.provider();
    }

    public ApprovalPolicyPort policy() {
        return selected.policy();
    }

    public String policyMode() {
        return selected.policyMode();
    }

    /** The status provider for the selected name; synthetic keeps its decisions in the same database. */
    public ApprovalStatusProvider statusProvider(DataSource dataSource) {
        return statusFor(selected.provider(), dataSource);
    }

    static ApprovalStatusProvider statusFor(String provider, DataSource dataSource) {
        switch (provider) {
            case SYNTHETIC:
                return new SyntheticApprovalStatus(dataSource);
            case LIVE_STUB:
                return new LiveApprovalStatusStub();
            default:
                return new UnconfiguredApprovalStatus();
        }
    }

    /** Pure selection rule, static so every refusal is unit-testable without a server. */
    public static Selected select(String provider, String policyFile) {
        String name = provider == null || provider.isBlank() ? NONE : provider.trim();
        if (!NONE.equals(name) && !SYNTHETIC.equals(name) && !LIVE_STUB.equals(name)) {
            throw new IllegalStateException("Unknown gcsp.approvals.provider '" + name + "'; supported: " + NONE + ", "
                    + SYNTHETIC + ", " + LIVE_STUB);
        }
        if (policyFile == null || policyFile.isBlank()) return new Selected(name, new UnconfiguredApprovalPolicy(), NONE);
        Path file = Path.of(policyFile.trim());
        if (!Files.isRegularFile(file) || !Files.isReadable(file)) {
            throw new IllegalStateException("gcsp.approvals.policy-file is set but cannot be read: " + file);
        }
        return new Selected(name, new RetainedApprovalPolicy(file), "file");
    }
}
