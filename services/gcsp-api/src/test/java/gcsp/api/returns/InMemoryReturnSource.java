package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import java.util.HashMap;
import java.util.Map;

/** Test-only selection record: orders are put in by hand; a missing order is not found. Not a CDI bean. */
final class InMemoryReturnSource implements ReturnSourcePort {

    private final Map<String, ReturnSourceReading> orders = new HashMap<>();

    InMemoryReturnSource put(ReturnSource source) {
        orders.put(source.orderUuid(), source.valid() ? new ReturnSourceReading.Found(source) : ReturnSourceReading.invalid());
        return this;
    }

    InMemoryReturnSource put(String orderUuid, ReturnSourceReading reading) {
        orders.put(orderUuid, reading);
        return this;
    }

    @Override
    public ReturnSourceReading read(RunContext ctx, String orderUuid) {
        return orders.getOrDefault(orderUuid, new ReturnSourceReading.NotFound());
    }

    static ReturnSource replacement(String orderUuid, String employeeId) {
        return new ReturnSource(orderUuid, employeeId, true, "contract-1", "slot-ent-1", "slot-ent-1", "loc-1", false,
                12000L, "mi", "selection-op-1", ReturnsFixture.T0, "cfg-1");
    }

    static ReturnSource newOrder(String orderUuid, String employeeId) {
        return new ReturnSource(orderUuid, employeeId, false, null, null, null, null, false, null, null,
                "selection-op-2", ReturnsFixture.T0, "cfg-2");
    }
}
