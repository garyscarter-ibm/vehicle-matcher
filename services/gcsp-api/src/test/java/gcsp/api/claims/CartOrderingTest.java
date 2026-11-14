package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingTerms;
import gcsp.api.ordering.SyntheticOrderingProvider;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The real cart converter inside ordering's transaction: claim, review, submit, and the race with a release. */
class CartOrderingTest {

    ClaimFixture f;
    OrderingService ordering;
    CartSelectionConversion cart;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        for (int i = 0; i < 20; i++) {
            f.employee("r" + i);
            f.car("race-" + i);
        }
        f.employee("e1");
        f.car("car-1");
        wire(f.claims);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    private void wire(ManualClaims claims) throws Exception {
        f.claims = claims;
        cart = new CartSelectionConversion(() -> Optional.of(claims));
        var pool = f.pool();
        ordering = new OrderingService(pool, new OrderingTerms(new PolicyService(new RetainedFilePolicySource()),
                ctx -> f.clock.now), new SyntheticOrderingProvider(pool), java.time.Duration.ofSeconds(30),
                java.time.Duration.ZERO, () -> f.clock.now);
    }

    private OrderingScope scope(String employee) {
        return new OrderingScope(ClaimFixture.ENV, ClaimFixture.RUN, employee, "slot-" + employee, ClaimFixture.VERSION);
    }

