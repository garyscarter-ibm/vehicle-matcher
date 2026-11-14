package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.WorkResult;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Expiry, review, release, allocation and the unavailable paths, on the controllable clock. */
class ClaimLifecycleTest {

    ClaimFixture f;

    @BeforeEach
    void setUp() throws Exception {
        f = ClaimFixture.create();
        f.employee("e1");
        f.employee("e2");
        f.car("car-1");
        f.car("car-2");
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    private JsonNode hold(String holdId) {
        return ClaimFixture.value(f.claims.readClaim(f.scope("e1"))).get("hold");
    }

    private ClaimResult review(JsonNode hold) {
        return f.claims.beginReview(f.scope("e1"),
                ClaimFixture.actionInput(ClaimFixture.commandId(), hold.get("holdId").asText(), hold.get("version").asLong()));
    }

    // ---- expiry ----

    @Test
    void aPreviewHoldExpiresAtExactly120SecondsAndNotBefore() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        assertEquals("2026-11-13T09:02:00.000Z", h.get("expiresAt").asText());
        f.clock.now = ClaimFixture.T0.plusSeconds(119);
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals("quoted", ClaimFixture.value(f.claims.readClaim(f.scope("e1"))).get("state").asText());
        f.clock.now = ClaimFixture.T0.plusSeconds(120);
        JsonNode after = ClaimFixture.value(f.claims.readClaim(f.scope("e1")));
        assertEquals("expired", after.get("state").asText());
        assertEquals("expiry", after.get("hold").get("releaseReason").asText());
        assertEquals("browse-stock", after.get("view").get("action").asText());
        assertEquals("expired", f.text("SELECT state FROM custody_holds"));
        assertEquals("expiry", f.text("SELECT release_reason FROM manual_claims"));
        assertEquals(3, f.carVersion("car-1"));
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
    }

    @Test
    void anExpiredHoldOnACarLetsAnotherEmployeeClaimItInTheSameTransaction() throws Exception {
        f.claimOk("e1", "car-1");
        f.clock.now = ClaimFixture.T0.plusSeconds(121);
        ClaimResult r = f.claims.claim(f.scope("e2"), f.claimInput(ClaimFixture.commandId(), "car-1", 2));
        JsonNode view = ClaimFixture.value(r);
        assertEquals("e2", view.get("hold").get("employeeId").asText());
        assertEquals(1, f.holdsOn("car-1"));
        assertEquals("expired", f.text("SELECT state FROM custody_holds WHERE employee_id = 'e1'"));
        assertEquals("expiry", f.text("SELECT release_reason FROM manual_claims WHERE employee_id = 'e1'"));
        assertEquals(4, f.carVersion("car-1"), "claim, expiry, claim");
    }

    @Test
    void anOwnDueHoldNoLongerBlocksTheSameEmployeesNextClaim() throws Exception {
        f.claimOk("e1", "car-1");
        f.clock.now = ClaimFixture.T0.plusSeconds(500);
        ClaimResult r = f.claims.claim(f.scope("e1"), f.claimInput(ClaimFixture.commandId(), "car-2", 1));
        assertEquals("car-2", ClaimFixture.value(r).get("hold").get("orderUuid").asText());
        assertEquals("expired", f.text("SELECT state FROM custody_holds WHERE order_uuid = 'car-1'"));
    }

    @Test
    void expireDueIsBoundedByItsLimitAndARerunIsANoOp() throws Exception {
        for (int i = 1; i <= 3; i++) {
            f.employee("x" + i);
            f.car("cx-" + i);
            f.claimOk("x" + i, "cx-" + i);
        }
        f.clock.now = ClaimFixture.T0.plusSeconds(200);
        assertEquals(2, f.claims.expireDue(f.system(), 2));
        assertEquals(2, f.count("SELECT count(*) FROM custody_holds WHERE state = 'expired'"));
        assertEquals(1, f.count("SELECT count(*) FROM custody_holds WHERE state = 'active'"));
        assertEquals(1, f.claims.expireDue(f.system(), 10));
        long revision = f.revision();
        assertEquals(0, f.claims.expireDue(f.system(), 10));
        assertEquals(revision, f.revision());
        assertEquals(0, f.claims.expireDue(f.system(), 0));
    }

