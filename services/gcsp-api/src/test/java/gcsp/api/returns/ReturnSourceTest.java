package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.RunContext;
import org.junit.jupiter.api.Test;

class ReturnSourceTest {

    static ReturnSource replacement() {
        return InMemoryReturnSource.replacement("order-1", "emp-1");
    }

    @Test
    void aWholeReplacementAndANewOrderAreValid() {
        assertTrue(replacement().valid());
        assertTrue(InMemoryReturnSource.newOrder("order-2", "emp-1").valid());
        ReturnSource buddy = new ReturnSource("order-3", "emp-1", true, "c-1", "s-1", "s-1", null, true, 40000L, "km", "op", ReturnsFixture.T0, "cfg");
        assertTrue(buddy.valid());
    }

    @Test
    void aReplacementNeedsTheContractTheSlotAndANonNegativeMileage() {
        ReturnSource r = replacement();
        assertFalse(new ReturnSource(r.orderUuid(), r.employeeId(), true, null, r.entitlementSlotId(), r.oldSlotId(), r.locationId(), false, 1L, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
        assertFalse(new ReturnSource(r.orderUuid(), r.employeeId(), true, r.oldContractId(), null, r.oldSlotId(), r.locationId(), false, 1L, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
        assertFalse(new ReturnSource(r.orderUuid(), r.employeeId(), true, r.oldContractId(), r.entitlementSlotId(), r.oldSlotId(), r.locationId(), false, -1L, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
        assertFalse(new ReturnSource(r.orderUuid(), r.employeeId(), true, r.oldContractId(), r.entitlementSlotId(), r.oldSlotId(), r.locationId(), false, null, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
        assertFalse(new ReturnSource(r.orderUuid(), r.employeeId(), true, r.oldContractId(), r.entitlementSlotId(), r.oldSlotId(), null, false, 1L, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
        assertTrue(new ReturnSource(r.orderUuid(), r.employeeId(), true, r.oldContractId(), r.entitlementSlotId(), r.oldSlotId(), r.locationId(), false, 0L, "mi", r.sourceReference(), r.receivedAt(), r.configurationId()).valid());
    }

    @Test
    void aBuddyNeedsTheOdometerUnit() {
        assertFalse(new ReturnSource("o", "e", true, "c", "s", "s", null, true, 10L, null, "op", ReturnsFixture.T0, "cfg").valid());
        assertFalse(new ReturnSource("o", "e", true, "c", "s", "s", null, true, null, "mi", "op", ReturnsFixture.T0, "cfg").valid());
    }

    @Test
    void aNewOrderCarriesNoOldCarFields() {
        assertFalse(new ReturnSource("o", "e", false, "c", null, null, null, false, null, null, "op", ReturnsFixture.T0, "cfg").valid());
    }

    @Test
    void theDefaultBeanAnswersUnavailableAndRetryable() {
        ReturnSourceReading r = new UnconfiguredReturnSource().read(new RunContext("e", "r", "a"), "order-1");
        ReturnSourceReading.Unavailable u = assertInstanceOf(ReturnSourceReading.Unavailable.class, r);
        assertEquals("return-source-unavailable", u.code());
        assertTrue(u.retryable());
        HandoverReading h = new UnconfiguredHandover().read(new RunContext("e", "r", "a"), "order-1");
        assertInstanceOf(HandoverReading.Unavailable.class, h);
    }

    @Test
    void theTestSourceDistinguishesFoundNotFoundAndInvalid() {
        InMemoryReturnSource src = new InMemoryReturnSource().put(replacement());
        RunContext ctx = new RunContext("e", "r", "a");
        assertInstanceOf(ReturnSourceReading.Found.class, src.read(ctx, "order-1"));
        assertInstanceOf(ReturnSourceReading.NotFound.class, src.read(ctx, "none"));
        src.put(new ReturnSource("order-9", "e", true, null, null, null, null, false, null, null, "op", ReturnsFixture.T0, "cfg"));
        ReturnSourceReading.Invalid bad = assertInstanceOf(ReturnSourceReading.Invalid.class, src.read(ctx, "order-9"));
        assertEquals("return-plan-source-invalid", bad.code());
        assertFalse(bad.retryable());
    }
}
