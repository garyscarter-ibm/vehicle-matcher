package gcsp.api.approvals;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import jakarta.enterprise.inject.Produces;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Production defaults until the real adapters exist; each is replaced by providing another bean of the port type. */
@ApplicationScoped
public class ApprovalDefaults {

    /** No selection handoff is connected (FUCQ-468 replaces this), so every order call is unavailable. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    OrderSourcePort orderSource() {
        return new UnconfiguredOrderSource();
    }

    /** No appointment outcome is connected (FUCQ-472 replaces this), so no order is handed over. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    HandoverPort handover() {
        return new NoHandover();
    }

    /** The explicit retained policy file when one is set, else the canonical PolicyService (FUCQ-457). */
    @Produces
    @DefaultBean
    @ApplicationScoped
    ApprovalPolicyPort policy(ApprovalSelection selection, PolicyService policy, PolicyClock clock,
            @ConfigProperty(name = "gcsp.environment.id") Optional<String> environmentId,
            @ConfigProperty(name = "gcsp.environment.run-id") Optional<String> runId) {
        if (selection.policyFile() != null) return new RetainedApprovalPolicy(selection.policyFile());
        return new PolicyApprovalAdapter(policy, clock, environmentId.orElse(""), runId.orElse(""));
    }
}