    @Test
    void expiryOfAHoldNotYetDueDoesNothing() throws Exception {
        f.claimOk("e1", "car-1");
        assertEquals(0, f.claims.expireDue(f.system(), 10));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
    }

    // ---- review ----

    @Test
    void reviewMovesThePhaseOnceAndExtendsToNowPlus600AndASecondReviewDoesNotExtend() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        f.clock.now = ClaimFixture.T0.plusSeconds(30);
        JsonNode first = ClaimFixture.value(review(h));
        assertEquals("order-review", first.get("hold").get("phase").asText());
        assertEquals("2026-11-13T09:10:30.000Z", first.get("hold").get("expiresAt").asText());
        assertEquals("submit-or-cancel", first.get("view").get("action").asText());
        assertEquals(h.get("version").asLong() + 1, first.get("hold").get("version").asLong());
        f.clock.now = ClaimFixture.T0.plusSeconds(90);
        JsonNode second = ClaimFixture.value(review(first.get("hold")));
        assertEquals("2026-11-13T09:10:30.000Z", second.get("hold").get("expiresAt").asText());
        assertEquals(first.get("hold").get("version").asLong(), second.get("hold").get("version").asLong());
        assertEquals("order-review", f.text("SELECT phase FROM manual_claims"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE payload->>'state' = 'order-review'"));
    }

    @Test
    void aReviewHoldSurvivesPast120SecondsAndExpiresAt600() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        review(h);
        f.clock.now = ClaimFixture.T0.plusSeconds(599);
        assertEquals("quoted", ClaimFixture.value(f.claims.readClaim(f.scope("e1"))).get("state").asText());
        f.clock.now = ClaimFixture.T0.plusSeconds(600);
        assertEquals("expired", ClaimFixture.value(f.claims.readClaim(f.scope("e1"))).get("state").asText());
    }

