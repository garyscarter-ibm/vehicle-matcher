package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.claims.ManualStockShapes;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** ManualStock over a real PostgreSQL schema: Paula's saved draft, released stock rows and every browse refusal. */
class ManualStockDbTest {

    private static final String U = StockDbFixture.UUID_PREFIX;

    StockDbFixture fx;

    @BeforeEach
    void setUp() throws Exception {
        fx = StockDbFixture.create();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (fx != null) fx.close();
    }

    private static JsonNode decision(JsonNode value, String digit) {
        for (JsonNode d : value.get("decisions")) if (d.get("orderUuid").asText().equals(U + digit)) return d;
        return null;
    }

    private static List<String> codes(JsonNode list) {
        return list.findValuesAsText("code");
    }

    @Test
    void noDraftIsNotFoundAndAnIntentDraftNeedsOrderOptions() {
        assertEquals("not-found", fx.stock().browse(fx.identity(), null).outcome().status());
        fx.saveDraft("c-1", 0, StockDbFixture.intent());
        AccountOutcome out = fx.stock().browse(fx.identity(), null).outcome();
        assertEquals("conflict", out.status());
        assertEquals("order-options-required", out.refusal().get("reason").asText());
        assertEquals("order-options-required", out.refusal().get("view").get("state").asText());
        assertTrue(out.refusal().get("view").get("editable").asBoolean());
        assertEquals("choose-order-options", out.refusal().get("view").get("action").asText());
    }

