package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.OrderSourcePort;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

/** Submit end to end on native PostgreSQL: the handoff, the refusals that write nothing, and the Buddy path. */
class OrderingSubmitTest {

    @Test
    void aCartHandoffIsAcknowledgedWithOneProviderRecordAndTheEvents() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            OrderingResult r = f.submit("e1", "c1");
            assertEquals("acknowledged", OrderingFixture.status(r));
            var v = OrderingFixture.value(r);
            assertEquals("GCSP-000001", v.get("orderReference").asText());
            assertEquals("synthetic-ordering:v1:" + v.get("operationId").asText(), v.get("providerReference").asText());
            assertEquals("awaiting-approval", v.path("view").path("state").asText());
            assertEquals("HR approval", v.path("progress").path("current").asText());
            assertEquals(1, f.provider.executes.get());
            assertEquals(1, f.count("SELECT count(*) FROM ordering_synthetic_receipts"));
            assertEquals("acknowledged", f.text("SELECT state FROM pending_operations"));
            assertEquals("allocated", f.text("SELECT state FROM custody_holds WHERE hold_id = 'hold-e1'"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-received'"));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'ordering.selection-acknowledged'"));
            assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type LIKE 'notification.%'"));
            assertEquals("GCSP-000002", OrderingFixture.value(f.submit("e2", "c2")).get("orderReference").asText());
            assertEquals("acknowledged", OrderingFixture.status(f.service.read(f.scope("e1"))));
        }
    }

