package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The review-details service over Paula's real claim (real selection, draft, stock and policy rows). */
class ManualReviewDetailsDbTest {

    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final Instant NOW = Instant.parse("2026-11-05T09:00:00Z");

    StockDbFixture fx;
    ManualClaims claims;
    ManualReviewDetails review;
    TransactionRunner runner;
    ClaimScope scope;
    volatile Instant now = NOW;
    JsonNode hold;

    @BeforeEach
    void setUp() throws Exception {
        fx = StockDbFixture.create();
        ManualSelection selection = new ManualSelection(() -> Optional.of(fx.stock()), () -> {
            try {
                return fx.pool();
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException(e);
            }
        });
        ClaimClock clock = (RunContext c) -> now;
        ClaimTimingPort timing = (s, n) -> new ClaimTimingPort.Known(120, 600, ClaimFixture.JSON.createArrayNode());
        runner = new TransactionRunner(fx.pool());
        claims = new ManualClaims(fx.pool(), runner, clock, timing, selection, (tx, id) -> Optional.empty());
        review = new ManualReviewDetails(fx.pool(), runner, clock, claims, new PolicyService(new RetainedFilePolicySource()));
        scope = new ClaimScope(fx.environmentId(), fx.runId(), "sub-paula", fx.employeeId(), fx.policyVersion());
        fx.saveDraft("d-1", 0, StockDbFixture.complete());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (fx != null) fx.close();
    }

    /** Claims car 1 and starts the order review, the state a details screen opens in. */
    private void review() {
        var read = new ManualStockRead(claims, fx.stock(), fxPool());
        JsonNode input = null;
        for (JsonNode d : read.read(scope, fx.identity()).value().get("decisions")) {
            if (d.get("orderUuid").asText().equals(U + "1")) input = d.get("claimInput");
        }
        ObjectNode body = ClaimFixture.JSON.createObjectNode().put("commandId", "claim-1");
        body.setAll((ObjectNode) input);
        JsonNode held = ClaimFixture.value(claims.claim(scope, body)).get("hold");
        hold = ClaimFixture.value(claims.beginReview(scope, ClaimFixture.actionInput("review-1", held.get("holdId").asText(),
                held.get("version").asLong()))).get("hold");
    }