    @Test
    void aDraftOverAnotherContextIsStale() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.update("UPDATE entitlement_slots SET attributes = attributes || '{\"earliestCollectionDate\":\"2026-11-09\"}'::jsonb "
                + "WHERE slot_id = 'slot-paula'");
        AccountOutcome out = fx.stock().browse(fx.identity(), null).outcome();
        assertEquals("stale-version", out.status(), String.valueOf(out.refusal()));
        assertEquals("manual-context", out.refusal().get("resource").asText());
    }

    @Test
    void theCompleteDraftBrowsesOnlyVisibleStockWithServerOwnedGates() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, 'h-jordan', ?, 'employee-jordan', 'slot-jordan', 1, 'cart', "
                + "'active', now() + interval '1 day')", fx.environmentId(), fx.runId(), U + "3");
        ManualStock.Browsed browsed = fx.stock().browse(fx.identity(), null);
        assertTrue(browsed.outcome().isOk(), String.valueOf(browsed.outcome().refusal()));
        JsonNode v = browsed.outcome().value();
        ObjectNode body = GoldenFixture.JSON.createObjectNode().put("status", "ok");
        body.set("value", v);
        assertEquals("slot-paula", browsed.slotId());

        assertEquals("available-stock", v.get("state").asText());
        assertFalse(v.get("ranked").asBoolean());
        assertFalse(v.get("browsingReservesStock").asBoolean());
        assertEquals(List.of(U + "1", U + "2", U + "3", U + "6", U + "7", U + "8"), v.get("decisions").findValuesAsText("orderUuid"));
        assertEquals(List.of(U + "1", U + "6"), v.get("cars").findValuesAsText("orderUuid"));
        assertEquals(2, v.get("total").asInt());
        assertEquals(1, v.get("versions").get("draft").asInt());
        assertEquals(v.get("versions").get("draft"), v.get("versions").get("brief"));
        assertEquals(fx.contextVersion(), v.get("versions").get("context").asText());
        assertEquals("gcsp-policy-v1", v.get("versions").get("policy").asText());
        assertTrue(v.get("versions").get("stock").asText().startsWith("stock:"));
        assertEquals(1, v.get("assumptions").size());
        assertEquals("available", v.get("view").get("state").asText());
        assertEquals("review-car", v.get("view").get("action").asText());

        JsonNode one = decision(v, "1");
        assertEquals("eligible", one.get("gateStatus").asText());
        assertTrue(one.get("suitable").asBoolean());
        assertTrue(one.get("score").isNull());
        assertEquals(0, one.get("components").size());
        assertEquals("1000001", one.get("orderNumber").asText());
        assertEquals(1, one.get("draftVersion").asInt());
        assertEquals("review-car", one.get("view").get("action").asText());
        assertEquals("employee", one.get("view").get("supportOwner").asText());
        assertEquals(1100, one.get("terms").get("points").get("value").asInt());
        assertTrue(one.get("brief").get("requiredBy").asText().startsWith("2026-11-12T23:59:59.999Z"));

        assertEquals("ineligible", decision(v, "2").get("gateStatus").asText());
        assertTrue(codes(decision(v, "2").get("blockers")).contains("policy-exclude"));
        JsonNode held = decision(v, "3");
        assertEquals("ineligible", held.get("gateStatus").asText());
        assertTrue(codes(held.get("blockers")).contains("not-available"));
        assertEquals("choose-another-car", held.get("view").get("action").asText());

        assertEquals("eligible", decision(v, "6").get("gateStatus").asText(), "equal to the grade limit is allowed");
        JsonNode over = decision(v, "7");
        assertEquals("ineligible", over.get("gateStatus").asText());
        JsonNode limit = over.get("blockers").get(over.get("blockers").size() - 1);
        assertEquals("insurance-grade-limit", limit.get("code").asText());
        assertEquals(35, limit.get("maximum").asInt());
        assertEquals(40, limit.get("actual").asInt());
        assertEquals("manual.context.v1", limit.get("assumptionKey").asText());
        JsonNode unknown = decision(v, "8");
        assertEquals("needs-confirmation", unknown.get("gateStatus").asText());
        assertEquals(List.of("insurance-unconfirmed"), codes(unknown.get("unknowns")));
        assertEquals("scheme-support", unknown.get("view").get("supportOwner").asText());
        assertEquals("request-confirmation", unknown.get("view").get("action").asText());
        assertNull(decision(v, "4"));
        assertNull(decision(v, "5"));
        assertFalse(v.toString().contains("employee-jordan"));
    }

    @Test
    void theEmployeesOwnHeldCarStaysAvailableToThem() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.hold("h-own", U + "1", "employee-paula", "slot-paula", "cart");
        JsonNode other = fx.stock().browse(fx.identity(), null).outcome().value();
        assertEquals("ineligible", decision(other, "1").get("gateStatus").asText());
        JsonNode own = fx.stock().browse(fx.identity(), U + "1").outcome().value();
        assertEquals("eligible", decision(own, "1").get("gateStatus").asText());
    }

    @Test
    void anEmptyReleaseIsEmptyStock() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.update("DELETE FROM stock_cars WHERE environment_id = ? AND run_id = ?", fx.environmentId(), fx.runId());
        JsonNode v = fx.stock().browse(fx.identity(), null).outcome().value();
        assertEquals("empty-stock", v.get("state").asText());
        assertEquals(0, v.get("total").asInt());
        assertEquals("empty", v.get("view").get("state").asText());
        assertEquals("retry-or-contact-support", v.get("view").get("action").asText());
    }

    @Test
    void aReleasedRowWithoutAnOrderNumberMakesTheSourceUnavailable() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.update("UPDATE stock_cars SET attributes = attributes - 'orderNumber' WHERE order_uuid = ?", U + "1");
        AccountOutcome out = fx.stock().browse(fx.identity(), null).outcome();
        assertEquals("unavailable", out.status());
        assertEquals("released-stock", out.refusal().get("source").asText());
        fx.update("UPDATE stock_cars SET attributes = attributes - 'visibility' WHERE order_uuid = ?", U + "1");
        assertEquals("unavailable", fx.stock().browse(fx.identity(), null).outcome().status());
    }

    @Test
    void theStockPayloadMeetsTheAngularContract() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        ObjectNode body = GoldenFixture.JSON.createObjectNode().put("status", "ok");
        body.set("value", fx.stock().browse(fx.identity(), null).outcome().value());
        // The browse itself carries no claimInput, so it is the plain shape the validator accepts.
        List<JsonNode> rows = ManualStockShapes.assertOkStock(body, Map.of("employeeId", fx.employeeId(),
                "environmentId", fx.environmentId(), "runId", fx.runId()));
        assertEquals(6, rows.size());
    }

    @Test
    void standingAndOrderFactsFollowTheCurrentDraft() throws Exception {
        assertTrue(fx.stock().standing(fx.identity()).isEmpty());
        fx.saveDraft("c-1", 0, StockDbFixture.intent());
        assertTrue(fx.stock().standing(fx.identity()).isEmpty(), "an intent draft has no claimant");
        assertTrue(fx.stock().orderFacts(fx.identity()).isEmpty());
        fx.saveDraft("c-2", 1, StockDbFixture.complete());
        ManualStock.Standing s = fx.stock().standing(fx.identity()).orElseThrow();
        assertEquals("slot-paula", s.slotId());
        assertEquals(2, s.draftVersion());
        assertEquals("driver:employee-paula", s.driverId());
        assertEquals(fx.contextVersion(), s.contextVersion());
        ManualStock.OrderFacts o = fx.stock().orderFacts(fx.identity()).orElseThrow();
        assertEquals("replacement", o.mode());
        assertEquals("driver:employee-paula", o.driver().get("driverId").asText());
        assertEquals("paula.mason@gcsp-demo.com", o.contact().get("email").asText());
        assertEquals("employee-paula", o.employee().get("employeeId").asText());
        assertTrue(o.sourceVersions().has("clock"));
    }
}
