package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.postgresql.ds.PGSimpleDataSource;

/** The PostgreSQL supply adapter over migrated tables, written the way the release and Production writers write them. */
class PostgresPlanningSupplyTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String ENV = "planning-supply-env";
    private static final String RUN = PlanningFixtures.RUN;
    private static final String POLICY = PlanningFixtures.POLICY;
    private static final String AS_OF = "2026-11-06T00:00:00.000Z";
    private static final String TOURING_CONFIG = "Q01QRzIxOlJFRlBBSU5ULFJFRlRSSU0=";
    private static final String SALOON_CONFIG = "Q01QRzIwOlJFRlBBSU5ULFJFRlRSSU0=";
    private static final AtomicInteger SEQ = new AtomicInteger();

    @TempDir
    Path dir;

    private String url;
    private String schema;
    private PGSimpleDataSource ds;
    private PolicyService policy;
    private final AtomicInteger clockVersion = new AtomicInteger(1);

    @BeforeEach
    void migrate() throws Exception {
        url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        schema = "gcsp_ps_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        PGSimpleDataSource admin = new PGSimpleDataSource();
        admin.setUrl(url);
        Flyway.configure().dataSource(admin).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        ds = new PGSimpleDataSource();
        ds.setUrl(url);
        ds.setCurrentSchema(schema);
        update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        policy = new PolicyService(new PolicyFiles(dir, "planning-supply").source(M.createArrayNode()));
    }

    @AfterEach
    void drop() throws SQLException {
        if (schema == null) {
            return;
        }
        PGSimpleDataSource admin = new PGSimpleDataSource();
        admin.setUrl(url);
        try (Connection c = admin.getConnection()) {
            c.createStatement().execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }

    private void update(String sql, Object... args) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                Object a = args[i];
                if (a instanceof Instant t) {
                    ps.setTimestamp(i + 1, Timestamp.from(t));
                } else if (a instanceof JsonNode j) {
                    ps.setObject(i + 1, j.toString(), java.sql.Types.OTHER);
                } else {
                    ps.setObject(i + 1, a);
                }
            }
            ps.executeUpdate();
        }
    }

    private PostgresPlanningSupply adapter(Supplier<String> version) {
        return new PostgresPlanningSupply(ds, context -> new PlanningClock.Observation(Instant.parse(AS_OF), version.get()),
                context -> Instant.parse(AS_OF));
    }

    private PostgresPlanningSupply adapter(String runNow, Instant claimNow) {
        return new PostgresPlanningSupply(ds, context -> new PlanningClock.Observation(Instant.parse(runNow), "v1"), context -> claimNow);
    }

    private ObjectNode read(PostgresPlanningSupply adapter) {
        return adapter.readSupply(new PlanningRead(new RunContext(ENV, RUN, "sub-greg"), AS_OF, POLICY, "2027-02-04T00:00:00.000Z"), policy);
    }

    private ObjectNode readAt(PostgresPlanningSupply adapter, String asOf) {
        return adapter.readSupply(new PlanningRead(new RunContext(ENV, RUN, "sub-greg"), asOf, POLICY, "2027-02-04T00:00:00.000Z"), policy);
    }

    private static ObjectNode visibility() {
        ObjectNode v = M.createObjectNode();
        v.putArray("companyIds").add("co-1");
        v.putArray("schemeIds").add("sch-1");
        v.putNull("employeeIds");
        return v;
    }

    /** A car as StockRelease writes it: source fields plus the release block with its availability. */
    private void releasedCar(String uuid, String configuration, String trancheId, String supplyId, String releasedAt)
            throws SQLException {
        ObjectNode attrs = M.createObjectNode();
        attrs.put("orderNumber", "ON-" + uuid);
        attrs.set("visibility", visibility());
        ObjectNode release = attrs.putObject("release");
        release.put("trancheId", trancheId).put("windowId", "w-1");
        if (supplyId == null) release.putNull("supplyId"); else release.put("supplyId", supplyId);
        release.put("releasedAt", releasedAt).put("policyVersion", POLICY).put("sourceVersion", "src-v1");
        release.putObject("availability").put("state", "available").put("availableFrom", releasedAt).put("version", trancheId);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, ?, 'released', ?)", ENV, RUN, uuid, configuration, attrs);
    }

    private void tick(String tickId, Instant at) throws SQLException {
        update("INSERT INTO supply_release_ticks (environment_id, run_id, tick_id, tick_now, clock_version, input_digest, state, "
                + "last_outcome) VALUES (?, ?, ?, ?, 1, ?, 'completed', '{}')", ENV, RUN, tickId, at, "0".repeat(64));
    }

    private void receipt(String trancheId, String supplyId, String releasedAt, String... uuids) throws SQLException {
        tick("tick-" + trancheId, Instant.parse(releasedAt));
        ObjectNode out = M.createObjectNode();
        out.put("kind", "stock-released").put("runId", RUN).put("trancheId", trancheId).put("windowId", "w-1");
        if (supplyId == null) out.putNull("supplyId"); else out.put("supplyId", supplyId);
        out.put("tickId", "tick-" + trancheId).put("releasedAt", releasedAt);
        var ids = out.putArray("orderUuids");
        for (String u : uuids) ids.add(u);
        out.set("visibleOrderUuids", ids.deepCopy());
        out.put("policyVersion", POLICY);
        out.putObject("source").put("version", "src-v1").put("providerId", "p").put("label", "l").put("mode", "synthetic");
        update("INSERT INTO stock_releases (environment_id, run_id, tranche_id, window_id, supply_id, tick_id, released_at, "
                + "policy_version, source, input_digest, order_uuids, visible_order_uuids, outcome) "
                + "VALUES (?, ?, ?, 'w-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)", ENV, RUN, trancheId, supplyId, "tick-" + trancheId,
                Instant.parse(releasedAt), POLICY, out.get("source"), "1".repeat(64), out.get("orderUuids"),
                out.get("visibleOrderUuids"), out);
    }

    /** A request with one confirmation, queued into supply as ProductionService and StockRelease do. */
    private void confirmedRequest(String requestId, int quantity, String supplyId, int confirmed, boolean queued)
            throws SQLException {
        Instant requested = Instant.parse("2026-11-01T00:00:00Z");
        Instant confirmedAt = Instant.parse("2026-11-02T00:00:00Z");
        update("INSERT INTO production_submissions (environment_id, run_id, submission_id, command_id, requested_by, plan_id, "
                + "plan_versions, input_digest, requested_at) VALUES (?, ?, ?, ?, 'sub-greg', ?, '{}', ?, ?)",
                ENV, RUN, "sub-" + requestId, "cmd-" + requestId, "plan-" + requestId, "2".repeat(64), requested);
        update("INSERT INTO production_requests (environment_id, run_id, request_id, submission_id, line_id, model, derivative, "
                + "quantity, state, provider_mode, provider_reference, source_version, confirmed_quantity, input_digest, requested_at) "
                + "VALUES (?, ?, ?, ?, 'line-1', '3 Series Touring', '320i', ?, ?, 'synthetic', 'ref-1', 'prod-v1', ?, ?, ?)",
                ENV, RUN, requestId, "sub-" + requestId, quantity, confirmed < quantity ? "partly-confirmed" : "confirmed",
                confirmed, "3".repeat(64), requested);
        update("INSERT INTO production_responses (environment_id, run_id, request_id, seq, state, at, provider_reference, details) "
                + "VALUES (?, ?, ?, 1, 'delayed', ?, 'ref-1', ?)", ENV, RUN, requestId, Instant.parse("2026-11-01T12:00:00Z"),
                M.createObjectNode().put("confirmedQuantity", 0).putNull("code").put("reason", "Plant capacity")
                        .put("delayUntil", "2026-12-01T00:00:00.000Z"));
        update("INSERT INTO production_confirmations (environment_id, run_id, supply_id, request_id, quantity, confirmed_at, "
                + "source_version, provider_reference, queued_at, eligible_from) VALUES (?, ?, ?, ?, ?, ?, 'prod-v1', 'ref-1', ?, ?)",
                ENV, RUN, supplyId, requestId, confirmed, confirmedAt, queued ? confirmedAt : null,
                queued ? Instant.parse("2026-11-04T00:00:00Z") : null);
        if (queued) {
            update("INSERT INTO confirmed_supply_queue (environment_id, run_id, supply_id, confirmed_at, source_version, "
                    + "eligible_from, policy_version, input_digest) VALUES (?, ?, ?, ?, 'prod-v1', ?, ?, ?)", ENV, RUN, supplyId,
                    confirmedAt, Instant.parse("2026-11-04T00:00:00Z"), POLICY, "4".repeat(64));
        }
    }

    @Test
    void releasedHeldAndConfirmedSupplyMapToThePlannerContract() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        releasedCar("car-b", SALOON_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        releasedCar("car-unbound", "not-in-catalogue", "tr-1", null, "2026-11-03T00:00:00.000Z");
        receipt("tr-1", null, "2026-11-03T00:00:00.000Z", "car-a", "car-b", "car-unbound");
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, 'emp-1')", ENV, RUN);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, 'slot-1', 'emp-1', 1)", ENV, RUN);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, 'hold-1', 'car-b', 'emp-1', 'slot-1', 1, 'cart', 'active', ?)", ENV, RUN,
                Instant.parse("2026-11-07T00:00:00Z"));
        confirmedRequest("req-1", 3, "sup-1", 2, true);
        releasedCar("car-s1", TOURING_CONFIG, "tr-2", "sup-1", "2026-11-05T00:00:00.000Z");
        receipt("tr-2", "sup-1", "2026-11-05T00:00:00.000Z", "car-s1");

        ObjectNode out = read(adapter(() -> "v1"));

        assertEquals("ok", out.get("status").textValue(), out.toString());
        JsonNode v = out.get("value");
        assertEquals(RUN, v.get("runId").textValue());
        assertEquals(AS_OF, v.get("asOf").textValue());
        assertEquals(POLICY + ":order-plan-catalog.v1", v.get("versions").get("catalog").textValue());
        assertTrue(v.get("versions").get("stock").textValue().matches("[0-9a-f]{64}"));
        assertEquals(3, v.get("stock").size(), v.get("stock").toString());
        assertEquals("slot-1", v.get("stock").get(1).get("heldForEntitlementSlotId").textValue());
        assertEquals("g20-saloon-320i", v.get("stock").get(1).get("derivativeId").textValue());
        assertEquals(1, v.get("unboundStock").get("count").intValue());
        JsonNode in = v.get("inbound").get(0);
        assertEquals("sup-1", in.get("supplyId").textValue());
        assertEquals(2, in.get("quantity").intValue());
        assertEquals(1, in.get("releasedQuantity").intValue());
        assertEquals("2026-11-04T00:00:00.000Z", in.get("expectedAt").textValue());
        assertEquals("synthetic", in.get("provenance").get("provider").get("mode").textValue());
        assertEquals("cmd-req-1", v.get("requests").get(0).get("commandId").textValue());
        assertEquals("g21-touring-320i", v.get("requests").get(0).get("derivativeId").textValue());
        assertEquals("[\"delayed\",\"partly-confirmed\",\"released\"]", kinds(v.get("responses")));
        assertEquals("2026-12-01T00:00:00.000Z", v.get("responses").get(0).get("delayUntil").textValue());
    }

    @Test
    void allocatedCarsAreLeftOutWhetherTheStockOrOnlyTheHoldSaysSo() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        releasedCar("car-b", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        receipt("tr-1", null, "2026-11-03T00:00:00.000Z", "car-a", "car-b");
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, 'emp-1')", ENV, RUN);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, 'slot-1', 'emp-1', 1)", ENV, RUN);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, 'hold-1', 'car-b', 'emp-1', 'slot-1', 1, 'cart', 'allocated', ?)", ENV, RUN,
                Instant.parse("2026-11-07T00:00:00Z"));
        update("UPDATE stock_cars SET state = 'allocated' WHERE order_uuid = 'car-a'");

        ObjectNode out = read(adapter(() -> "v1"));

        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals(0, out.get("value").get("stock").size());
    }

    @Test
    void aConfirmationNotYetQueuedIntoSupplyIsRefusedNotGivenADate() throws Exception {
        confirmedRequest("req-1", 2, "sup-1", 1, false);

        ObjectNode out = read(adapter(() -> "v1"));

        assertEquals("unavailable", out.get("status").textValue());
        assertEquals("planning-confirmed-supply-invalid", out.get("code").textValue());
    }

    @Test
    void aSupplyLinkedCarWithoutItsReleaseReceiptIsRefused() throws Exception {
        confirmedRequest("req-1", 2, "sup-1", 2, true);
        releasedCar("car-s1", TOURING_CONFIG, "tr-2", "sup-1", "2026-11-05T00:00:00.000Z");

        ObjectNode out = read(adapter(() -> "v1"));

        assertEquals("planning-release-receipt-missing", out.get("code").textValue(), out.toString());
    }

    @Test
    void missingVisibilityIsRefusedNotDefaulted() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        update("UPDATE stock_cars SET attributes = attributes - 'visibility'");

        ObjectNode out = read(adapter(() -> "v1"));

        assertEquals("planning-stock-visibility-missing", out.get("code").textValue());
    }

    @Test
    void aClockVersionChangeDuringTheReadIsAConflict() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");

        ObjectNode out = read(adapter(() -> "v" + clockVersion.getAndIncrement()));

        assertEquals("conflict", out.get("status").textValue());
        assertEquals("planning-supply-changed", out.get("code").textValue());
    }

    @Test
    void aRetiredOrUnknownRunReadsAsAMismatchAndTwoReadsOfOneStateAgree() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        PostgresPlanningSupply adapter = adapter(() -> "v1");
        assertEquals(read(adapter), read(adapter));
        ObjectNode other = adapter.readSupply(new PlanningRead(new RunContext(ENV, "run-9", "sub-greg"), AS_OF, POLICY,
                "2027-02-04T00:00:00.000Z"), policy);
        assertEquals("planning-supply-read-mismatch", other.get("code").textValue());
    }

    @Test
    void aRunClockAheadOfWallTimeReadsRunClockStampedRowsAsAvailable() throws Exception {
        String runNow = "2026-11-09T00:00:00.000Z";
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-08T00:00:00.000Z");
        receipt("tr-1", null, "2026-11-08T00:00:00.000Z", "car-a");
        PostgresPlanningSupply onRunClock = new PostgresPlanningSupply(ds,
                context -> new PlanningClock.Observation(Instant.parse(runNow), "7"), context -> Instant.parse(runNow));

        ObjectNode out = readAt(onRunClock, runNow);

        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals(1, out.get("value").get("stock").size());
        assertEquals(runNow, out.get("value").get("asOf").textValue());
        // The same stamps judged against an earlier time stay refused: the future-row checks are unchanged.
        ObjectNode early = readAt(adapter(() -> "v1"), AS_OF);
        assertEquals("planning-stock-availability-invalid", early.get("code").textValue());
    }

    @Test
    void anAsOfThatIsNotTheClockNowIsAMismatchNotAPlan() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        PostgresPlanningSupply later = new PostgresPlanningSupply(ds,
                context -> new PlanningClock.Observation(Instant.parse("2026-11-06T01:00:00.000Z"), "v1"),
                context -> Instant.parse(AS_OF));

        ObjectNode out = readAt(later, AS_OF);

        assertEquals("unavailable", out.get("status").textValue());
        assertEquals("planning-supply-read-mismatch", out.get("code").textValue());
    }

    @Test
    void aClockInstantThatMovesDuringTheReadIsAConflictEvenWithTheSameVersion() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        AtomicInteger calls = new AtomicInteger();
        PostgresPlanningSupply moving = new PostgresPlanningSupply(ds, context -> new PlanningClock.Observation(
                Instant.parse(calls.incrementAndGet() == 1 ? AS_OF : "2026-11-06T00:00:01.000Z"), "v1"),
                context -> Instant.parse(AS_OF));

        ObjectNode out = readAt(moving, AS_OF);

        assertEquals("conflict", out.get("status").textValue());
        assertEquals("planning-supply-changed", out.get("code").textValue());
    }

    @Test
    void anUnavailableRunClockIsAnUnavailableReadNotAWallTimeFallback() throws Exception {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        PostgresPlanningSupply none = new PostgresPlanningSupply(ds, context -> {
            throw new IllegalStateException("The active run has no readable run clock.");
        }, context -> Instant.parse(AS_OF));

        ObjectNode out = readAt(none, AS_OF);

        assertEquals("unavailable", out.get("status").textValue());
        assertEquals("planning-supply-unavailable", out.get("code").textValue());
    }

    // ---- FUCQ-515: each hold is judged by the clock that stamped it ----

    private static final Instant CLAIM_NOW = Instant.parse("2026-11-06T00:00:00Z");
    private static final Instant CART_EXPIRES = CLAIM_NOW.plusSeconds(15 * 60);

    /** One car held for slot-1, written like ManualClaims (cart) or allocation Claim (buddy-offer). */
    private void heldCar(String holdType, Instant expiresAt) throws SQLException {
        releasedCar("car-a", TOURING_CONFIG, "tr-1", null, "2026-11-03T00:00:00.000Z");
        receipt("tr-1", null, "2026-11-03T00:00:00.000Z", "car-a");
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, 'emp-1')", ENV, RUN);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, 'slot-1', 'emp-1', 1)", ENV, RUN);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, 'hold-1', 'car-a', 'emp-1', 'slot-1', 1, ?, 'active', ?)", ENV, RUN, holdType,
                expiresAt);
    }

    private void assertHeld(ObjectNode out) {
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals("slot-1", out.get("value").get("stock").get(0).get("heldForEntitlementSlotId").textValue());
    }

    @Test
    void aFreshCartHoldIsHeldWhenTheRunClockIsTwoDaysAheadOfTheClaimClock() throws Exception {
        heldCar("cart", CART_EXPIRES);
        String runNow = "2026-11-08T00:00:00.000Z";

        assertHeld(readAt(adapter(runNow, CLAIM_NOW), runNow));
    }

    @Test
    void aFreshCartHoldIsHeldWhenTheRunClockEqualsTheClaimClock() throws Exception {
        heldCar("cart", CART_EXPIRES);

        assertHeld(read(adapter(AS_OF, CLAIM_NOW)));
    }

    @Test
    void aFreshCartHoldIsHeldWhenTheRunClockIsBehindTheClaimClock() throws Exception {
        heldCar("cart", CART_EXPIRES);
        String runNow = "2026-11-04T00:00:00.000Z";

        assertHeld(readAt(adapter(runNow, CLAIM_NOW), runNow));
    }

    @Test
    void aCartHoldPastItsExpiryByTheClaimClockIsUnresolvedWhateverTheRunClockSays() throws Exception {
        heldCar("cart", CART_EXPIRES);
        Instant lapsed = CART_EXPIRES;
        for (String runNow : new String[] {"2026-11-04T00:00:00.000Z", AS_OF, "2026-11-08T00:00:00.000Z"}) {
            ObjectNode out = readAt(adapter(runNow, lapsed), runNow);
            assertEquals("unavailable", out.get("status").textValue(), out.toString());
            assertEquals("planning-held-stock-unresolved", out.get("code").textValue());
        }
    }

    @Test
    void aBuddyOfferHoldExpiredByTheRunClockStaysUnresolved() throws Exception {
        heldCar("buddy-offer", Instant.parse("2026-11-05T12:00:00Z"));

        ObjectNode out = read(adapter(AS_OF, Instant.parse("2026-11-05T00:00:00Z")));

        assertEquals("unavailable", out.get("status").textValue(), out.toString());
        assertEquals("planning-held-stock-unresolved", out.get("code").textValue());
    }

    @Test
    void aBuddyOfferHoldIsJudgedByTheRunClockNotTheClaimClock() throws Exception {
        heldCar("buddy-offer", Instant.parse("2026-11-06T12:00:00Z"));

        assertHeld(read(adapter(AS_OF, Instant.parse("2026-11-20T00:00:00Z"))));
    }

    @Test
    void aClaimClockThatThrowsOrAnswersNothingIsUnavailableNeverAWallTimeFallback() throws Exception {
        heldCar("cart", CART_EXPIRES);
        PlanningClock run = context -> new PlanningClock.Observation(Instant.parse(AS_OF), "v1");

        ObjectNode thrown = read(new PostgresPlanningSupply(ds, run, context -> {
            throw new IllegalStateException("no claim clock");
        }));
        ObjectNode none = read(new PostgresPlanningSupply(ds, run, context -> null));

        for (ObjectNode out : new ObjectNode[] {thrown, none}) {
            assertEquals("unavailable", out.get("status").textValue(), out.toString());
            assertEquals("planning-supply-unavailable", out.get("code").textValue());
        }
    }

    private static String kinds(JsonNode responses) {
        var a = M.createArrayNode();
        responses.forEach(r -> a.add(r.get("kind").textValue()));
        return a.toString();
    }
}
