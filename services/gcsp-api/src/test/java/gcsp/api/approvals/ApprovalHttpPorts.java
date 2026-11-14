package gcsp.api.approvals;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;

/** Test order source, enabled only by the approvals HTTP profiles; each test seeds its own orders. */
public final class ApprovalHttpPorts {

    private ApprovalHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class Orders implements OrderSourcePort {
        private final ApprovalFixture.Orders delegate = new ApprovalFixture.Orders();

        public synchronized void ready(String uuid, String employee) {
            delegate.ready(ApprovalFixture.order(uuid, employee, ApprovalFixture.FULL));
        }

        public synchronized void put(String uuid, Found found) {
            delegate.byId.put(uuid, found);
        }

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public synchronized Found find(RunContext ctx, String orderUuid) {
            return delegate.find(ctx, orderUuid);
        }

        @Override
        public synchronized Listing list(RunContext ctx, String after, int limit) {
            return delegate.list(ctx, after, limit);
        }
    }
}
