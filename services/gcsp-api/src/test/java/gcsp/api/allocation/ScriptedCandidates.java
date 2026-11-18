package gcsp.api.allocation;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** Scripted recommendation port: per employee and car, a gate and score; cars not scripted are ineligible. */
final class ScriptedCandidates implements EligibleCandidates {

    record Entry(String gate, Double score) {}

    private final Map<String, Map<String, Entry>> script = new HashMap<>();
    final List<Request> requests = Collections.synchronizedList(new ArrayList<>());
    volatile Consumer<Request> hook = r -> {};
    volatile Result override;

    /** Employee is eligible for the car at this fit. */
    ScriptedCandidates eligible(String employeeId, String orderUuid, double score) {
        script.computeIfAbsent(employeeId, k -> new HashMap<>()).put(orderUuid, new Entry("eligible", score));
        return this;
    }

    @Override
    public Result evaluate(Request request) {
        requests.add(request);
        hook.accept(request);
        if (override != null) return override;
        Map<String, Entry> mine = script.getOrDefault(request.subject().employeeId(), Map.of());
        List<Decision> decisions = new ArrayList<>();
        for (Car car : request.cars()) {
            Entry e = mine.get(car.orderUuid());
            decisions.add(e == null
                    ? new Decision(car.orderUuid(), "ineligible", null, AllocationFixture.json("[]"),
                            AllocationFixture.json("[{\"code\":\"not-scripted\"}]"), AllocationFixture.json("[]"),
                            AllocationFixture.json("{}"), null)
                    : new Decision(car.orderUuid(), e.gate(), e.score(), AllocationFixture.json("[{\"code\":\"fit\"}]"),
                            AllocationFixture.json("[]"), AllocationFixture.json("[]"), AllocationFixture.json("{}"),
                            quote(car)));
        }
        return new Evaluated(AllocationFixture.json("{\"engine\":\"scripted\"}"), decisions);
    }

    /** The quote the stub gives for a car; tests compare stored quotes against it. */
    static ObjectNode quote(Car car) {
        return (ObjectNode) AllocationFixture.json("{\"orderUuid\":\"" + car.orderUuid() + "\",\"configurationId\":\""
                + car.configurationId() + "\",\"snapshot\":{\"display\":{\"name\":\"Car " + car.orderUuid()
                + "\",\"photo\":\"/img/" + car.orderUuid() + ".jpg\"}},\"terms\":{\"points\":{\"value\":480,"
                + "\"unit\":\"points\"},\"validUntil\":\"2026-11-14T12:00:00Z\"},\"employeeFacts\":{},"
                + "\"reasons\":[{\"code\":\"fit\"}],\"tradeOffs\":[],\"versions\":{\"stock\":\"" + car.version() + "\"}}");
    }
}
