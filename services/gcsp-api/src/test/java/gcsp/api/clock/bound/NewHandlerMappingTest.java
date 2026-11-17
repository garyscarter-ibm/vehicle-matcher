package gcsp.api.clock.bound;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.production.ProductionResult;
import org.junit.jupiter.api.Test;

/** How the manual-claim and Production handlers map their services' answers. */
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
