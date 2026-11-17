package gcsp.api.clock.bound;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.ExpiryResult;
import gcsp.api.allocation.TriggerResult;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.production.ProductionResult;
import java.util.List;
import org.junit.jupiter.api.Test;

/** How the manual-claim, Buddy expiry, Buddy allocation and Production handlers map their services' answers. */
class NewHandlerMappingTest {

    private static final JsonNodeFactory N = JsonNodeFactory.instance;

    @Test
    void manualClaimCountsReportExpiredAndReconciled() {
        ObjectNode value = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class,
                ManualClaimExpiryTickHandler.counts(2, 1)).value();
        assertEquals(2, value.get("expired").asInt());
        assertEquals(1, value.get("reconciled").asInt());
    }

    @Test
    void buddyExpiryDoneCountsLapsesRetainedReleasesAndReplay() {
        var lapse = new ExpiryResult.Lapse("h", "o", "car", "e", "t0", "t1");
        var done = new ExpiryResult.Done(List.of(lapse), List.of(new ExpiryResult.Retained("h2", "stock")),
                List.of(), true);
        ObjectNode value = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class, BuddyExpiryTickHandler.map(done)).value();
        assertEquals(1, value.get("expired").asInt());
        assertEquals(1, value.get("retained").asInt());
        assertEquals(0, value.get("releases").asInt());
        assertEquals(true, value.get("replayed").asBoolean());
    }

    @Test
    void buddyExpiryPendingRefusedAndStaleRunMapToFailures() {
        assertEquals(new HandlerOutcome.Failed("unavailable", "database-unavailable", true),
                BuddyExpiryTickHandler.map(new ExpiryResult.Pending("database-unavailable", true)));
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false),
                BuddyExpiryTickHandler.map(new ExpiryResult.Pending("stale-run", false)));
        assertEquals(new HandlerOutcome.Failed("invalid", "invalid-scope", false),
                BuddyExpiryTickHandler.map(new ExpiryResult.Refused("invalid-scope", "m")));
        assertEquals(new HandlerOutcome.Failed("invalid", "policy-unavailable", false),
                BuddyExpiryTickHandler.map(new ExpiryResult.Refused("policy-unavailable", "m")));
        assertEquals(new HandlerOutcome.Failed("conflict", "command-input-changed", false),
                BuddyExpiryTickHandler.map(new ExpiryResult.Refused("command-input-changed", "m")));
    }

    @Test
    void buddyAllocationConsumedReportsCountAndCursor() {
        var item = new TriggerResult.Item("a-1", "stock-released", "evt-1", "completed");
        ObjectNode value = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class,
                BuddyAllocationTickHandler.map(new TriggerResult.Consumed(List.of(item), 7, "evt-1"))).value();
        assertEquals(1, value.get("allocated").asInt());
        assertEquals(7, value.get("cursorRevision").asLong());
        assertEquals("evt-1", value.get("cursorEventId").asText());
    }

    @Test
    void buddyAllocationPendingAndRefusedMapToFailures() {
        assertEquals(new HandlerOutcome.Failed("unavailable", "candidates-unavailable", true),
                BuddyAllocationTickHandler.map(new TriggerResult.Pending("candidates-unavailable", true)));
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false),
                BuddyAllocationTickHandler.map(new TriggerResult.Pending("stale-run", false)));
        assertEquals(new HandlerOutcome.Failed("invalid", "allocation-trigger-invalid", false),
                BuddyAllocationTickHandler.map(new TriggerResult.Refused("allocation-trigger-invalid", "m")));
        assertEquals(new HandlerOutcome.Failed("conflict", "candidates-unavailable", false),
                BuddyAllocationTickHandler.map(new TriggerResult.Refused("candidates-unavailable", "m")));
    }

    @Test
    void productionResultsMapEachVariant() {
        JsonNode value = N.objectNode().put("reconciled", 2);
        assertEquals(new HandlerOutcome.Ok(value), ProductionTickHandler.map(new ProductionResult.Ok(value, false)));
        assertEquals(new HandlerOutcome.Pending("op-1", "production", "uncertain"),
                ProductionTickHandler.map(new ProductionResult.Uncertain("op-1")));
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false),
                ProductionTickHandler.map(new ProductionResult.Conflict("stale-run", "r", false, null)));
        assertEquals(new HandlerOutcome.Failed("conflict", "x", true),
                ProductionTickHandler.map(new ProductionResult.Conflict("x", "r", true, null)));
        assertEquals(new HandlerOutcome.Failed("unavailable", "clock-not-set", true),
                ProductionTickHandler.map(new ProductionResult.Unavailable("clock-not-set", "r", true)));
        assertEquals(new HandlerOutcome.Failed("invalid", "invalid-limit", false),
                ProductionTickHandler.map(new ProductionResult.Invalid("invalid-limit", "r")));
        assertEquals(new HandlerOutcome.Failed("unavailable", "production-pending", true),
                ProductionTickHandler.map(new ProductionResult.Pending(value)));
    }
}
