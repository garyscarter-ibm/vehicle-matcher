package gcsp.api.claims;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The real selection port and the claims stock read over Paula's seeded stock, claim to review with real digests and facts. */
class ManualSelectionDbTest {

    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final Instant NOW = Instant.parse("2026-11-05T09:00:00Z");

    StockDbFixture fx;
    ManualSelection selection;
    ManualClaims claims;
    ManualStockRead read;
    ClaimScope scope;

    @BeforeEach
    void setUp() throws Exception {
        fx = StockDbFixture.create();
        selection = new ManualSelection(() -> Optional.of(fx.stock()), () -> {
            try {
                return fx.pool();
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException(e);
            }
        });
        ClaimClock clock = (RunContext c) -> NOW;
        ClaimTimingPort timing = (s, n) -> new ClaimTimingPort.Known(120, 600, ClaimFixture.JSON.createArrayNode());
        claims = new ManualClaims(fx.pool(), clock, timing, selection, (tx, id) -> Optional.empty());
        read = new ManualStockRead(claims, fx.stock(), fx.pool());
        scope = new ClaimScope(fx.environmentId(), fx.runId(), "sub-paula", fx.employeeId(), fx.policyVersion());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (fx != null) fx.close();
    }

    private JsonNode stock() {
        AccountOutcome out = read.read(scope, fx.identity());
        assertTrue(out.isOk(), String.valueOf(out.refusal()));
        return out.value();
    }

    private static JsonNode decision(JsonNode value, String digit) {
        for (JsonNode d : value.get("decisions")) if (d.get("orderUuid").asText().equals(U + digit)) return d;
        throw new AssertionError("no decision " + digit);
    }

    private static List<String> ids(JsonNode rows) {
        List<String> out = new java.util.ArrayList<>();
        rows.forEach(r -> out.add(r.get("orderUuid").asText()));
        return out;
    }

    private static ObjectNode claimBody(String commandId, JsonNode input) {
        ObjectNode n = ClaimFixture.JSON.createObjectNode().put("commandId", commandId);
        n.setAll((ObjectNode) input);
        return n;
    }

    private static ObjectNode action(String commandId, JsonNode hold, long draft) {
        return ClaimFixture.JSON.createObjectNode().put("commandId", commandId).put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", draft);
    }

    @Test
    void withoutAUsableDraftThereIsNoClaimantAndNoOrderDraft() {
        assertEquals("draft-review-required", assertInstanceOf(ManualSelectionPort.NoClaimant.class, selection.claimant(scope)).code());
        assertEquals("draft-review-required", assertInstanceOf(ManualSelectionPort.NoDecision.class, selection.orderDraft(scope)).code());
        fx.saveDraft("c-1", 0, StockDbFixture.intent());
        assertInstanceOf(ManualSelectionPort.NoClaimant.class, selection.claimant(scope));
        assertInstanceOf(ManualSelectionPort.NoDecision.class, selection.orderDraft(scope));
        assertInstanceOf(ManualSelectionPort.NoDecision.class, selection.decide(scope, U + "1"));
    }