    private javax.sql.DataSource fxPool() {
        try {
            return fx.pool();
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private ObjectNode save(String commandId, long expectedVersion, String requirements) {
        ObjectNode in = ReviewValidationTest.command();
        in.put("commandId", commandId).put("holdId", hold.get("holdId").asText())
                .put("quoteId", ManualClaims.quoteId(hold.get("holdId").asText()))
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1)
                .put("expectedReviewDetailsVersion", expectedVersion);
        ((ObjectNode) in.get("details")).put("specialRequirements", requirements);
        return in;
    }

    private static JsonNode body(ReviewResult r) {
        return ((ReviewResult.Body) r).body();
    }

    private JsonNode ok(ReviewResult r) {
        assertEquals("ok", r.status(), String.valueOf(r instanceof ReviewResult.Body b ? b.body() : r));
        return body(r).get("value");
    }

    private Frozen freezeIt(ManualReviewDetails.Binding b, long version) {
        AtomicReference<ReviewResult> out = new AtomicReference<>();
        Outcome o = runner.execute(scope.context(), new Command("test.freeze", "freeze-" + System.nanoTime(),
                ClaimFixture.JSON.createObjectNode().put("n", System.nanoTime())), tx -> {
                    ReviewResult r = review.freeze(tx, b, version);
                    out.set(r);
                    return r.isOk() ? WorkResult.ok(r.value()) : WorkResult.refuse("refused", "refused");
                });
        return new Frozen(out.get(), o);
    }

    private record Frozen(ReviewResult result, Outcome outcome) {}

    private ManualReviewDetails.Binding binding(long holdVersion) {
        String id = hold.get("holdId").asText();
        return new ManualReviewDetails.Binding(fx.runId(), fx.employeeId(), "slot-paula", id, ManualClaims.quoteId(id),
                holdVersion, 1);
    }

    @Test
    void withoutAClaimTheReadPassesTheNoClaimAnswerThrough() {
        ReviewResult r = review.read(scope);
        ReviewResult.Claim c = assertInstanceOf(ReviewResult.Claim.class, r);
        assertEquals("not-found", c.status());
    }

    @Test
    void theInitialReadIsTheDraftsDetailsWithPolicyLimits() {
        review();
        JsonNode v = ok(review.read(scope));
        assertEquals(0, v.get("reviewDetailsVersion").asInt());
        assertEquals("01632 960000", v.get("details").get("contact").get("phone").asText());
        assertEquals(20000, v.get("details").get("expectedReturnMileage").asInt());
        assertEquals("", v.get("details").get("specialRequirements").asText());
        assertEquals(500, v.get("constraints").get("maximumSpecialRequirements").asInt());
        assertEquals(500000, v.get("constraints").get("maximumReturnMileage").asInt());
        assertEquals("mi", v.get("constraints").get("mileageUnit").asText());
        assertEquals("UTF-16 code units", v.get("constraints").get("textLengthUnit").asText());
        assertEquals("manual.context.v1", v.get("constraints").get("provenance").get("key").asText());
        assertEquals("replacement", v.get("mode").asText());
        assertEquals("2026-11-12", v.get("requestedCollection").get("date").asText());
        assertEquals("demo-collection-centre", v.get("requestedCollection").get("locationId").asText());
        assertEquals("current:employee-paula", v.get("oldContractId").asText());
        assertEquals("twelve-month-12000", v.get("contract").get("contractOptionId").asText());
        assertTrue(v.get("orderNumber").asText().matches("[0-9]{7}"));
        assertEquals(1, v.get("stockVersion").asInt() - 1, "the claim bumped the car's version once");
        assertEquals("2026-11-05T09:00:00.000Z", v.get("now").asText());
        assertEquals("1", v.get("clockVersion").asText());
        assertFalse(v.get("frozen").asBoolean());
        assertTrue(v.get("editable").asBoolean());
        assertTrue(v.get("canContinue").asBoolean());
        assertEquals("review", v.get("view").get("state").asText());
        assertEquals("save-review-details", v.get("view").get("action").asText());
        JsonNode b = v.get("binding");
        assertEquals(hold.get("holdId").asText(), b.get("holdId").asText());
        assertEquals(ManualClaims.quoteId(hold.get("holdId").asText()), b.get("quoteId").asText());
        assertEquals(hold.get("version").asLong(), b.get("expectedHoldVersion").asLong());
        assertEquals(1, b.get("expectedDraftVersion").asInt());
        assertEquals(v.get("quote").get("quoteId"), b.get("quoteId"));
        assertEquals(hold.get("holdId"), v.get("hold").get("holdId"));
    }

    @Test
    void aSaveWritesVersionOneAndTheReadReturnsItsDetails() throws Exception {
        review();
        JsonNode v = ok(review.save(scope, save("save-1", 0, "Call first")));
        assertEquals(1, v.get("reviewDetailsVersion").asInt());
        assertEquals("Call first", v.get("details").get("specialRequirements").asText());
        assertEquals("review", v.get("view").get("state").asText());
        JsonNode read = ok(review.read(scope));
        assertEquals(1, read.get("reviewDetailsVersion").asInt());
        assertEquals("Call first", read.get("details").get("specialRequirements").asText());
        assertEquals(1, count("SELECT count(*) FROM manual_review_details"));
        JsonNode next = ok(review.save(scope, save("save-2", 1, "Call after five")));
        assertEquals(2, next.get("reviewDetailsVersion").asInt());
        assertEquals(2, count("SELECT count(*) FROM manual_review_details"));
    }

    @Test
    void theSameCommandIsReplayedAndADifferentInputIsAConflict() throws Exception {
        review();
        JsonNode first = ok(review.save(scope, save("save-1", 0, "Call first")));
        JsonNode again = ok(review.save(scope, save("save-1", 0, "Call first")));
        assertEquals(first, again);
        assertEquals(1, count("SELECT count(*) FROM manual_review_details"));
        ReviewResult changed = review.save(scope, save("save-1", 0, "Something else"));
        assertEquals("conflict", changed.status());
        assertEquals("idempotency-input-changed", changed.code());
        // A replay answers from its receipt even once the hold has moved on.
        ok(review.save(scope, save("save-2", 1, "Next")));
        assertEquals(first, ok(review.save(scope, save("save-1", 0, "Call first"))));
    }

    @Test
    void aStaleReviewDetailsVersionIsRefusedWithBothVersions() {
        review();
        ok(review.save(scope, save("save-1", 0, "One")));
        ReviewResult stale = review.save(scope, save("save-2", 0, "Two"));
        assertEquals("stale-version", stale.status());
        assertEquals("stale-review-details", stale.code());
        assertEquals("review-details", body(stale).get("resource").asText());
        assertEquals(0, body(stale).get("expectedVersion").asInt());
        assertEquals(1, body(stale).get("currentVersion").asInt());
    }

    @Test
    void invalidDetailsAndWrongBindingsAreRefusedWithoutAWrite() throws Exception {
        review();
        ObjectNode bad = save("save-1", 0, "x".repeat(501));
        ReviewResult invalid = review.save(scope, bad);
        assertEquals("invalid", invalid.status());
        assertEquals("specialRequirements", body(invalid).get("reasons").get(0).get("field").asText());
        ObjectNode other = save("save-2", 0, "ok");
        other.put("holdId", "manual-hold:other");
        assertEquals("claim-binding-changed", review.save(scope, other).code());
        ObjectNode quote = save("save-3", 0, "ok");
        quote.put("quoteId", "manual-quote:other");
        assertEquals("quote-binding-changed", review.save(scope, quote).code());
        ObjectNode holdVersion = save("save-4", 0, "ok");
        holdVersion.put("expectedHoldVersion", hold.get("version").asLong() + 5);
        ReviewResult staleHold = review.save(scope, holdVersion);
        assertEquals("stale-version", staleHold.status());
        assertEquals("hold", body(staleHold).get("resource").asText());
        ObjectNode draft = save("save-5", 0, "ok");
        draft.put("expectedDraftVersion", 4);
        assertEquals("manual-draft", body(review.save(scope, draft)).get("resource").asText());
        assertEquals(0, count("SELECT count(*) FROM manual_review_details"));
    }

    @Test
    void anExpiredClaimIsNotActiveToSaveAndTheReadShowsItExpired() {
        review();
        now = NOW.plusSeconds(3600);
        // The save's own claim read settles the due hold first, so the old hold version is stale.
        ReviewResult stale = review.save(scope, save("save-1", 0, "Late"));
        assertEquals("stale-version", stale.status());
        assertEquals("hold", body(stale).get("resource").asText());
        JsonNode v = ok(review.read(scope));
        assertEquals("expired", v.get("view").get("state").asText());
        assertFalse(v.get("editable").asBoolean());
        assertEquals("refresh-claim", v.get("view").get("action").asText());
        hold = v.get("hold");
        ReviewResult refused = review.save(scope, save("save-2", 0, "Late"));
        assertEquals("conflict", refused.status());
        assertEquals("claim-not-active", refused.code());
    }

    @Test
    void anAllocationInFlightLocksTheDetails() throws Exception {
        review();
        String holdId = hold.get("holdId").asText();
        fx.update("INSERT INTO pending_operations (environment_id, run_id, operation_id, operation_type, idempotency_key, "
                + "input_digest, state) VALUES (?, ?, 'op-1', 'manual-allocate', 'k-1', ?, 'pending')", fx.environmentId(),
                fx.runId(), "a".repeat(64));
        fx.update("INSERT INTO manual_claim_operations (environment_id, run_id, operation_id, operation_type, hold_id, "
                + "target_state, payload) VALUES (?, ?, 'op-1', 'manual-allocate', ?, 'allocated', '{}'::jsonb)",
                fx.environmentId(), fx.runId(), holdId);
        JsonNode v = ok(review.read(scope));
        assertEquals("pending", v.get("view").get("state").asText());
        assertFalse(v.get("editable").asBoolean());
        assertEquals("check-status", v.get("view").get("action").asText());
        assertEquals("review-details-locked", review.save(scope, save("save-1", 0, "No")).code());
    }

    @Test
    void freezeNeedsASavedVersionAndIsIdempotent() {
        review();
        ManualReviewDetails.Binding b = binding(hold.get("version").asLong());
        assertEquals("review-details-not-saved", freezeIt(b, 0).result().code());
        ok(review.save(scope, save("save-1", 0, "Pinned")));
        ReviewResult stale = freezeIt(b, 0).result();
        assertEquals("stale-version", stale.status());
        assertEquals(1, body(stale).get("currentVersion").asInt());
        Frozen first = freezeIt(b, 1);
        JsonNode frozen = ok(first.result());
        assertInstanceOf(Outcome.Committed.class, first.outcome());
        assertEquals(1, frozen.get("reviewDetailsVersion").asInt());
        assertEquals("2026-11-05T09:00:00.000Z", frozen.get("frozenAt").asText());
        assertEquals("1", frozen.get("frozenClockVersion").asText());
        assertEquals("Pinned", frozen.get("details").get("specialRequirements").asText());
        JsonNode again = ok(freezeIt(b, 1).result());
        assertEquals(frozen, again);
        assertEquals(1, rows("manual_review_freezes"));
    }

    private long count(String sql) throws Exception {
        try (var c = fx.pool().getConnection(); var st = c.createStatement(); var rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private long rows(String table) {
        try {
            return count("SELECT count(*) FROM " + table);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void afterAFreezeTheReadIsLockedAndASaveIsRefused() {
        review();
        ok(review.save(scope, save("save-1", 0, "Pinned")));
        ok(freezeIt(binding(hold.get("version").asLong()), 1).result());
        JsonNode v = ok(review.read(scope));
        assertTrue(v.get("frozen").asBoolean());
        assertFalse(v.get("editable").asBoolean());
        assertFalse(v.get("canContinue").asBoolean());
        assertEquals("locked", v.get("view").get("state").asText());
        assertEquals("check-status", v.get("view").get("action").asText());
        ReviewResult refused = review.save(scope, save("save-2", 1, "Changed"));
        assertEquals("conflict", refused.status());
        assertEquals("review-details-locked", refused.code());
        assertEquals(1, rows("manual_review_details"));
    }

    @Test
    void freezeRefusesAnExpiredClaimABadBindingAndAnotherBinding() {
        review();
        ok(review.save(scope, save("save-1", 0, "Pinned")));
        ManualReviewDetails.Binding good = binding(hold.get("version").asLong());
        assertEquals("invalid", freezeIt(new ManualReviewDetails.Binding(fx.runId(), fx.employeeId(), "", good.holdId(),
                good.quoteId(), 1, 1), 1).result().status());
        assertEquals("stale-version", freezeIt(binding(hold.get("version").asLong() + 3), 1).result().status());
        assertEquals("quote-binding-changed", freezeIt(new ManualReviewDetails.Binding(fx.runId(), fx.employeeId(), "slot-paula",
                good.holdId(), "manual-quote:other", good.expectedHoldVersion(), 1), 1).result().code());
        assertEquals("forbidden", freezeIt(new ManualReviewDetails.Binding(fx.runId(), fx.employeeId(), "slot-jordan",
                good.holdId(), good.quoteId(), good.expectedHoldVersion(), 1), 1).result().status());
        now = NOW.plusSeconds(3600);
        assertEquals("claim-expired", freezeIt(good, 1).result().code());
        assertEquals(0, rows("manual_review_freezes"));
    }

    @Test
    void theClockVersionComesFromTheRunClockRow() throws Exception {
        review();
        fx.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, ?, ?::timestamptz, 7, 's1', 'f1', ?::timestamptz, '{}'::jsonb)",
                fx.environmentId(), fx.runId(), NOW.toString(), NOW.toString());
        assertEquals("7", ok(review.read(scope)).get("clockVersion").asText());
        assertEquals("7", ok(review.save(scope, save("save-1", 0, "Clock"))).get("clockVersion").asText());
        assertNotEquals("1", ok(review.read(scope)).get("clockVersion").asText());
    }

    @Test
    void versionsAreImmutableAndAFreezeIsOnePerHold() throws Exception {
        review();
        ok(review.save(scope, save("save-1", 0, "One")));
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                () -> fx.update("UPDATE manual_review_details SET command_id = 'x'"));
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                () -> fx.update("DELETE FROM manual_review_details"));
        ok(freezeIt(binding(hold.get("version").asLong()), 1).result());
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                () -> fx.update("DELETE FROM manual_review_freezes"));
    }
}
