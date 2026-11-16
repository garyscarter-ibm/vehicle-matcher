package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** F468: a cart submit naming expectedReviewDetailsVersion freezes the saved details in the same transaction. */
class OrderingReviewDetailsTest {

    /** A freeze that records what it was asked and either writes a marker row or refuses. */
    private static final class StubFreeze implements OrderingService.ReviewFreeze {
        final AtomicInteger calls = new AtomicInteger();
        final AtomicReference<String> refuse = new AtomicReference<>();
        volatile String binding;

        @Override
        public Frozen freeze(gcsp.api.persistence.Tx tx, OrderingScope scope, String holdId, String quoteId,
                long expectedHold, long expectedDraft, long version) throws Exception {
            calls.incrementAndGet();
            binding = String.join("|", scope.runId(), scope.employeeId(), scope.entitlementSlotId(), holdId, quoteId,
                    Long.toString(expectedHold), Long.toString(expectedDraft), Long.toString(version));
            tx.write("INSERT INTO event_outbox_probe_freeze (hold_id) VALUES (?)", holdId);
            if (refuse.get() != null) return new Frozen(null, refuse.get());
            ObjectNode snap = OrderingFixture.JSON.createObjectNode().put("reviewDetailsVersion", version);
            snap.putObject("details").put("specialRequirements", "none");
            return new Frozen(snap, null);
        }
    }

    private static OrderingFixture fixture(StubFreeze freeze) throws Exception {
        OrderingFixture f = OrderingFixture.create();
        f.update("CREATE TABLE event_outbox_probe_freeze (hold_id text NOT NULL)");
        f.service.withReviewFreeze(freeze);
        return f;
    }

    private static ObjectNode withVersion(ObjectNode body, Object version) {
        if (version instanceof Integer i) body.put("expectedReviewDetailsVersion", i);
        else if (version instanceof String s) body.put("expectedReviewDetailsVersion", s);
        return body;
    }

    @Test
    void aCartSubmitFreezesTheExactBindingAndKeepsTheFrozenDetailsInTheSelection() throws Exception {
        StubFreeze freeze = new StubFreeze();
        try (OrderingFixture f = fixture(freeze)) {
            OrderingResult r = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c1"), 2), f.cart);
            assertEquals("acknowledged", OrderingFixture.status(r), String.valueOf(r));
            assertEquals("run-1|e1|slot-e1|hold-e1|q-e1|1|1|2", freeze.binding);
            assertEquals(1L, f.count("SELECT count(*) FROM event_outbox_probe_freeze"));
            assertEquals("2", f.text("SELECT selection->'reviewDetails'->>'reviewDetailsVersion' FROM selection_orders"));
            assertEquals("none", f.text("SELECT selection->'reviewDetails'->'details'->>'specialRequirements' FROM selection_orders"));
        }
    }

    @Test
    void aRefusedFreezeRollsBackFreezeIntentAndConversion() throws Exception {
        StubFreeze freeze = new StubFreeze();
        freeze.refuse.set("stale-review-details");
        try (OrderingFixture f = fixture(freeze)) {
            OrderingResult r = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c1"), 1), f.cart);
            assertInstanceOf(OrderingResult.Refused.class, r);
            assertEquals("stale-review-details", ((OrderingResult.Refused) r).code());
            assertEquals(0L, f.count("SELECT count(*) FROM event_outbox_probe_freeze"));
            assertEquals(0L, f.count("SELECT count(*) FROM selection_orders"));
            assertEquals(0L, f.count("SELECT count(*) FROM pending_operations"));
            assertEquals(0, f.cart.converts.get());
            assertEquals("active", f.text("SELECT state FROM custody_holds WHERE hold_id = 'hold-e1'"));
        }
    }

    @Test
    void aFailedConversionAfterTheFreezeRollsTheFreezeBack() throws Exception {
        StubFreeze freeze = new StubFreeze();
        try (OrderingFixture f = fixture(freeze)) {
            f.cart.refuseAfterMutation = "stock-changed";
            OrderingResult r = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c1"), 1), f.cart);
            assertInstanceOf(OrderingResult.Refused.class, r);
            assertEquals(1, freeze.calls.get());
            assertEquals(0L, f.count("SELECT count(*) FROM event_outbox_probe_freeze"));
            assertEquals(0L, f.count("SELECT count(*) FROM selection_orders"));
            assertEquals("active", f.text("SELECT state FROM custody_holds WHERE hold_id = 'hold-e1'"));
        }
    }

    @Test
    void aRepeatedCommandReplaysTheOneIntentWithoutFreezingAgain() throws Exception {
        StubFreeze freeze = new StubFreeze();
        try (OrderingFixture f = fixture(freeze)) {
            ObjectNode body = withVersion(f.body("e1", false, "c1"), 1);
            assertEquals("acknowledged", OrderingFixture.status(f.service.submit(f.scope("e1"), body.deepCopy(), f.cart)));
            OrderingResult again = f.service.submit(f.scope("e1"), body.deepCopy(), f.cart);
            assertEquals("acknowledged", OrderingFixture.status(again), String.valueOf(again));
            assertEquals(1, freeze.calls.get());
            assertEquals(1L, f.count("SELECT count(*) FROM selection_orders"));
            assertEquals(1L, f.count("SELECT count(*) FROM event_outbox_probe_freeze"));
            OrderingResult changed = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c2"), 2), f.cart);
            assertInstanceOf(OrderingResult.Refused.class, changed);
        }
    }

    @Test
    void theVersionMustBeANonNegativeIntegerOnACartSource() throws Exception {
        StubFreeze freeze = new StubFreeze();
        try (OrderingFixture f = fixture(freeze)) {
            for (Object bad : new Object[] {-1, "1"}) {
                OrderingResult r = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c-" + bad), bad), f.cart);
                assertEquals(400, ((OrderingResult.Refused) r).status(), String.valueOf(bad));
            }
            OrderingResult buddy = f.service.submitTrusted(f.scope("e1"), withVersion(f.body("e1", true, "cb"), 1), f.buddy);
            assertEquals(400, ((OrderingResult.Refused) buddy).status());
            assertEquals(0, freeze.calls.get());
        }
    }

    @Test
    void withoutTheVersionNothingIsFrozenAndTheSelectionHoldsNull() throws Exception {
        StubFreeze freeze = new StubFreeze();
        try (OrderingFixture f = fixture(freeze)) {
            assertEquals("acknowledged", OrderingFixture.status(f.submit("e1", "c1")));
            assertEquals(0, freeze.calls.get());
            assertTrue(f.text("SELECT jsonb_typeof(selection->'reviewDetails') FROM selection_orders").equals("null"));
        }
    }

    @Test
    void theDefaultServiceRefusesAFreezeItCannotPerform() throws Exception {
        try (OrderingFixture f = OrderingFixture.create()) {
            OrderingResult r = f.service.submit(f.scope("e1"), withVersion(f.body("e1", false, "c1"), 1), f.cart);
            assertEquals("review-details-unavailable", assertInstanceOf(OrderingResult.Unavailable.class, r).code());
            assertEquals(0L, f.count("SELECT count(*) FROM selection_orders"));
        }
    }
}
