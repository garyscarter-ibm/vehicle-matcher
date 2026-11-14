package gcsp.api.approvals;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

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

    /** The configured policy file, or none; FUCQ-457's PolicyService replaces it. */
    @Produces
    @DefaultBean
    @ApplicationScoped
    ApprovalPolicyPort policy(ApprovalSelection selection) {
        return selection.policy();
    }
}
