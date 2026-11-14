package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;

/** Test selection record and handover, enabled only by the returns HTTP profiles; each test seeds its own orders. */
public final class ReturnHttpPorts {

    private ReturnHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class Source implements ReturnSourcePort {
        private final InMemoryReturnSource delegate = new InMemoryReturnSource();

        public synchronized void put(ReturnSource source) {
            delegate.put(source);
        }

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public synchronized ReturnSourceReading read(RunContext ctx, String orderUuid) {
            return delegate.read(ctx, orderUuid);
        }
    }

    @Alternative
    @ApplicationScoped
    public static class Handover implements HandoverPort {
        private final FakeHandover delegate = new FakeHandover();

        public synchronized void put(String orderUuid, HandoverReading reading) {
            delegate.put(orderUuid, reading);
        }

        @Override
        public String mode() {
            return "test";
        }

        @Override
        public synchronized HandoverReading read(RunContext ctx, String orderUuid) {
            return delegate.read(ctx, orderUuid);
        }
    }
}