    @Test
    void theCompleteDraftIsTheClaimantAndOrdersTheDriverAndContact() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        ManualSelectionPort.Known who = assertInstanceOf(ManualSelectionPort.Known.class, selection.claimant(scope));
        assertEquals("slot-paula", who.slotId());
        assertEquals(1, who.draftVersion());
        assertEquals("driver:employee-paula", who.driverId());
        assertEquals(fx.contextVersion(), who.contextVersion());
        assertEquals(fx.policyVersion(), who.policyVersion());
        ManualSelectionPort.Draft draft = assertInstanceOf(ManualSelectionPort.Draft.class, selection.orderDraft(scope));
        assertEquals("replacement", draft.mode());
        assertEquals("driver:employee-paula", draft.driver().get("driverId").asText());
        assertEquals("01632 960000", draft.contact().get("phone").asText());
        assertEquals("employee-paula", draft.employee().get("employeeId").asText());
    }

    @Test
    void decideIsEligibleForAnEligibleCarAndCarriesTheRecordedFacts() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        ManualSelectionPort.Eligible e = assertInstanceOf(ManualSelectionPort.Eligible.class, selection.decide(scope, U + "1"));
        assertEquals("RzIxOlMx", e.configurationId());
        assertEquals(List.of("facts"), List.copyOf(iterate(e.facts())));
        assertEquals("exact-stock", e.facts().get("facts").get("identityKind").asText());
        assertEquals("employee-scheme", e.terms().get("kind").asText());
        assertFalse(e.terms().has("termsVersion"));
        assertFalse(e.terms().has("validUntil"));
        assertTrue(e.validUntil().isAfter(NOW));
        assertEquals("ineligible", assertInstanceOf(ManualSelectionPort.NotEligible.class, selection.decide(scope, U + "2")).reason());
        assertEquals("ineligible", assertInstanceOf(ManualSelectionPort.NotEligible.class, selection.decide(scope, U + "7")).reason());
        assertEquals("needs-confirmation", assertInstanceOf(ManualSelectionPort.NotEligible.class, selection.decide(scope, U + "8")).reason());
        assertEquals("not-in-stock", assertInstanceOf(ManualSelectionPort.NotEligible.class, selection.decide(scope, U + "4")).reason());
    }

    private static java.util.Set<String> iterate(JsonNode n) {
        java.util.Set<String> out = new java.util.TreeSet<>();
        n.fieldNames().forEachRemaining(out::add);
        return out;
    }

    @Test
    void theClaimsStockReadAddsClaimInputToEligibleCarsOnly() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        JsonNode v = stock();
        assertEquals(List.of(U + "1", U + "3", U + "6"), ids(v.get("cars")), "no hold is seeded on car 3 here");
        JsonNode input = decision(v, "1").get("claimInput");
        assertEquals(U + "1", input.get("orderUuid").asText());
        assertEquals(1, input.get("expectedStockVersion").asLong());
        assertEquals(1, input.get("expectedDraftVersion").asLong());
        assertEquals(fx.contextVersion(), input.get("expectedContextVersion").asText());
        assertEquals(64, input.get("expectedTermsDigest").asText().length());
        assertTrue(decision(v, "2").get("claimInput").isNull());
        assertTrue(decision(v, "8").get("claimInput").isNull());
        assertTrue(v.get("heldOffer").isNull());
        assertEquals(v.get("cars").get(0), decision(v, "1"));
    }

    @Test
    void theDigestAndFactsSurviveBrowseToClaimToReview() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        JsonNode input = decision(stock(), "1").get("claimInput");
        ClaimResult claimed = claims.claim(scope, claimBody("claim-1", input));
        JsonNode hold = ClaimFixture.value(claimed).get("hold");
        assertEquals("active", hold.get("state").asText());
        assertEquals(input.get("expectedTermsDigest").asText(), ClaimFixture.value(claimed).get("quote").get("termsDigest").asText());
        assertEquals("exact-stock", ClaimFixture.value(claimed).get("quote").get("facts").get("facts").get("identityKind").asText());

        ClaimResult review = claims.beginReview(scope, action("review-1", hold, 1));
        assertEquals("order-review", ClaimFixture.value(review).get("hold").get("phase").asText());
        ClaimResult again = claims.beginReview(scope, action("review-2", ClaimFixture.value(review).get("hold"), 1));
        assertEquals("order-review", ClaimFixture.value(again).get("hold").get("phase").asText());
    }

    @Test
    void aStaleTermsDigestIsRefusedWithTheRealDigest() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        ObjectNode body = claimBody("claim-2", decision(stock(), "1").get("claimInput"));
        body.put("expectedTermsDigest", "0".repeat(64));
        ClaimResult r = claims.claim(scope, body);
        ClaimResult.Conflict c = assertInstanceOf(ClaimResult.Conflict.class, r);
        assertEquals("stale-version", c.code());
        assertEquals("manual-terms", c.extra().get("resource").asText());
    }

    @Test
    void anIneligibleCarCannotBeClaimedAndAHeldCarKeepsItsClaimantsReview() {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        JsonNode first = decision(stock(), "1").get("claimInput");
        ObjectNode ineligible = claimBody("claim-3", first);
        ineligible.put("orderUuid", U + "2");
        assertEquals("car-not-eligible-or-available", assertInstanceOf(ClaimResult.Conflict.class, claims.claim(scope, ineligible)).code());

        JsonNode hold = ClaimFixture.value(claims.claim(scope, claimBody("claim-4", first))).get("hold");
        // The held car is occupied for everyone, yet stays eligible for its own claimant to review.
        ManualSelectionPort.Eligible own = assertInstanceOf(ManualSelectionPort.Eligible.class, selection.decide(scope, U + "1"));
        assertEquals("employee-scheme", own.terms().get("kind").asText());
        JsonNode after = stock();
        assertEquals("ineligible", decision(after, "1").get("gateStatus").asText(), "the plain browse sees it taken");
        ClaimResult review = claims.beginReview(scope, action("review-3", hold, 1));
        assertEquals("order-review", ClaimFixture.value(review).get("hold").get("phase").asText());
    }

    @Test
    void aBuddyHoldIsReportedAsTheHeldOffer() throws Exception {
        fx.saveDraft("c-1", 0, StockDbFixture.complete());
        fx.hold("h-buddy", U + "6", fx.employeeId(), "slot-paula", "buddy-offer");
        JsonNode offer = stock().get("heldOffer");
        assertEquals(fx.runId(), offer.get("runId").asText());
        assertTrue(offer.get("offerId").isNull());
        fx.update("UPDATE custody_holds SET attributes = '{\"offerId\":\"offer-9\"}'::jsonb WHERE hold_id = 'h-buddy'");
        assertEquals("offer-9", stock().get("heldOffer").get("offerId").asText());
    }

    @Test
    void theStockReadPassesBrowseRefusalsThrough() {
        AccountOutcome none = read.read(scope, fx.identity());
        assertEquals("not-found", none.status());
        assertEquals("manual-draft", none.refusal().get("resourceType").asText());
    }
}
