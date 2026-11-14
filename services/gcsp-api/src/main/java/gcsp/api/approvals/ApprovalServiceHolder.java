package gcsp.api.approvals;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Optional;

/** Builds the one ApprovalService lazily over the Agroal datasource and the port beans; empty without persistence. */
@ApplicationScoped
public class ApprovalServiceHolder {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ApprovalSelection selection;

    @Inject
    ApprovalPolicyPort policy;

    @Inject
    OrderSourcePort orders;

    @Inject
    HandoverPort handover;

    private ApprovalService service;

    public synchronized Optional<ApprovalService> service() {
        if (!persistence.active()) return Optional.empty();
        if (service == null) {
            AgroalDataSource ds = dataSource.get();
            service = new ApprovalService(ds, policy, orders, selection.statusProvider(ds), handover);
        }
        return Optional.of(service);
    }
}
