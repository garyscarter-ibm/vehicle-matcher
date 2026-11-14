package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import java.util.HashMap;
import java.util.Map;

/** Test-only handover appointments by order; a missing order is not found. Not a CDI bean. */
final class FakeHandover implements HandoverPort {

    private final Map<String, HandoverReading> readings = new HashMap<>();

    FakeHandover put(String orderUuid, HandoverReading reading) {
        readings.put(orderUuid, reading);
        return this;
    }

    @Override
    public HandoverReading read(RunContext ctx, String orderUuid) {
        return readings.getOrDefault(orderUuid, new HandoverReading.NotFound());
    }
}
