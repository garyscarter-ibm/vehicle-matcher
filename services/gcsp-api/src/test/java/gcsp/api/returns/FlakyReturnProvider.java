package gcsp.api.returns;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

/** Test wrapper over a provider: a write step can throw before reaching it, throw after it answered, or hang. */
final class FlakyReturnProvider implements ReturnProviderPort {

    enum Fault { NONE, THROW_BEFORE, THROW_AFTER, HANG }

    private final ReturnProviderPort delegate;
    volatile Fault fault = Fault.NONE;
    final AtomicInteger writes = new AtomicInteger();

    FlakyReturnProvider(ReturnProviderPort delegate) {
        this.delegate = delegate;
    }

    /** The next write step misbehaves once, then the provider is healthy again. */
    FlakyReturnProvider failOnce(Fault f) {
        fault = f;
        return this;
    }

    private Result write(java.util.function.Supplier<Result> call) {
        writes.incrementAndGet();
        Fault f = fault;
        fault = Fault.NONE;
        if (f == Fault.THROW_BEFORE) throw new IllegalStateException("provider down");
        if (f == Fault.HANG) {
            try {
                Thread.sleep(5000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        Result r = call.get();
        if (f == Fault.THROW_AFTER) throw new IllegalStateException("response lost");
        return r;
    }

    @Override
    public String mode() {
        return delegate.mode();
    }

    @Override
    public Offer offerSlots(SlotPolicy slotPolicy, Instant now) {
        return delegate.offerSlots(slotPolicy, now);
    }

    @Override
    public Result requestSlot(Operation op) {
        return write(() -> delegate.requestSlot(op));
    }

    @Override
    public Result confirm(Operation op, Instant now) {
        return write(() -> delegate.confirm(op, now));
    }

    @Override
    public Result acceptProposal(Operation op) {
        return write(() -> delegate.acceptProposal(op));
    }

    @Override
    public Result confirmOutcome(Operation op, Instant now) {
        return delegate.confirmOutcome(op, now);
    }

    @Override
    public Result reconcile(Operation op) {
        return delegate.reconcile(op);
    }
}
