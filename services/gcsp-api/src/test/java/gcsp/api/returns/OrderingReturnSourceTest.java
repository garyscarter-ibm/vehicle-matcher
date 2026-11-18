package gcsp.api.returns;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import java.time.Instant;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** The pure JSON-to-ReturnSource mapping of the ordering selection; the database reads come in the journey slice. */
class OrderingReturnSourceTest {

    static final Instant AT = Instant.parse("2026-11-05T09:00:00Z");
    static final String ORDER = "order-1";
    static final String OP = "op-1";

    static ObjectNode selection(String mode, Consumer<ObjectNode> edit) {
        ObjectNode s = ReturnJson.JSON.createObjectNode();
        s.putObject("source").put("type", "cart").put("expectedDraftVersion", 3);
        s.putObject("stock").put("orderUuid", ORDER).put("configurationId", "cfg-1");
        s.putObject("draft").put("mode", mode);
        s.putNull("reviewDetails");
        edit.accept(s);
        return s;
    }

    static OrderingReturnSource.Head head(boolean buddy, ObjectNode selection) {
        return new OrderingReturnSource.Head(ORDER, "employee-paula", "slot-paula", buddy, OP, AT, selection);
    }

    static ObjectNode contract() {
        ObjectNode c = ReturnJson.JSON.createObjectNode();
        c.put("contractId", "current:employee-paula").put("slotId", "slot-old").put("status", "current");
        return c;
    }

    static ObjectNode draft(Consumer<ObjectNode> edit) {
        ObjectNode d = ReturnJson.JSON.createObjectNode();
        d.set("choices", StockDbFixture.complete());
        d.set("currentContract", contract());
        d.put("entitlementSlotId", "slot-paula");
        edit.accept(d);
        return d;
    }

    static ObjectNode account(Consumer<ObjectNode> edit) {
        ObjectNode a = ReturnJson.JSON.createObjectNode();
        a.putArray("contracts").add(contract().put("slotId", "slot-paula"));
        edit.accept(a);
        return a;
    }

    static ObjectNode buddySelection(JsonNode odometer) {
        return selection("replacement", s -> {
            s.putObject("source").put("type", "buddy-offer");
            s.remove("draft");
            ObjectNode v = s.putObject("sourceVersions");
            if (odometer == null) v.putNull("returnOdometer");
            else v.set("returnOdometer", odometer);
        });
    }

    static ObjectNode odometer(Object value, String unit) {
        ObjectNode o = ReturnJson.JSON.createObjectNode();
        if (value instanceof Integer i) o.put("value", i);
        else if (value instanceof Long l) o.put("value", l);
        o.put("unit", unit);
        return o;
    }

    static ReturnSource found(ReturnSourceReading r) {
        return assertInstanceOf(ReturnSourceReading.Found.class, r).source();
    }

    static void invalid(ReturnSourceReading r) {
        ReturnSourceReading.Invalid i = assertInstanceOf(ReturnSourceReading.Invalid.class, r);
        assertEquals(ReturnSource.INVALID, i.code());
        assertFalse(i.retryable());
    }

    @Test
    void aManualReplacementReadsTheDraftChoicesAndTheOldContract() {
        ReturnSource s = found(OrderingReturnSource.map(head(false, selection("replacement", x -> {})), draft(d -> {})));
        assertTrue(s.applicable());
        assertFalse(s.buddy());
        assertEquals(ORDER, s.orderUuid());
        assertEquals("employee-paula", s.employeeId());
        assertEquals("current:employee-paula", s.oldContractId());
        assertEquals("slot-paula", s.entitlementSlotId());
        assertEquals("slot-old", s.oldSlotId());
        assertEquals("demo-collection-centre", s.locationId());
        assertEquals(20000L, s.mileage());
        assertEquals("mi", s.mileageUnit());
        assertEquals(OP, s.sourceReference());
        assertEquals(AT, s.receivedAt());
        assertEquals("cfg-1", s.configurationId());
    }

    @Test
    void frozenReviewDetailsMileageWinsOverTheDraftChoice() {
        ObjectNode sel = selection("replacement", x -> x.putObject("reviewDetails").putObject("details")
                .put("expectedReturnMileage", 21500));
        assertEquals(21500L, found(OrderingReturnSource.map(head(false, sel), draft(d -> {}))).mileage());
        ObjectNode noDetails = selection("replacement", x -> x.putObject("reviewDetails").putNull("details"));
        assertEquals(20000L, found(OrderingReturnSource.map(head(false, noDetails), draft(d -> {}))).mileage());
    }

