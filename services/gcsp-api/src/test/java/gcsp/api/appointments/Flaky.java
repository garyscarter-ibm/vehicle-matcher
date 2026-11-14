package gcsp.api.appointments;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** Port of Node flaky(): wraps a provider so one call (by step name, or "reconcile") can be lost, delayed, garbled or refused. */
final class Flaky implements AppointmentProvider {

    final AppointmentProvider inner;
    final List<String> calls = new CopyOnWriteArrayList<>();
    /** One-shot faults keyed by "request", "confirm", "accept" or "reconcile": a String kind or a refusing ProviderAnswer. */
    final Map<String, Object> fault = new ConcurrentHashMap<>();

    Flaky(AppointmentProvider inner) {
        this.inner = inner;
    }

    @Override
    public String mode() {
        return inner.mode();
    }

    @Override
    public SlotOffer offerSlots(Instant now, SlotPolicy policy) {
        return inner.offerSlots(now, policy);
    }

    @Override
    public ProviderAnswer write(ProviderOperation op, Instant now) {
        return run(op.step(), op, () -> inner.write(op, now));
    }

    @Override
    public ProviderAnswer reconcile(ProviderOperation op) {
        return run("reconcile", op, () -> inner.reconcile(op));
    }

    long count(String name) {
        return calls.stream().filter(name::equals).count();
    }

    private ProviderAnswer run(String name, ProviderOperation op, java.util.function.Supplier<ProviderAnswer> real) {
        calls.add(name);
        Object f = fault.remove(name);
        if ("lost".equals(f)) throw new IllegalStateException("lost before the provider");
        if ("hang".equals(f)) {
            try {
                Thread.sleep(60_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("hung");
        }
        if ("garbled".equals(f)) {
            return new ProviderAnswer.Scheduled("not-this-operation", op.orderUuid(), op.step(), op.slot(), "REF",
                    Instant.parse("2026-11-05T09:00:00Z"));
        }
        if (f instanceof ProviderAnswer refuse) return refuse;
        ProviderAnswer answer = real.get();
        if ("throw-after".equals(f)) throw new IllegalStateException("lost after the provider");
        return answer;
    }
}
