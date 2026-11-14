package gcsp.api.appointments;

import java.time.Instant;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Runs provider calls on a small bounded pool so a hang or throw becomes an unknown answer after the policy timeout. */
final class ProviderCalls implements AutoCloseable {

    private static final int MAX_CONCURRENT = 16;
    private final ThreadPoolExecutor pool = new ThreadPoolExecutor(0, MAX_CONCURRENT, 30, TimeUnit.SECONDS,
            new SynchronousQueue<>(), r -> {
                Thread t = new Thread(r, "appointment-provider");
                t.setDaemon(true);
                return t;
            });

    private <T> T call(Callable<T> work, long timeoutMs, T fallback) {
        Future<T> future;
        try {
            future = pool.submit(work);
        } catch (RejectedExecutionException e) {
            return fallback;
        }
        try {
            T answer = future.get(timeoutMs, TimeUnit.MILLISECONDS);
            return answer == null ? fallback : answer;
        } catch (TimeoutException e) {
            future.cancel(true);
            return fallback;
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            return fallback;
        } catch (ExecutionException e) {
            return fallback;
        }
    }

    ProviderAnswer write(AppointmentProvider provider, ProviderOperation op, Instant now, long timeoutMs) {
        return call(() -> provider.write(op, now), timeoutMs, new ProviderAnswer.Unknown());
    }

    ProviderAnswer reconcile(AppointmentProvider provider, ProviderOperation op, long timeoutMs) {
        return call(() -> provider.reconcile(op), timeoutMs, new ProviderAnswer.Unknown());
    }

    SlotOffer offer(AppointmentProvider provider, Instant now, SlotPolicy policy, long timeoutMs) {
        return call(() -> provider.offerSlots(now, policy), timeoutMs, new SlotOffer.Unavailable());
    }

    /** Node expected(): the answer is this operation's own success for its step, else it is not a success. */
    static boolean expected(AppointmentStore.Op op, ProviderAnswer answer) {
        if (!(answer instanceof ProviderAnswer.Done d)) return false;
        if (!op.operationId().equals(d.operationId()) || !op.orderUuid().equals(d.orderUuid())
                || !op.step().equals(d.step()) || !Values.id(d.providerReference(), 512) || d.at() == null
                || d.slot() == null || !d.slot().valid()) return false;
        Slot want = op.slot();
        if (want == null) return false;
        switch (op.step()) {
            case "request":
                return answer instanceof ProviderAnswer.Accepted && d.slot().slotId().equals(want.slotId());
            case "confirm":
                if (answer instanceof ProviderAnswer.Scheduled) return d.slot().slotId().equals(want.slotId());
                return answer instanceof ProviderAnswer.Proposed p && p.proposedSlot() != null && p.proposedSlot().valid()
                        && !p.proposedSlot().slotId().equals(want.slotId()) && Values.id(p.proposalId(), 512);
            case "accept":
                Slot proposed = Slot.fromJson(op.payload().get("proposedSlot"));
                return answer instanceof ProviderAnswer.Scheduled && proposed != null
                        && d.slot().slotId().equals(proposed.slotId());
            default:
                return false; // complete is added with slice s3
        }
    }

    @Override
    public void close() {
        pool.shutdownNow();
    }
}