    @Test
    void readBeforeAnySubmitIsNotFound() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            assertEquals(404, assertInstanceOf(OrderingResult.Refused.class, f.service.read(f.scope("e1"))).status());
        }
    }

    @Test
    void aBuddyOfferHandoffIsAcknowledgedAndTheOrderSourceRoutesItBuddy() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            OrderingResult r = f.service.submitTrusted(f.scope("e2"), f.body("e2", true, "c1"), f.buddy);
            assertEquals("acknowledged", OrderingFixture.status(r));
            assertEquals("buddy-offer", OrderingFixture.value(r).path("selection").path("sourceType").asText());
            var found = new OrderingOrderSource(f.pool()).find(f.ctx(), "car-b-e2");
            var order = assertInstanceOf(OrderSourcePort.Ready.class, found).order();
            assertEquals("buddy", order.route());
            assertEquals("renewal-e2", order.renewalId());
            assertEquals("buddy-offer", order.source().path("sourceType").asText());
            // The employee route never accepts a Buddy converter and the trusted route never a cart one.
            assertInstanceOf(OrderingResult.Unavailable.class, f.service.submit(f.scope("e1"), f.body("e1", true, "x"), f.buddy));
            assertInstanceOf(OrderingResult.Unavailable.class, f.service.submitTrusted(f.scope("e1"), f.body("e1", false, "x"), f.cart));
        }
    }

    @Test
    void anUnconfiguredConverterAndAnUnconfiguredProviderRefuseWithoutWriting() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            var r = f.service.submit(f.scope("e1"), f.body("e1", false, "c1"), new UnconfiguredConversion("cart"));
            assertEquals("selection-source-unsupported", assertInstanceOf(OrderingResult.Unavailable.class, r).code());
            OrderingService none = f.newService(f.pool(), new OrderingFixture.TestProvider(new UnconfiguredOrderingProvider()));
            assertEquals("ordering-provider-not-configured", assertInstanceOf(OrderingResult.Unavailable.class,
                    none.submit(f.scope("e1"), f.body("e1", false, "c1"), f.cart)).code());
            assertEquals(0, f.written());
            assertEquals(0, f.cart.converts.get() + f.buddy.converts.get());
        }
    }

    @Test
    void declarationFailuresAreInvalidAndWriteNothing() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            for (Consumer<ObjectNode> bad : java.util.List.<Consumer<ObjectNode>>of(
                    d -> d.remove("driver"),
                    d -> d.put("extra", true),
                    d -> d.put("driver", false),
                    d -> d.put("return", true))) {
                ObjectNode b = f.body("e1", false, "c1");
                bad.accept((ObjectNode) b.get("declarations"));
                var r = assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), b, f.cart));
                assertEquals("invalid", r.code());
                assertEquals("declarations", r.field());
            }
            // A replacement draft needs the return declaration, and a new draft refuses it (done above).
            f.cart.mode = "replacement";
            assertEquals("declarations", assertInstanceOf(OrderingResult.Refused.class,
                    f.service.submit(f.scope("e1"), f.body("e1", false, "c2"), f.cart)).field());
            ObjectNode ok = f.body("e1", false, "c3");
            ((ObjectNode) ok.get("declarations")).put("return", true);
            assertEquals("acknowledged", OrderingFixture.status(f.service.submit(f.scope("e1"), ok, f.cart)));
        }
    }

    @Test
    void malformedBodiesAreInvalid() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            ObjectNode extra = f.body("e1", false, "c1");
            extra.put("surprise", 1);
            ObjectNode version = f.body("e1", false, "c1");
            ((ObjectNode) version.get("source")).put("expectedHoldVersion", 0);
            for (ObjectNode b : new ObjectNode[] {extra, version}) {
                assertEquals(400, assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), b, f.cart)).status());
            }
            assertEquals(0, f.written());
        }
    }

    @Test
    void aChangedTermsDigestAndPolicyFailuresWriteNothing() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            ObjectNode stale = f.body("e1", false, "c1");
            stale.put("termsDigest", "0".repeat(64));
            assertEquals("terms-changed", assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), stale, f.cart)).code());

            ObjectNode body = f.body("e1", false, "c2");
            OrderingScope other = new OrderingScope(OrderingFixture.ENV, OrderingFixture.RUN, "e1", "slot-e1", "no-such-version");
            assertEquals("ordering-policy-unavailable", assertInstanceOf(OrderingResult.Unavailable.class,
                    f.service.submit(other, body, f.cart)).code());

            f.policySource.edits.put("ordering.terms.v1", a -> ((ObjectNode) a.get("value")).put("fictional", false));
            assertEquals("ordering-policy-invalid", assertInstanceOf(OrderingResult.Unavailable.class,
                    f.service.submit(f.scope("e1"), body, f.cart)).code());
            f.policySource.edits.clear();
            f.policySource.edits.put("ordering.reference.v1", a -> ((ObjectNode) a.get("value")).put("digits", 40));
            assertEquals("order-reference-policy-invalid", assertInstanceOf(OrderingResult.Unavailable.class,
                    f.service.submit(f.scope("e1"), body, f.cart)).code());
            f.policySource.edits.clear();
            f.policySource.down = true;
            assertInstanceOf(OrderingResult.Unavailable.class, f.service.terms(f.scope("e1")));
            assertEquals(0, f.written());
            f.policySource.down = false;
            assertEquals("acknowledged", OrderingFixture.status(f.service.submit(f.scope("e1"), body, f.cart)));
        }
    }

    @Test
    void staleVersionsFromTheConverterRefuseWithNoRowsAndTheHoldStillActive() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            ObjectNode hold = f.body("e1", false, "c1");
            ((ObjectNode) hold.get("source")).put("expectedHoldVersion", 5);
            assertEquals("claim-changed", assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), hold, f.cart)).code());
            ObjectNode quote = f.body("e1", false, "c1");
            quote.put("expectedQuoteId", "q-other");
            assertEquals("quote-changed", assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), quote, f.cart)).code());
            ObjectNode stock = f.body("e1", false, "c1");
            stock.put("expectedStockVersion", 9);
            assertEquals("stock-changed", assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), stock, f.cart)).code());
            f.update("UPDATE custody_holds SET expires_at = ? WHERE hold_id = 'hold-e1'",
                    java.sql.Timestamp.from(OrderingFixture.NOW.minusSeconds(1)));
            assertEquals("claim-expired", assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), f.body("e1", false, "c1"), f.cart)).code());
            assertEquals(0, f.written());
            assertEquals(0, f.provider.executes.get());
        }
    }

    @Test
    void aRefusalAfterTheConverterMutatedCustodyRollsTheHoldBack() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.cart.refuseAfterMutation = "entitlement-unavailable";
            var r = assertInstanceOf(OrderingResult.Refused.class, f.service.submit(f.scope("e1"), f.body("e1", false, "c1"), f.cart));
            assertEquals("entitlement-unavailable", r.code());
            assertEquals("active", f.text("SELECT state FROM custody_holds WHERE hold_id = 'hold-e1'"));
            assertEquals("1", f.text("SELECT version FROM custody_holds WHERE hold_id = 'hold-e1'"));
            assertEquals(0, f.written());
        }
    }

    @Test
    void theSnapshotAndTheIdentityAreImmutable() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            f.submit("e1", "c1");
            org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                    () -> f.update("UPDATE selection_orders SET order_reference = 'X'"));
            org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                    () -> f.update("UPDATE selection_orders SET selection = '{}'::jsonb"));
            org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class, () -> f.update("DELETE FROM selection_orders"));
            f.update("UPDATE selection_orders SET handoff_lease_until = NULL, updated_at = now()");
            assertTrue(f.text("SELECT selection::text FROM selection_orders").contains("termsDigest"));
            assertFalse(f.text("SELECT selection::text FROM selection_orders").isEmpty());
            assertNull(f.text("SELECT handoff_lease_until::text FROM selection_orders"));
        }
    }
}
