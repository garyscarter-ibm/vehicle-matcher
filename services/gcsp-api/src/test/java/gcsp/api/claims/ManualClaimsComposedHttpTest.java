package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.ClaimCompositionSeed;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Manual claims through the started app in its documented dev composition: real JWTs, native PostgreSQL and the
 * real selection, timing, stock and cart-ordering beans. Only the time source under them is replaced.
 */
@QuarkusTest
@TestProfile(ClaimCompositionProfile.class)
class ManualClaimsComposedHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String BASE = "/api/gcsp/v1/manual/";
    private static final String U = StockDbFixture.UUID_PREFIX;
    private static final String ENV = ClaimCompositionSeed.ENV;
    private static final String RUN = ClaimCompositionSeed.RUN;
    private static final Instant T0 = Instant.parse(ClaimCompositionSeed.ACCOUNT_NOW);
    private static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";
    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ClaimSweep sweep;

    private Clock clock;

    /** The only replaced bean: the claim-clock port used by claims and ordering, pinned to the account fixture's instant. */
    static final class Clock implements ClaimClock {
        volatile Instant now = T0;

        @Override
        public Instant now(RunContext context) {
            return now;
        }
    }

    record Resp(int status, JsonNode body) {
        String code() {
            return body.path("code").asText();
        }

        JsonNode value() {
            return body.path("value");
        }

        JsonNode hold() {
            return body.path("value").path("hold");
        }
    }

    @BeforeEach
    void seed() throws Exception {
        ownedSchema = schema;
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        clock = new Clock();
        QuarkusMock.installMockForType(clock, ClaimClock.class);
        clean();
        try (Connection c = dataSource.get().getConnection()) {
            StockDbFixture.insertStock(c, ENV, RUN, StockDbFixture.rows());
        }
        saveDraft("sub-paula", "paula");
        saveDraft("sub-jordan", "jordan");
    }

    @AfterAll
    static void dropSchema() throws Exception {
        ClaimCompositionSeed.dropSchema(ownedSchema);
    }

    // ---- AC1: exact car, employee and slot ----

    @Test
    void twoEmployeesRacingForOneCarGiveExactlyOneWinnerAndOneHold() throws Exception {
        Map<String, Integer> loserCodes = new TreeMap<>();
        for (int i = 0; i < 10; i++) {
            String car = U + (i % 2 == 0 ? "1" : "3");
            ObjectNode paula = claimInput("sub-paula", car, cid("race-p"));
            ObjectNode jordan = claimInput("sub-jordan", car, cid("race-j"));
            String pTok = token("sub-paula");
            String jTok = token("sub-jordan");
            List<Resp> r = race(() -> post(pTok, "claim", paula), () -> post(jTok, "claim", jordan));
            int winner = r.get(0).status() == 200 ? 0 : 1;
            Resp won = r.get(winner);
            Resp lost = r.get(1 - winner);
            assertEquals(200, won.status(), "iteration " + i + ": " + r);
            assertEquals("ok", won.body().get("status").asText());
            assertEquals(409, lost.status(), "iteration " + i + ": " + lost);
            assertEquals("conflict", lost.body().get("status").asText());
            assertTrue(List.of("car-held", "car-not-eligible-or-available", "stale-version").contains(lost.code()), lost.code());
            loserCodes.merge(lost.code(), 1, Integer::sum);
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state IN " + OCCUPYING, car));
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", car));
            assertEquals(1, count("SELECT count(*) FROM manual_claims WHERE order_uuid = ?", car));
            assertEquals(winner == 0 ? "employee-paula" : "employee-jordan",
                    text("SELECT employee_id FROM custody_holds WHERE order_uuid = ?", car));
            assertEquals(2, count("SELECT version FROM stock_cars WHERE order_uuid = ?", car), "one winner bumps the car once");
            resetClaims();
        }
        System.out.println("RACE loser codes over 10 iterations: " + loserCodes);
    }

    @Test
    void oneEmployeeRacingTwoCarsHoldsOnlyOneAndASecondClaimWhileHeldIsRefused() throws Exception {
        Map<String, Integer> loserCodes = new TreeMap<>();
        for (int i = 0; i < 5; i++) {
            ObjectNode one = claimInput("sub-paula", U + "1", cid("slot-1"));
            ObjectNode three = claimInput("sub-paula", U + "3", cid("slot-3"));
            String tok = token("sub-paula");
            List<Resp> r = race(() -> post(tok, "claim", one), () -> post(tok, "claim", three));
            int winner = r.get(0).status() == 200 ? 0 : 1;
            Resp won = r.get(winner);
            Resp lost = r.get(1 - winner);
            assertEquals(200, won.status(), r.toString());
            assertEquals(409, lost.status(), lost.toString());
            assertTrue(List.of("release-required", "slot-occupied").contains(lost.code()), lost.code());
            loserCodes.merge(lost.code(), 1, Integer::sum);
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE employee_id = 'employee-paula' AND state IN " + OCCUPYING));
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE employee_id = 'employee-paula'"));
            Resp again = post(tok, "claim", claimInput("sub-paula", U + "6", cid("slot-6")));
            assertEquals(409, again.status());
            assertEquals("release-required", again.code());
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE employee_id = 'employee-paula'"));
            resetClaims();
        }
        System.out.println("SLOT loser codes over 5 iterations: " + loserCodes);
    }

    @Test
    void aClaimNamingTheWrongCarVersionDigestOrContextIsRefusedAndWritesNothing() throws Exception {
        ObjectNode good = claimInput("sub-paula", U + "1", cid("exact"));
        assertRefused(good, i -> i.put("orderUuid", U + "7"), "car-not-eligible-or-available");
        assertRefused(good, i -> i.put("orderUuid", U + "2"), "car-not-eligible-or-available");
        assertRefused(good, i -> i.put("orderUuid", U + "4"), "car-not-eligible-or-available");
        assertRefused(good, i -> i.put("orderUuid", "no-such-car"), "car-not-eligible-or-available");
        assertRefused(good, i -> i.put("expectedStockVersion", 9), "stale-version");
        assertRefused(good, i -> i.put("expectedTermsDigest", "0".repeat(64)), "stale-version");
        assertRefused(good, i -> i.put("expectedContextVersion", "other"), "stale-version");
        assertRefused(good, i -> i.put("expectedDraftVersion", 7), "stale-version");
        assertEquals(0, count("SELECT count(*) FROM custody_holds"));
        assertEquals(0, count("SELECT count(*) FROM manual_claims"));
        assertEquals(200, post(token("sub-paula"), "claim", good).status());
        Resp noDraft = post(token("sub-alex"), "claim", claimInput("sub-paula", U + "3", cid("exact-x")));
        assertEquals(503, noDraft.status(), "alex has no saved draft, so nothing can be claimed for them: " + noDraft);
        assertEquals("draft-review-required", noDraft.code());
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));
    }

    @Test
    void anotherEmployeeCannotReviewOrReleaseSomeoneElsesClaim() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("own"));
        Resp review = post(token("sub-jordan"), "claim/review", action(cid("own-r"), held.hold()));
        assertEquals(403, review.status(), review.toString());
        Resp rel = release("sub-jordan", held.hold(), "cancel", cid("own-x"));
        assertEquals(403, rel.status(), rel.toString());
        assertEquals("active", text("SELECT state FROM custody_holds WHERE hold_id = ?", held.hold().get("holdId").asText()));
        assertEquals(404, get("sub-jordan", "claim").status(), "jordan has no claim of his own");
    }

    // ---- AC1/AC2: expiry ----

    @Test
    void aPreviewClaimPastItsDeadlineIsExpiredBySweepAndTheCarFreesForAnotherEmployee() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("exp"));
        JsonNode timing = held.value().at("/quote/timing");
        long preview = timing.get("previewSeconds").asLong();
        assertTrue(timing.get("assumptions").toString().contains("hold.cart.durationSeconds"));
        assertTrue(timing.get("assumptions").toString().contains("hold.cart.orderReview.durationSeconds"));
        assertEquals(T0.plusSeconds(preview).toString().replace("Z", ".000Z"), held.hold().get("expiresAt").asText());
        JsonNode before = decision("sub-jordan", U + "1");
        assertTrue(before == null || before.get("claimInput").isNull(), "a held car carries no claim input for another employee");
        clock.now = T0.plusSeconds(preview - 1);
        sweep.sweepNow();
        assertEquals("active", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
        clock.now = T0.plusSeconds(preview + 1);
        Resp lateReview = post(token("sub-paula"), "claim/review", action(cid("exp-r"), held.hold()));
        assertEquals("claim-expired", lateReview.code(), lateReview.toString());
        sweep.sweepNow();
        assertEquals("expired", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
        assertEquals("expiry", text("SELECT release_reason FROM manual_claims WHERE order_uuid = ?", U + "1"));
        assertEquals(3, count("SELECT version FROM stock_cars WHERE order_uuid = ?", U + "1"));
        Resp read = get("sub-paula", "claim");
        assertEquals("expired", read.value().get("state").asText());
        assertEquals("browse-stock", read.value().at("/view/action").asText());
        assertEquals(200, claim("sub-jordan", U + "1", cid("exp-a")).status());
        assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state IN " + OCCUPYING, U + "1"));
        assertEquals(200, claim("sub-paula", U + "3", cid("exp-p3")).status(), "the expiry also freed paula's slot");
    }

    @Test
    void theOwnersReadExpiresTheirDueClaimWithoutASweep() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("own-exp"));
        clock.now = T0.plusSeconds(held.value().at("/quote/timing/previewSeconds").asLong() + 5);
        Resp read = get("sub-paula", "claim");
        assertEquals("expired", read.value().get("state").asText());
        assertEquals("expired", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
        assertEquals(200, claim("sub-jordan", U + "1", cid("own-exp-a")).status());
    }

    @Test
    void reviewExtendsTheHoldOnceAndALaterReviewNeverExtendsItAgain() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("rev"));
        long preview = held.value().at("/quote/timing/previewSeconds").asLong();
        long review = held.value().at("/quote/timing/reviewSeconds").asLong();
        clock.now = T0.plusSeconds(preview / 2);
        Resp first = post(token("sub-paula"), "claim/review", action(cid("rev-1"), held.hold()));
        assertEquals(200, first.status(), first.toString());
        assertEquals("order-review", first.hold().get("phase").asText());
        assertEquals(held.hold().get("version").asLong() + 1, first.hold().get("version").asLong());
        Instant extended = clock.now.plusSeconds(review);
        assertEquals(extended.toString().replace("Z", ".000Z"), first.hold().get("expiresAt").asText());
        assertEquals("submit-or-cancel", first.value().at("/view/action").asText());
        Resp stale = post(token("sub-paula"), "claim/review", action(cid("rev-2"), held.hold()));
        assertEquals(409, stale.status());
        assertEquals("stale-version", stale.code());
        clock.now = T0.plusSeconds(preview / 2 + review / 2);
        Resp again = post(token("sub-paula"), "claim/review", action(cid("rev-3"), first.hold()));
        assertEquals(200, again.status(), again.toString());
        assertEquals(first.hold().get("version").asLong(), again.hold().get("version").asLong());
        assertEquals(first.hold().get("expiresAt").asText(), again.hold().get("expiresAt").asText());
        clock.now = extended.plusSeconds(1);
        sweep.sweepNow();
        assertEquals("expired", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
    }

    // ---- AC2: retries and replay ----

    @Test
    void theSameCommandIdReplaysWithoutASecondHoldAndChangedInputIsRefused() throws Exception {
        ObjectNode in = claimInput("sub-paula", U + "1", cid("retry"));
        Resp first = post(token("sub-paula"), "claim", in);
        assertEquals(200, first.status(), first.toString());
        assertNull(first.body().get("replayed"));
        Resp second = post(token("sub-paula"), "claim", in);
        assertEquals(200, second.status());
        assertTrue(second.body().get("replayed").asBoolean());
        assertEquals(first.hold().get("holdId").asText(), second.hold().get("holdId").asText());
        assertEquals(first.hold().get("version").asLong(), second.hold().get("version").asLong());
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));
        assertEquals(1, count("SELECT count(*) FROM manual_claims"));
        assertEquals(2, count("SELECT version FROM stock_cars WHERE order_uuid = ?", U + "1"));
        ObjectNode changed = in.deepCopy();
        changed.put("orderUuid", U + "3");
        Resp refused = post(token("sub-paula"), "claim", changed);
        assertEquals(409, refused.status());
        assertEquals("idempotency-input-changed", refused.code());
        assertEquals(1, count("SELECT count(*) FROM custody_holds"));

        ObjectNode rel = releaseBody(first.hold(), "cancel", cid("retry-rel"));
        Resp released = post(token("sub-paula"), "claim/release", rel);
        assertEquals(200, released.status(), released.toString());
        assertEquals("released", released.value().get("state").asText());
        assertEquals("cancel", released.hold().get("releaseReason").asText());
        Resp replay = post(token("sub-paula"), "claim/release", rel);
        assertEquals(200, replay.status());
        assertTrue(replay.body().get("replayed").asBoolean());
        assertEquals(released.hold().get("version").asLong(), replay.hold().get("version").asLong());
        ObjectNode other = rel.deepCopy();
        other.put("reason", "back");
        assertEquals("idempotency-input-changed", post(token("sub-paula"), "claim/release", other).code());
        Resp fresh = release("sub-paula", released.hold(), "cancel", cid("retry-rel2"));
        assertEquals(409, fresh.status());
        assertEquals("claim-not-active", fresh.code());
        assertEquals(3, count("SELECT version FROM stock_cars WHERE order_uuid = ?", U + "1"), "one release bumped the car once");
        assertEquals(200, claim("sub-jordan", U + "1", cid("retry-a")).status(), "the release freed the car for the other employee");
    }

    // ---- drift: only what the service already checks ----

    @Test
    void changedAuthorityFactsMakeReviewRefuseBecauseTheSavedDraftNoLongerMatches() throws Exception {
        String before = text("SELECT attributes::text FROM employees WHERE employee_id = 'employee-paula'");
        String slotBefore = text("SELECT attributes::text FROM entitlement_slots WHERE slot_id = 'slot-paula'");
        try {
            Resp held = claim("sub-paula", U + "1", cid("drift-g"));
            exec("UPDATE employees SET attributes = jsonb_set(attributes, '{gradeId}', '\"G8-10\"') WHERE employee_id = 'employee-paula'");
            Resp grade = post(token("sub-paula"), "claim/review", action(cid("drift-g-r"), held.hold()));
            System.out.println("DRIFT grade change: " + grade.status() + " " + grade.code());
            assertEquals(503, grade.status(), grade.toString());
            assertEquals("draft-review-required", grade.code());
            exec("UPDATE employees SET attributes = ?::jsonb WHERE employee_id = 'employee-paula'", before);
            exec("UPDATE entitlement_slots SET attributes = attributes || '{\"memo\":\"changed\"}'::jsonb WHERE slot_id = 'slot-paula'");
            Resp slot = post(token("sub-paula"), "claim/review", action(cid("drift-s-r"), held.hold()));
            System.out.println("DRIFT slot change: " + slot.status() + " " + slot.code());
            assertEquals("draft-review-required", slot.code());
            assertEquals("preview", text("SELECT phase FROM manual_claims WHERE order_uuid = ?", U + "1"));
            assertEquals("active", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
        } finally {
            exec("UPDATE employees SET attributes = ?::jsonb WHERE employee_id = 'employee-paula'", before);
            exec("UPDATE entitlement_slots SET attributes = ?::jsonb WHERE slot_id = 'slot-paula'", slotBefore);
        }
        Resp read = get("sub-paula", "claim");
        assertEquals(200, read.status());
        assertEquals(200, release("sub-paula", read.hold(), "cancel", cid("drift-rel")).status());
    }

    @Test
    void aChangedCarMakesReviewRefuseAndTheClaimIsStillReleasable() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("drift-c"));
        exec("UPDATE stock_cars SET attributes = jsonb_set(attributes, '{facts,facts,insuranceGroup,value}', '21'::jsonb) WHERE order_uuid = ?", U + "1");
        Resp review = post(token("sub-paula"), "claim/review", action(cid("drift-c-r"), held.hold()));
        System.out.println("DRIFT car change: " + review.status() + " " + review.code());
        assertEquals(409, review.status(), review.toString());
        assertEquals("quote-changed-release-required", review.code());
        assertEquals("preview", text("SELECT phase FROM manual_claims WHERE order_uuid = ?", U + "1"));
        assertEquals(200, release("sub-paula", held.hold(), "change", cid("drift-c-x")).status());
        assertEquals(0, count("SELECT count(*) FROM custody_holds WHERE state IN " + OCCUPYING));
    }

    // ---- AC2 validate line: projections and the order ----

    @Test
    void claimAndQuoteReadTheHeldProjectionAndTheReviewedClaimBecomesOneReplayableOrder() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("ord"));
        String holdId = held.hold().get("holdId").asText();
        for (String route : List.of("claim", "quote")) {
            Resp read = get("sub-paula", route);
            assertEquals(200, read.status(), route);
            assertEquals(holdId, read.hold().get("holdId").asText());
            assertEquals("quoted", read.value().get("state").asText());
            assertEquals("preview", read.hold().get("phase").asText());
            assertEquals("replacement", read.hold().get("mode").asText());
            assertEquals(held.value().at("/quote/termsDigest").asText(), read.value().at("/quote/termsDigest").asText());
            assertEquals("manual-quote:" + holdId.substring("manual-hold:".length()), read.value().at("/quote/quoteId").asText());
            assertEquals(text("SELECT terms_digest FROM manual_claims WHERE hold_id = ?", holdId), read.value().at("/quote/termsDigest").asText());
            assertEquals("employee-paula", read.hold().get("employeeId").asText());
            assertEquals("slot-paula", read.hold().get("entitlementSlotId").asText());
        }
        Resp notYet = order("sub-paula", cid("ord-early"), held.hold(), held.value().at("/quote"));
        assertEquals(409, notYet.status(), notYet.toString());
        assertEquals("order-review-required", notYet.code());

        Resp reviewed = post(token("sub-paula"), "claim/review", action(cid("ord-r"), held.hold()));
        assertEquals(200, reviewed.status(), reviewed.toString());
        JsonNode quote = reviewed.value().get("quote");
        Resp stockMoved = order("sub-paula", cid("ord-stock"), reviewed.hold(), withStock(quote, 99));
        assertEquals(409, stockMoved.status(), stockMoved.toString());
        assertEquals("stock-changed", stockMoved.code());
        assertEquals(0, count("SELECT count(*) FROM selection_orders"));
        assertEquals("active", text("SELECT state FROM custody_holds WHERE hold_id = ?", holdId));

        String commandId = cid("ord-ok");
        Resp placed = order("sub-paula", commandId, reviewed.hold(), quote);
        assertTrue(placed.status() == 200 || placed.status() == 202, placed.toString());
        assertEquals(1, count("SELECT count(*) FROM selection_orders WHERE hold_id = ?", holdId));
        assertEquals("allocated", text("SELECT state FROM custody_holds WHERE hold_id = ?", holdId));
        assertEquals("allocated", text("SELECT state FROM stock_cars WHERE order_uuid = ?", U + "1"));
        Resp replay = order("sub-paula", commandId, reviewed.hold(), quote);
        assertEquals(200, replay.status(), replay.toString());
        assertTrue(replay.value().get("replayed").asBoolean());
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
        assertEquals(1, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
        Resp read = get("sub-paula", "order");
        assertEquals(200, read.status(), read.toString());
        assertEquals(holdId, read.value().at("/selection/holdId").asText());
        assertEquals(U + "1", read.value().at("/selection/orderUuid").asText());
        assertEquals(quote.get("quoteId").asText(), read.value().at("/selection/quoteId").asText());
        assertEquals("cart", read.value().at("/selection/sourceType").asText());
        assertEquals("acknowledged", read.value().get("status").asText());
        assertEquals(text("SELECT order_reference FROM selection_orders"), read.value().get("orderReference").asText());

        Resp claimRead = get("sub-paula", "claim");
        assertEquals("allocated", claimRead.value().get("state").asText());
        assertEquals("continue-order-handoff", claimRead.value().at("/view/action").asText());
        Resp rel = release("sub-paula", claimRead.hold(), "cancel", cid("ord-rel"));
        assertEquals(409, rel.status());
        assertEquals("claim-not-active", rel.code());
        clock.now = T0.plusSeconds(3600);
        sweep.sweepNow();
        assertEquals("allocated", text("SELECT state FROM custody_holds WHERE hold_id = ?", holdId));
        assertEquals("allocated", text("SELECT state FROM stock_cars WHERE order_uuid = ?", U + "1"));
        assertEquals(1, count("SELECT count(*) FROM selection_orders"));
    }

    @Test
    void anAuthorityChangeAfterReviewBlocksTheOrderAndLeavesTheClaimUnallocated() throws Exception {
        Resp held = claim("sub-paula", U + "1", cid("blk"));
        Resp reviewed = post(token("sub-paula"), "claim/review", action(cid("blk-r"), held.hold()));
        assertEquals(200, reviewed.status(), reviewed.toString());
        String slotBefore = text("SELECT attributes::text FROM entitlement_slots WHERE slot_id = 'slot-paula'");
        try {
            exec("UPDATE entitlement_slots SET attributes = attributes || '{\"memo\":\"changed\"}'::jsonb WHERE slot_id = 'slot-paula'");
            Resp placed = order("sub-paula", cid("blk-o"), reviewed.hold(), reviewed.value().get("quote"));
            System.out.println("DRIFT order after authority change: " + placed.status() + " " + placed.code());
            assertEquals(409, placed.status(), placed.toString());
            assertEquals("draft-review-required", placed.code());
            assertEquals(0, count("SELECT count(*) FROM selection_orders"));
            assertEquals(0, count("SELECT count(*) FROM pending_operations WHERE operation_type = 'selection-order'"));
            assertEquals("active", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
            assertEquals("released", text("SELECT state FROM stock_cars WHERE order_uuid = ?", U + "1"));
        } finally {
            exec("UPDATE entitlement_slots SET attributes = ?::jsonb WHERE slot_id = 'slot-paula'", slotBefore);
        }
        Resp placed = order("sub-paula", cid("blk-ok"), reviewed.hold(), reviewed.value().get("quote"));
        assertTrue(placed.status() == 200 || placed.status() == 202, "restored facts let the same claim order: " + placed);
        assertEquals("allocated", text("SELECT state FROM custody_holds WHERE order_uuid = ?", U + "1"));
    }

    // ---- helpers ----

    private static String cid(String prefix) {
        return prefix + "-" + UUID.randomUUID();
    }

    private String token(String sub) throws Exception {
        return ClaimCompositionSeed.token(signingJwk, sub);
    }

    private Resp get(String sub, String route) throws Exception {
        var r = given().header("Authorization", "Bearer " + token(sub)).when().get(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    private static Resp post(String token, String route, JsonNode body) throws Exception {
        var r = given().header("Authorization", "Bearer " + token).contentType("application/json").body(body.toString())
                .when().post(BASE + route).then().extract();
        return new Resp(r.statusCode(), JSON.readTree(r.asString()));
    }

    private static List<Resp> race(Callable<Resp> a, Callable<Resp> b) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Resp>> futures = new ArrayList<>();
            for (Callable<Resp> task : List.of(a, b)) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return task.call();
                }));
            }
            ready.await();
            go.countDown();
            List<Resp> out = new ArrayList<>();
            for (Future<Resp> f : futures) out.add(f.get(60, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    private void saveDraft(String sub, String who) throws Exception {
        ObjectNode choices = StockDbFixture.complete();
        choices.put("slotId", "slot-" + who).put("driverId", "driver:employee-" + who);
        if ("paula".equals(who)) choices.put("oldContractId", "current:employee-paula");
        else choices.put("mode", "new").remove(List.of("oldContractId", "expectedReturnMileage"));
        ((ObjectNode) choices.get("contact")).put("email", who + "@gcsp-demo.com");
        String ctx = get(sub, "account").value().get("contextVersion").asText();
        ObjectNode in = JSON.createObjectNode().put("commandId", cid("draft-" + who)).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", ctx);
        in.set("choices", choices);
        Resp saved = post(token(sub), "draft", in);
        assertEquals(200, saved.status(), saved.toString());
    }

    private JsonNode decision(String sub, String car) throws Exception {
        Resp stock = get(sub, "stock");
        assertEquals(200, stock.status(), stock.toString());
        for (JsonNode d : stock.value().get("decisions")) if (car.equals(d.get("orderUuid").asText())) return d;
        return null;
    }

    /** The browse's own claim input for an eligible car, which is what the app tells the client to send. */
    private ObjectNode claimInput(String sub, String car, String commandId) throws Exception {
        JsonNode d = decision(sub, car);
        assertNotNull(d, car + " is in the browse");
        assertEquals("eligible", d.get("gateStatus").asText(), sub + " is shown " + car + " as eligible: " + d.get("blockers") + d.get("unknowns"));
        ObjectNode in = ((ObjectNode) d.get("claimInput")).deepCopy();
        in.put("commandId", commandId);
        return in;
    }

    private Resp claim(String sub, String car, String commandId) throws Exception {
        Resp r = post(token(sub), "claim", claimInput(sub, car, commandId));
        assertEquals(200, r.status(), r.toString());
        return r;
    }

    private void assertRefused(ObjectNode good, java.util.function.Consumer<ObjectNode> edit, String code) throws Exception {
        ObjectNode in = good.deepCopy();
        in.put("commandId", cid("bad"));
        edit.accept(in);
        Resp r = post(token("sub-paula"), "claim", in);
        assertEquals(409, r.status(), r.toString());
        assertEquals(code, r.code(), in.toString());
    }

    private static ObjectNode action(String commandId, JsonNode hold) {
        return JSON.createObjectNode().put("commandId", commandId).put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1);
    }

    private static ObjectNode releaseBody(JsonNode hold, String reason, String commandId) {
        return action(commandId, hold).put("reason", reason);
    }

    private Resp release(String sub, JsonNode hold, String reason, String commandId) throws Exception {
        return post(token(sub), "claim/release", releaseBody(hold, reason, commandId));
    }

    private static JsonNode withStock(JsonNode quote, long stockVersion) {
        return ((ObjectNode) quote.deepCopy()).put("stockVersion", stockVersion);
    }

    private Resp order(String sub, String commandId, JsonNode hold, JsonNode quote) throws Exception {
        String digest = get(sub, "order/terms").value().get("termsDigest").asText();
        ObjectNode b = JSON.createObjectNode().put("commandId", commandId);
        b.putObject("source").put("type", "cart").put("holdId", hold.get("holdId").asText())
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1);
        b.put("expectedQuoteId", quote.get("quoteId").asText()).put("expectedStockVersion", quote.get("stockVersion").asLong());
        b.put("termsDigest", digest);
        b.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        return post(token(sub), "order", b);
    }

    /** Between race iterations: drops claims, holds and orders and puts the cars back to released at version 1. */
    private void resetClaims() throws Exception {
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            try {
                st.execute("SET session_replication_role = replica");
                for (String t : List.of("selection_orders", "ordering_synthetic_receipts", "pending_operations",
                        "manual_claim_operations", "manual_claims", "custody_holds", "outbox_events")) {
                    st.execute("DELETE FROM " + t);
                }
                st.execute("UPDATE stock_cars SET version = 1, state = 'released'");
            } finally {
                st.execute("RESET session_replication_role");
            }
        }
    }

    private void clean() throws Exception {
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            try {
                // Immutable and guarded tables are cleared with triggers and foreign keys off for this session only.
                st.execute("SET session_replication_role = replica");
                for (String t : List.of("selection_orders", "ordering_synthetic_receipts", "ordering_reference_counters",
                        "pending_operations", "manual_claim_operations", "manual_review_freezes", "manual_review_details",
                        "manual_claims", "custody_holds", "manual_drafts", "stock_cars", "outbox_events", "command_receipts")) {
                    st.execute("DELETE FROM " + t);
                }
            } finally {
                st.execute("RESET session_replication_role");
            }
        }
    }

    private void exec(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    private long count(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    private String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }
}