    @Test
    void reviewRefusesAChangedContextOrQuoteOrAnExpiredHold() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        f.selection.context.put("e1", "ctx-2");
        assertEquals("context-changed-release-required",
                assertInstanceOf(ClaimResult.Conflict.class, review(h)).code());
        f.selection.context.remove("e1");
        f.selection.terms = ClaimFixture.JSON.createObjectNode().put("points", 11);
        assertEquals("quote-changed-release-required",
                assertInstanceOf(ClaimResult.Conflict.class, review(h)).code());
        f.selection.terms = ClaimFixture.JSON.createObjectNode().put("points", 10);
        f.selection.eligible = false;
        assertEquals("car-no-longer-eligible", assertInstanceOf(ClaimResult.Conflict.class, review(h)).code());
        f.selection.eligible = true;
        f.clock.now = ClaimFixture.T0.plusSeconds(121);
        assertEquals("claim-expired", assertInstanceOf(ClaimResult.Conflict.class, review(h)).code());
        assertEquals("preview", f.text("SELECT phase FROM manual_claims"));
    }

    @Test
    void aQuotePastItsValidityIsQuoteExpiredOnReview() throws Exception {
        f.selection.validUntil = ClaimFixture.T0.plusSeconds(60);
        JsonNode h = f.claimOk("e1", "car-1");
        f.clock.now = ClaimFixture.T0.plusSeconds(61);
        assertEquals("quote-expired", assertInstanceOf(ClaimResult.Conflict.class, review(h)).code());
    }

    // ---- release ----

    @Test
    void releaseWorksForEachReasonAndFreesTheCarAndTheSlot() throws Exception {
        int n = 0;
        for (String reason : new String[] {"cancel", "change", "back"}) {
            n++;
            f.employee("r" + n);
            f.car("cr-" + n);
            JsonNode h = f.claimOk("r" + n, "cr-" + n);
            ClaimResult.Ok ok = assertInstanceOf(ClaimResult.Ok.class, f.claims.release(f.scope("r" + n),
                    ClaimFixture.releaseInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong(), reason)));
            assertEquals("released", ok.value().get("state").asText());
            assertEquals(reason, ok.value().get("hold").get("releaseReason").asText());
            assertEquals("browse-stock", ok.value().get("view").get("action").asText());
            assertEquals(reason, f.text("SELECT release_reason FROM manual_claims WHERE employee_id = ?", "r" + n));
            assertEquals(0, f.holdsOn("cr-" + n));
            assertEquals(3, f.carVersion("cr-" + n));
            assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = ?", "cr-" + n));
            assertInstanceOf(ClaimResult.Ok.class, f.claims.claim(f.scope("r" + n), f.claimInput(ClaimFixture.commandId(), "cr-" + n, 3)));
        }
    }

    @Test
    void anUnknownReasonAStaleHoldVersionAndAReleasedClaimAreRefused() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        String id = h.get("holdId").asText();
        long v = h.get("version").asLong();
        assertEquals("reason", assertInstanceOf(ClaimResult.Invalid.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), id, v, "expiry"))).field());
        ClaimResult.Conflict stale = assertInstanceOf(ClaimResult.Conflict.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), id, v + 5, "cancel")));
        assertEquals("stale-version", stale.code());
        assertEquals("hold", stale.extra().get("resource").asText());
        assertEquals(1, f.holdsOn("car-1"));
        assertInstanceOf(ClaimResult.Ok.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), id, v, "cancel")));
        // The stale-version answer of a released hold is the version check; at the current version it is claim-not-active.
        assertEquals("claim-not-active", assertInstanceOf(ClaimResult.Conflict.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), id, v + 1, "cancel"))).code());
    }

    @Test
    void anotherEmployeesHoldIsForbiddenAndAMissingHoldIsNotFound() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        ClaimResult r = f.claims.release(f.scope("e2"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong(), "cancel"));
        assertInstanceOf(ClaimResult.Forbidden.class, r);
        assertInstanceOf(ClaimResult.Forbidden.class, f.claims.beginReview(f.scope("e2"),
                ClaimFixture.actionInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong())));
        assertInstanceOf(ClaimResult.NotFound.class, f.claims.release(f.scope("e1"),
                ClaimFixture.releaseInput(ClaimFixture.commandId(), "manual-hold:nope", 1, "cancel")));
        assertEquals(1, f.holdsOn("car-1"));
    }

    @Test
    void aReleaseCommandReplaysItsOriginalAnswer() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        var input = ClaimFixture.releaseInput("rel-fixed", h.get("holdId").asText(), h.get("version").asLong(), "cancel");
        ClaimResult.Ok first = assertInstanceOf(ClaimResult.Ok.class, f.claims.release(f.scope("e1"), input));
        ClaimResult.Ok again = assertInstanceOf(ClaimResult.Ok.class, f.claims.release(f.scope("e1"), input.deepCopy()));
        assertTrue(again.replayed());
        assertEquals(gcsp.api.persistence.Canonical.json(first.value()), gcsp.api.persistence.Canonical.json(again.value()));
        assertEquals(3, f.carVersion("car-1"));
    }

    // ---- convertSelection ----

    private SelectionCommit insert(String id, AtomicInteger calls) {
        return tx -> {
            calls.incrementAndGet();
            tx.write("INSERT INTO claims_test_orders (id) VALUES (?)", id);
            return WorkResult.ok(ClaimFixture.JSON.createObjectNode());
        };
    }

    @Test
    void convertSelectionCommitsTheCallbackAndAllocatesHoldAndStockTogether() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        JsonNode reviewed = ClaimFixture.value(review(h)).get("hold");
        AtomicInteger calls = new AtomicInteger();
        ClaimResult.Ok ok = assertInstanceOf(ClaimResult.Ok.class, f.claims.convertSelection(f.scope("e1"),
                ClaimFixture.actionInput(ClaimFixture.commandId(), reviewed.get("holdId").asText(), reviewed.get("version").asLong()),
                insert("order-1", calls)));
        assertEquals("allocated", ok.value().get("state").asText());
        assertEquals("continue-order-handoff", ok.value().get("view").get("action").asText());
        assertEquals(1, calls.get());
        assertEquals(1, f.count("SELECT count(*) FROM claims_test_orders"));
        assertEquals("allocated", f.text("SELECT state FROM custody_holds"));
        assertEquals("allocated", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(3, f.carVersion("car-1"));
        assertEquals(0, f.holdsOn("car-1"));
    }

    @Test
    void aRefusingCallbackRollsEverythingBackAndAnExceptionToo() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        JsonNode reviewed = ClaimFixture.value(review(h)).get("hold");
        var input = ClaimFixture.actionInput(ClaimFixture.commandId(), reviewed.get("holdId").asText(), reviewed.get("version").asLong());
        ClaimResult r = f.claims.convertSelection(f.scope("e1"), input, tx -> {
            tx.write("INSERT INTO claims_test_orders (id) VALUES ('order-x')");
            return WorkResult.refuse("order-refused", "Ordering said no.");
        });
        assertEquals("order-refused", assertInstanceOf(ClaimResult.Conflict.class, r).code());
        assertEquals(0, f.count("SELECT count(*) FROM claims_test_orders"));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
        assertEquals("quoted", ClaimFixture.value(f.claims.readClaim(f.scope("e1"))).get("state").asText());
        assertEquals("released", f.text("SELECT state FROM stock_cars WHERE order_uuid = 'car-1'"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts WHERE command_type = 'manual-claim.allocate'"));
        try {
            f.claims.convertSelection(f.scope("e1"), input, tx -> {
                tx.write("INSERT INTO claims_test_orders (id) VALUES ('order-y')");
                throw new IllegalStateException("boom");
            });
        } catch (IllegalStateException expected) {
            assertEquals("boom", expected.getMessage());
        }
        assertEquals(0, f.count("SELECT count(*) FROM claims_test_orders"));
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
    }

    @Test
    void aPreviewPhaseClaimRefusesWithOrderReviewRequiredAndNeverCallsBack() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        AtomicInteger calls = new AtomicInteger();
        ClaimResult r = f.claims.convertSelection(f.scope("e1"),
                ClaimFixture.actionInput(ClaimFixture.commandId(), h.get("holdId").asText(), h.get("version").asLong()),
                insert("order-1", calls));
        assertEquals("order-review-required", assertInstanceOf(ClaimResult.Conflict.class, r).code());
        assertEquals(0, calls.get());
        assertEquals("active", f.text("SELECT state FROM custody_holds"));
    }

    @Test
    void convertSelectionRevalidatesAndRefusesAnotherEmployeeAndAMissingCallback() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        JsonNode reviewed = ClaimFixture.value(review(h)).get("hold");
        var input = ClaimFixture.actionInput(ClaimFixture.commandId(), reviewed.get("holdId").asText(), reviewed.get("version").asLong());
        AtomicInteger calls = new AtomicInteger();
        f.selection.terms = ClaimFixture.JSON.createObjectNode().put("points", 99);
        assertEquals("quote-changed-release-required",
                assertInstanceOf(ClaimResult.Conflict.class, f.claims.convertSelection(f.scope("e1"), input, insert("o", calls))).code());
        f.selection.terms = ClaimFixture.JSON.createObjectNode().put("points", 10);
        assertInstanceOf(ClaimResult.Forbidden.class, f.claims.convertSelection(f.scope("e2"), input, insert("o", calls)));
        assertInstanceOf(ClaimResult.Unavailable.class, f.claims.convertSelection(f.scope("e1"), input, null));
        assertEquals(0, calls.get());
    }

    // ---- ordering seams and reads ----

    @Test
    void claimForOrderingAndOwnsActiveClaimReportTheOwnersLiveHoldOnly() throws Exception {
        JsonNode h = f.claimOk("e1", "car-1");
        String id = h.get("holdId").asText();
        ClaimView v = f.claims.claimForOrdering(f.scope("e1"), id);
        assertEquals("car-1", v.orderUuid());
        assertEquals("preview", v.phase());
        assertEquals("local", v.mode());
        assertNull(f.claims.claimForOrdering(f.scope("e2"), id));
        assertNull(f.claims.claimForOrdering(f.scope("e1"), "manual-hold:nope"));
        assertTrue(owns("e1", id, h.get("version").asLong()));
        assertFalse(owns("e2", id, h.get("version").asLong()));
        assertFalse(owns("e1", id, h.get("version").asLong() + 1));
        f.clock.now = ClaimFixture.T0.plusSeconds(120);
        assertFalse(owns("e1", id, h.get("version").asLong()), "an overdue hold is not an active claim");
    }

    private boolean owns(String employee, String holdId, long version) throws Exception {
        gcsp.api.persistence.Outcome o = new gcsp.api.persistence.TransactionRunner(f.pool()).execute(
                f.scope(employee).context(), new gcsp.api.persistence.Command("test.owns", ClaimFixture.commandId(),
                        ClaimFixture.JSON.createObjectNode().put("x", 1)),
                tx -> WorkResult.ok(ClaimFixture.JSON.createObjectNode().put("owns",
                        f.claims.ownsActiveClaim(tx, employee, holdId, version))));
        return ((gcsp.api.persistence.Outcome.Committed) o).result().get("owns").asBoolean();
    }

    @Test
    void readClaimWithNoClaimIsNotFoundWithTheNoClaimView() throws Exception {
        ClaimResult.NotFound nf = assertInstanceOf(ClaimResult.NotFound.class, f.claims.readClaim(f.scope("e1")));
        assertEquals("no-claim", nf.view().get("state").asText());
        assertEquals("browse-stock", nf.view().get("action").asText());
    }

    @Test
    void readClaimShowsTheLatestClaimAndNotAnotherEmployeesOnes() throws Exception {
        f.claimOk("e2", "car-2");
        JsonNode h = f.claimOk("e1", "car-1");
        JsonNode v = ClaimFixture.value(f.claims.readClaim(f.scope("e1")));
        assertEquals(h.get("holdId"), v.get("hold").get("holdId"));
        assertFalse(v.get("view").get("editable").asBoolean());
        assertEquals("employee", v.get("view").get("supportOwner").asText());
    }

    // ---- unavailable ----

    @Test
    void anUnconfiguredSelectionIsUnavailableAndWritesNothing() throws Exception {
        ManualClaims bare = new ManualClaims(f.pool(), f.clock, f.timing, new UnconfiguredManualSelection(), new NoOfferLookup());
        ClaimResult.Unavailable u = assertInstanceOf(ClaimResult.Unavailable.class, bare.claim(f.scope("e1"), f.claimInput("car-1")));
        assertEquals("manual-selection-not-configured", u.code());
        assertFalse(u.retryable());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
        assertEquals(1, f.carVersion("car-1"));
    }

    @Test
    void missingOrInvalidPolicyTimingIsUnavailableAndWritesNothing() throws Exception {
        f.timing = (scope, now) -> new ClaimTimingPort.Unavailable(PolicyClaimTiming.UNAVAILABLE);
        ClaimResult.Unavailable u = assertInstanceOf(ClaimResult.Unavailable.class, f.claims.claim(f.scope("e1"), f.claimInput("car-1")));
        assertEquals("claim-timing-unavailable", u.code());
        assertEquals(0, f.count("SELECT count(*) FROM custody_holds"));
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
        assertEquals(1, f.carVersion("car-1"));
    }

    @Test
    void timingFromThePolicyServiceReadsTheSeedAndRefusesAMissingVersionAndKey() throws Exception {
        var policy = new gcsp.api.policy.PolicyService(new gcsp.api.policy.RetainedFilePolicySource());
        var adapter = new PolicyClaimTiming(policy);
        var ok = assertInstanceOf(ClaimTimingPort.Known.class, adapter.timing(f.scope("e1"), Instant.parse("2026-11-13T09:00:00Z")));
        assertEquals(120, ok.previewSeconds());
        assertEquals(600, ok.reviewSeconds());
        assertEquals(3, ok.assumptions().size());
        var other = new ClaimScope(ClaimFixture.ENV, ClaimFixture.RUN, "a", "e1", "no-such-version");
        assertInstanceOf(ClaimTimingPort.Unavailable.class, adapter.timing(other, Instant.parse("2026-11-13T09:00:00Z")));
        var blank = new ClaimScope(ClaimFixture.ENV, "", "a", "e1", "gcsp-policy-v1");
        assertInstanceOf(ClaimTimingPort.Unavailable.class, adapter.timing(blank, Instant.parse("2026-11-13T09:00:00Z")));
    }
}