    private JsonNode reviewed(String employee, String car) {
        JsonNode h = f.claimOk(employee, car);
        return ClaimFixture.value(f.claims.beginReview(f.scope(employee),
                ClaimFixture.actionInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong())))
                .get("hold");
    }

    private ObjectNode body(String employee, String car, JsonNode hold, String quoteId, String commandId) {
        ObjectNode b = ClaimFixture.JSON.createObjectNode();
        b.put("commandId", commandId);
        b.putObject("source").put("type", "cart").put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", quoteId).put("expectedStockVersion", carVersion(car));
        b.put("termsDigest", ((OrderingResult.Ok) ordering.terms(scope(employee))).value().get("termsDigest").asText());
        b.putObject("declarations").put("terms", true).put("driver", true);
        return b;
    }

    private long carVersion(String car) {
        try {
            return f.carVersion(car);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String quoteOf(JsonNode hold) {
        return "manual-quote:" + hold.get("holdId").asText().substring("manual-hold:".length());
    }

    @Test
    void theClaimViewCarriesTheDeterministicQuoteId() throws Exception {
        JsonNode view = ClaimFixture.value(f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        String holdId = view.get("hold").get("holdId").asText();
        assertEquals("manual-quote:" + holdId.substring("manual-hold:".length()), view.get("quote").get("quoteId").asText());
        assertEquals(2, view.get("quote").get("stockVersion").asLong());
    }

    @Test
    void aReviewedClaimSubmitsOnceAllocatesTheHoldAndCarAndReplaysTheSameOrder() throws Exception {
        JsonNode hold = reviewed("e1", "car-1");
        ObjectNode b = body("e1", "car-1", hold, quoteOf(hold), "ord-1");
        OrderingResult first = ordering.submit(scope("e1"), b, cart);
        assertInstanceOf(OrderingResult.Ok.class, first);
        assertEquals("allocated", f.text("SELECT state FROM custody_holds WHERE hold_id = ?", hold.get("holdId").asText()));
        assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(1, f.count("SELECT count(*) FROM selection_orders WHERE hold_id = ?", hold.get("holdId").asText()));
        assertEquals(ClaimFixture.orderNumber("car-1"), f.text("SELECT selection->'stock'->>'orderNumber' FROM selection_orders"));
        OrderingResult again = ordering.submit(scope("e1"), b.deepCopy(), cart);
        assertTrue(assertInstanceOf(OrderingResult.Ok.class, again).replayed());
        assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
    }

    @Test
    void submittingFromPreviewOrWithAStaleQuoteIdOrStockRefusesAndWritesNothing() throws Exception {
        JsonNode preview = f.claimOk("e1", "car-1");
        OrderingResult early = ordering.submit(scope("e1"), body("e1", "car-1", preview, quoteOf(preview), "ord-p"), cart);
        assertEquals("order-review-required", assertInstanceOf(OrderingResult.Refused.class, early).code());
        JsonNode hold = ClaimFixture.value(f.claims.beginReview(f.scope("e1"), ClaimFixture.actionInput(
                ClaimFixture.commandId(), preview.get("holdId").asText(), preview.get("version").asLong()))).get("hold");
        OrderingResult stale = ordering.submit(scope("e1"), body("e1", "car-1", hold, "manual-quote:old", "ord-q"), cart);
        assertEquals("quote-changed", assertInstanceOf(OrderingResult.Refused.class, stale).code());
        ObjectNode wrongStock = body("e1", "car-1", hold, quoteOf(hold), "ord-s");
        wrongStock.put("expectedStockVersion", 99);
        assertEquals("stock-changed", assertInstanceOf(OrderingResult.Refused.class,
                ordering.submit(scope("e1"), wrongStock, cart)).code());
        assertEquals(0, f.count("SELECT count(*) FROM selection_orders"));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
    }

    @Test
    void anExpiredReviewClaimRefusesBeforeAnyOrderExists() throws Exception {
        JsonNode hold = reviewed("e1", "car-1");
        ObjectNode b = body("e1", "car-1", hold, quoteOf(hold), "ord-x");
        f.clock.now = ClaimFixture.T0.plusSeconds(3600);
        OrderingResult r = ordering.submit(scope("e1"), b, cart);
        assertEquals("claim-expired", assertInstanceOf(OrderingResult.Refused.class, r).code());
        assertEquals(0, f.count("SELECT count(*) FROM selection_orders"));
    }

    @Test
    void aReleaseRacingTheSubmitNeverLeavesAnOrderOnAHoldThatIsNotAllocated() throws Exception {
        AtomicInteger submitWins = new AtomicInteger();
        AtomicInteger releaseWins = new AtomicInteger();
        for (int i = 0; i < 20; i++) {
            String employee = "r" + i;
            String car = "race-" + i;
            JsonNode hold = reviewed(employee, car);
            ObjectNode b = body(employee, car, hold, quoteOf(hold), "ord-race-" + i);
            ObjectNode rel = ClaimFixture.releaseInput(ClaimFixture.commandId(), hold.get("holdId").asText(),
                    hold.get("version").asLong(), "cancel");
            var results = ClaimFixture.race(() -> ordering.submit(scope(employee), b, cart),
                    () -> f.claims.release(f.scope(employee), rel));
            boolean submitted = results.get(0) instanceof OrderingResult.Ok || results.get(0) instanceof OrderingResult.Pending;
            boolean released = results.get(1) instanceof ClaimResult.Ok;
            assertTrue(submitted ^ released, "exactly one wins on iteration " + i + ": " + results);
            String holdId = hold.get("holdId").asText();
            long orders = f.count("SELECT count(*) FROM selection_orders WHERE hold_id = ?", holdId);
            String state = f.text("SELECT state FROM custody_holds WHERE hold_id = ?", holdId);
            if (submitted) {
                submitWins.incrementAndGet();
                assertEquals(1, orders);
                assertEquals("allocated", state);
                assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = ?", car));
            } else {
                releaseWins.incrementAndGet();
                assertEquals(0, orders);
                assertEquals("released", state);
                assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = ?", car));
            }
        }
        assertEquals(20, submitWins.get() + releaseWins.get());
        assertEquals(0, f.count("SELECT count(*) FROM selection_orders o JOIN custody_holds h ON h.hold_id = o.hold_id "
                + "WHERE h.state <> 'allocated'"));
    }

    @Test
    void remoteModeLeavesTheHoldSelectionPendingWithOrderingsOperationIdAndTheSweepAllocates() throws Exception {
        ScriptedClaimStock stock = new ScriptedClaimStock();
        wire(f.newClaims(stock));
        JsonNode hold = reviewed("e1", "car-1");
        assertInstanceOf(OrderingResult.Ok.class, ordering.submit(scope("e1"),
                body("e1", "car-1", hold, quoteOf(hold), "ord-r"), cart));
        String opId = ManualClaims.operationId(OrderingService.operationId(scope("e1")), "manual-allocate");
        assertEquals("selection-pending", f.text("SELECT state FROM custody_holds WHERE hold_id = ?", hold.get("holdId").asText()));
        assertEquals(1, f.count("SELECT count(*) FROM pending_operations WHERE operation_id = ? AND state = 'intent'", opId));
        assertEquals(0, stock.ledger.calls(opId));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(1, f.claims.reconcileOpen(f.system(), 10));
        assertEquals("allocated", f.text("SELECT state FROM custody_holds WHERE hold_id = ?", hold.get("holdId").asText()));
        assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(1, stock.ledger.effects(opId));
        assertEquals(1, f.count("SELECT count(*) FROM selection_orders"));
    }
}
