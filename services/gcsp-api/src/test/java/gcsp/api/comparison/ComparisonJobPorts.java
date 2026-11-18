package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.util.concurrent.CountDownLatch;

/**
 * Synthetic route replays for the job tests: a valid minimal outcome record computed from each request (route, seed,
 * input hash, policy version), so a small job really completes without the real allocation and recommendation code.
 */
public final class ComparisonJobPorts {

    private static final ObjectMapper JSON = new ObjectMapper();
    /** Set by a test to hold every step until it counts down; the test must always release it. */
    static volatile CountDownLatch gate;
    static volatile CountDownLatch entered = new CountDownLatch(1);

    private ComparisonJobPorts() {}

    static JsonNode record(ComparisonReplay.Request request) {
        ObjectNode manifest = request.inputs().manifest();
        ObjectNode out = JSON.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("route", request.route());
        out.set("seed", request.seed());
        out.set("inputHash", manifest.get("inputHash"));
        out.set("policyVersion", manifest.get("policyVersion"));
        out.put("codeRevision", request.codeRevision());
        out.put("threshold", 70);
        out.putArray("assumptions");
        out.putArray("limitations").add("Synthetic test replay, not a real route outcome.");
        out.putArray("employees").addObject().put("accessGroup", "immediate-access").put("outcome", "none-by-renewal");
        out.putArray("cars").addObject().put("outcome", "unallocated").put("heldNotTakenSeconds", 0);
        out.putObject("totals").put("declines", 0).put("offerExpiries", 0).put("expiries", 0).put("retries", 0)
                .put("heldNotTakenHours", 0);
        return out;
    }

    /** Replays at once, or holds each step on the gate; an interrupt while held is a failed step. */
    static JsonNode held(ComparisonReplay.Request request, CountDownLatch entered, CountDownLatch gate) {
        entered.countDown();
        try {
            if (gate != null) gate.await();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("stopped while held");
        }
        return record(request);
    }

    /** The container's replay in the job profiles that run. */
    @Alternative
    @ApplicationScoped
    public static class Replay implements ComparisonReplay {
        @Override
        public JsonNode replay(Request request) {
            return held(request, entered, gate);
        }
    }
}
