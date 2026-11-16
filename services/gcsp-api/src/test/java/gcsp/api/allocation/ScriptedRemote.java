package gcsp.api.allocation;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;

/** Scripted remote Buddy: queued steps per method (an empty queue plays the default); every call is logged. */
final class ScriptedRemote implements RemoteBuddy {

    @FunctionalInterface
    interface Step {
        Ack apply(RemoteOperation op) throws Exception;
    }

    private final Deque<Step> executes = new ArrayDeque<>();
    private final Deque<Step> reconciles = new ArrayDeque<>();
    final List<String> calls = Collections.synchronizedList(new ArrayList<>());
    volatile Step fallback = op -> {
        throw new java.io.IOException("remote unreachable");
    };

    static Step answer(String status) {
        return op -> new Ack(status, op.operationId(), op.runId(), op.orderUuid());
    }

    static Step confirmed() {
        return answer("confirmed");
    }

    static Step lost() {
        return op -> {
            throw new java.io.IOException("response lost");
        };
    }

    ScriptedRemote onExecute(Step... steps) {
        synchronized (executes) {
            for (Step s : steps) executes.add(s);
        }
        return this;
    }

    ScriptedRemote onReconcile(Step... steps) {
        synchronized (reconciles) {
            for (Step s : steps) reconciles.add(s);
        }
        return this;
    }

    @Override
    public String mode() {
        return "remote";
    }

    @Override
    public Ack execute(RemoteOperation op) throws Exception {
        calls.add("execute:" + op.operationType());
        return next(executes).apply(op);
    }

    @Override
    public Ack reconcile(RemoteOperation op) throws Exception {
        calls.add("reconcile:" + op.operationType());
        return next(reconciles).apply(op);
    }

    private Step next(Deque<Step> queue) {
        synchronized (queue) {
            Step s = queue.poll();
            return s == null ? fallback : s;
        }
    }
}