    @Test
    void anOldSlotFallsBackToTheEntitlementSlot() {
        ObjectNode d = draft(x -> ((ObjectNode) x.get("currentContract")).remove("slotId"));
        assertEquals("slot-paula", found(OrderingReturnSource.map(head(false, selection("replacement", x -> {})), d)).oldSlotId());
    }

    @Test
    void aManualNewOrderIsNotApplicableAndNeedsNoDraft() {
        OrderingReturnSource.Head h = head(false, selection("new", x -> {}));
        assertFalse(OrderingReturnSource.needsRecord(h));
        ReturnSource s = found(OrderingReturnSource.map(h, null));
        assertFalse(s.applicable());
        assertNull(s.oldContractId());
        assertNull(s.entitlementSlotId());
        assertNull(s.oldSlotId());
        assertNull(s.mileage());
        assertEquals(OP, s.sourceReference());
        assertEquals("cfg-1", s.configurationId());
    }

    @Test
    void aBuddyReplacementTakesTheOdometerAndTheCurrentContract() {
        OrderingReturnSource.Head h = head(true, buddySelection(odometer(18000, "km")));
        assertTrue(OrderingReturnSource.needsRecord(h));
        ReturnSource s = found(OrderingReturnSource.map(h, account(a -> {})));
        assertTrue(s.applicable());
        assertTrue(s.buddy());
        assertEquals("current:employee-paula", s.oldContractId());
        assertEquals("slot-paula", s.entitlementSlotId());
        assertNull(s.locationId());
        assertEquals(18000L, s.mileage());
        assertEquals("km", s.mileageUnit());
    }

    @Test
    void aBuddyNewOrderHasNoOdometerAndIsNotApplicable() {
        OrderingReturnSource.Head h = head(true, buddySelection(null));
        assertFalse(OrderingReturnSource.needsRecord(h));
        ReturnSource s = found(OrderingReturnSource.map(h, null));
        assertFalse(s.applicable());
        assertTrue(s.buddy());
    }

    @Test
    void unusableManualInputsAreInvalid() {
        ObjectNode sel = selection("replacement", x -> {});
        invalid(OrderingReturnSource.map(head(false, sel), null));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> d.putNull("currentContract"))));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> ((ObjectNode) d.get("choices")).put("expectedReturnMileage", -1))));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> ((ObjectNode) d.get("choices")).putNull("expectedReturnMileage"))));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> ((ObjectNode) d.get("choices")).put("oldContractId", "other"))));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> ((ObjectNode) d.get("choices")).put("collectionLocationId", " "))));
        invalid(OrderingReturnSource.map(head(false, sel), draft(d -> ((ObjectNode) d.get("choices")).put("mode", "new"))));
    }

    @Test
    void unusableBuddyInputsAreInvalid() {
        OrderingReturnSource.Head ok = head(true, buddySelection(odometer(18000, "km")));
        invalid(OrderingReturnSource.map(ok, null));
        invalid(OrderingReturnSource.map(ok, account(a -> a.putArray("contracts"))));
        invalid(OrderingReturnSource.map(ok, account(a -> ((ObjectNode) a.get("contracts").get(0)).put("status", "returned"))));
        invalid(OrderingReturnSource.map(ok, account(a -> ((ObjectNode) a.get("contracts").get(0)).put("returnedDate", "2026-10-01"))));
        invalid(OrderingReturnSource.map(head(true, buddySelection(odometer(-5, "km"))), account(a -> {})));
        invalid(OrderingReturnSource.map(head(true, buddySelection(odometer(1000, " "))), account(a -> {})));
        invalid(OrderingReturnSource.map(head(true, buddySelection(odometer(null, "km"))), account(a -> {})));
    }

    @Test
    void aSelectionWithoutADraftModeIsInvalid() {
        invalid(OrderingReturnSource.map(head(false, selection("other", x -> {})), null));
        invalid(OrderingReturnSource.map(head(false, selection("replacement", x -> x.remove("draft"))), null));
    }
}
