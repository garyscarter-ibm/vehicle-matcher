package gcsp.api.claims;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** A remote stock double whose ledger counts every effect it really applied; calls can be scripted to misbehave. */
final class ScriptedClaimStock implements ClaimStockPort {

    enum Step { CONFIRM, REJECT, THROW_BEFORE, APPLY_THEN_THROW, MISMATCH, NOT_FOUND }

    /** The remote's own record: effects per operation id, and which ids it rejected. Shared across a "restart". */
    static final class Ledger {
        final Map<String, AtomicInteger> effects = new ConcurrentHashMap<>();
        final Map<String, AtomicInteger> executeCalls = new ConcurrentHashMap<>();
        final Map<String, Boolean> rejected = new ConcurrentHashMap<>();

        int effects(String operationId) {
            return effects.getOrDefault(operationId, new AtomicInteger()).get();
        }

        int calls(String operationId) {
            return executeCalls.getOrDefault(operationId, new AtomicInteger()).get();
        }

        int totalEffects() {
            return effects.values().stream().mapToInt(AtomicInteger::get).sum();
        }
    }

    final Ledger ledger;
    final Deque<Step> executeScript = new ArrayDeque<>();
    final Deque<Step> reconcileScript = new ArrayDeque<>();
    /** Runs after an effect is applied and before the answer returns (a reset landing mid-call). */
    volatile Runnable afterApply = () -> {};

    ScriptedClaimStock() {
        this(new Ledger());
    }

    ScriptedClaimStock(Ledger ledger) {
        this.ledger = ledger;
    }

    ScriptedClaimStock onExecute(Step... steps) {
        for (Step s : steps) executeScript.add(s);
        return this;
    }

    ScriptedClaimStock onReconcile(Step... steps) {
        for (Step s : steps) reconcileScript.add(s);
        return this;
    }

    @Override
    public Mode mode() {
        return Mode.REMOTE;
    }

    @Override
    public synchronized Ack execute(Operation op) throws Exception {
        ledger.executeCalls.computeIfAbsent(op.operationId(), k -> new AtomicInteger()).incrementAndGet();
        Step step = executeScript.isEmpty() ? Step.CONFIRM : executeScript.poll();
        switch (step) {
            case THROW_BEFORE:
                throw new java.io.IOException("request lost");
            case APPLY_THEN_THROW:
                apply(op);
                throw new java.io.IOException("response lost");
            case MISMATCH:
                return new Confirmed("other-op", op.runId(), op.orderUuid(), "ref");
            case NOT_FOUND:
                return new NotFound(op.operationId(), op.runId(), op.orderUuid());
            case REJECT:
                ledger.rejected.put(op.operationId(), true);
                return new Rejected(op.operationId(), op.runId(), op.orderUuid());
            default:
                apply(op);
                return new Confirmed(op.operationId(), op.runId(), op.orderUuid(), "ref-" + op.operationId());
        }
    }

    @Override
    public synchronized Ack reconcile(Operation op) throws Exception {
        Step step = reconcileScript.isEmpty() ? null : reconcileScript.poll();
        if (step == Step.THROW_BEFORE) throw new java.io.IOException("reconcile failed");
        if (step == Step.MISMATCH) return new Confirmed(op.operationId(), "other-run", op.orderUuid(), "ref");
        if (step == Step.NOT_FOUND) return new NotFound(op.operationId(), op.runId(), op.orderUuid());
        if (ledger.rejected.containsKey(op.operationId())) return new Rejected(op.operationId(), op.runId(), op.orderUuid());
        if (ledger.effects(op.operationId()) > 0) {
            return new Confirmed(op.operationId(), op.runId(), op.orderUuid(), "ref-" + op.operationId());
        }
        return new NotFound(op.operationId(), op.runId(), op.orderUuid());
    }

    private void apply(Operation op) {
        ledger.effects.computeIfAbsent(op.operationId(), k -> new AtomicInteger()).incrementAndGet();
        afterApply.run();
    }
}
