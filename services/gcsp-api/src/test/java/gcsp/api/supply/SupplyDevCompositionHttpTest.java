package gcsp.api.supply;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.postgresql.ds.PGSimpleDataSource;

/** The started app on the dev composition (demo supply, PolicyService policy, no files) over RS256 tokens and PostgreSQL; cumulative. */
@QuarkusTest
@TestProfile(SupplyDevCompositionProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class SupplyDevCompositionHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String CLOCK = API + "/presenter/clock";
    private static final String RELEASES = API + "/presenter/releases";
    private static final String FAULTS = API + "/presenter/scenarios/faults";
    private static final String SOURCE = "demo-synthetic-stock-v1";
    private static final String POLICY = "gcsp-policy-v1";
    private static final long LEAD_SECONDS = 56L * 86_400;

    /** The injected schema name, because the profile's static name can differ between class loaders. */
    private static String ownedSchema;
    private static String windowOneTick;
    private static List<String> windowOneUuids;
    private static String supplyId;
    private static List<String> supplyUuids;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    SupplyRelease supply;

    @Inject
    SupplySelection selection;

    @Inject
    SupplyStartup startup;

    @Inject
    PolicyService policy;

    @Inject
    RunClockDocumentClock runClockDocuments;

    private String presenter;
    private String greg;
    private String employee;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        // The documents tests' shared @Alternative clock pins the time; the dev composition binds the run clock.
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        presenter = token("sub-presenter", "presenter");
        greg = token("sub-greg", "greg");
        employee = token("sub-paula", "employee");
    }

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_supdev_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(SupplyDevCompositionProfile.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- the journey ----

    @Test
    @Order(1)
    void readinessReportsTheDemoProviderOverThePolicyService() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'supply-release' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'supply-release' }.data.provider", equalTo("demo"))
                .body("checks.find { it.name == 'supply-release' }.data.policy", equalTo("policy-service"))
                .body("checks.find { it.name == 'supply-release' }.data.pendingTicks", equalTo(0));
    }

    @Test
    @Order(2)
    void aTickBeforeTheReleaseCueReleasesNothingAndSaysSo() throws Exception {
        JsonPath clock = clock();
        Instant cue = Instant.parse(clock.getString("value.namedTimes.release"));
        assertTrue(Instant.parse(clock.getString("value.now")).isBefore(cue), "the run starts before its release cue");
        String id = "pre-cue-" + UUID.randomUUID();
        Response r = clockTick(id, clock.getLong("value.clockVersion"));
        assertEquals(200, r.statusCode(), r.asString());
        assertEquals("no-release", stockOutcome(r.jsonPath()).path("kind").asText());
        assertEquals(0, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));
        assertEquals(0, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ? AND state = 'released'"));
        assertEquals(1, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ? AND state = 'completed'", id));
        presenterSpec().get(RELEASES + "/stock").then().statusCode(200).body("value.cars.size()", equalTo(0));
        presenterSpec().get(RELEASES + "/latest").then().statusCode(200).body("value.release", equalTo(null));
    }

    @Test
    @Order(3)
    void theReleaseCueReleasesWindowOneExactlyAsTheProviderAndNodeGolden() throws Exception {
        JsonPath clock = clock();
        Response r = presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.getLong("value.clockVersion") + ",\"mode\":\"next-release\"}").post(API + "/presenter/controls/tick");
        r.then().statusCode(200).body("value.tick.state", equalTo("completed"))
                .body("value.advance.now", equalTo(clock.getString("value.namedTimes.release")));
        windowOneTick = r.jsonPath().getString("value.tick.tickId");
        JsonNode out = stockOutcome(r.jsonPath(), "value.tick");
        assertEquals("stock-released", out.path("kind").asText());
        assertEquals("demo-release-1", out.path("windowId").asText());
        assertEquals(SOURCE + ":demo-release-1:0", out.path("trancheId").asText());
        assertEquals(POLICY, out.path("policyVersion").asText());

        // The expected cars: Node's own output (golden), and the provider called directly with this app's PolicyService.
        JsonNode golden = null;
        for (JsonNode c : JSON.readTree(Files.readAllBytes(Path.of("src/test/resources/supply/demo-parity.json"))).get("cases")) {
            if ("release cue".equals(c.get("name").asText())) golden = c.get("expected");
        }
        assertNotNull(golden);
        Instant at = Instant.parse(clock.getString("value.namedTimes.release"));
        ProviderResponse direct = new DemoSupplyProvider(policy, (run, ids) -> Map.of(), cues()).pull(new PullRequest("run-1", at,
                "direct", 100, 56, POLICY, List.of(), List.of()));
        JsonNode expected = ((ProviderResponse.Ok) direct).value();
        windowOneUuids = new ArrayList<>();
        expected.at("/tranche/orderUuids").forEach(n -> windowOneUuids.add(n.asText()));
        assertEquals(6, windowOneUuids.size());
        List<String> goldenUuids = new ArrayList<>();
        golden.at("/tranche/orderUuids").forEach(n -> goldenUuids.add(n.asText()));
        assertEquals(goldenUuids, windowOneUuids);
        assertEquals(goldenUuids, texts(out.path("orderUuids")));
        Map<String, String> numbers = new LinkedHashMap<>();
        expected.get("stock").forEach(c -> numbers.put(c.get("orderUuid").asText(), c.get("orderNumber").asText()));
        Map<String, String> goldenNumbers = new LinkedHashMap<>();
        golden.get("stock").forEach(c -> goldenNumbers.put(c.get("orderUuid").asText(), c.get("orderNumber").asText()));
        assertEquals(goldenNumbers, numbers);

        // The rows: six released cars with those numbers, one receipt, one outbox event, every car on the current versions.
        Map<String, String> stored = new LinkedHashMap<>();
        for (Object[] row : rows("SELECT order_uuid, attributes->>'orderNumber', attributes->'release'->>'policyVersion', "
                + "attributes->'release'->>'sourceVersion', attributes->'release'->>'trancheId', state FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY order_uuid")) {
            if (!"released".equals(row[5])) continue;
            stored.put((String) row[0], (String) row[1]);
            assertEquals(POLICY, row[2]);
            assertEquals(SOURCE, row[3]);
            assertEquals(SOURCE + ":demo-release-1:0", row[4]);
        }
        assertEquals(numbers.keySet(), stored.keySet());
        assertEquals(numbers, stored);
        assertEquals(1, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ? AND tranche_id = ? "
                + "AND policy_version = ? AND source->>'version' = ? AND jsonb_array_length(order_uuids) = 6",
                SOURCE + ":demo-release-1:0", POLICY, SOURCE));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released' AND payload->>'trancheId' = ?", SOURCE + ":demo-release-1:0"));

        // The presenter's read: the same six, with the version labels and no VIN or employee fields.
        String body = presenterSpec().get(RELEASES + "/stock?limit=500").then().statusCode(200)
                .body("value.cars.size()", equalTo(6)).body(not(containsString("vin"))).body(not(containsString("employee")))
                .extract().asString();
        JsonNode stock = JSON.readTree(body).at("/value/cars");
        Set<String> seen = new HashSet<>();
        for (JsonNode car : stock) {
            seen.add(car.get("orderUuid").asText());
            assertEquals(POLICY, car.at("/release/policyVersion").asText());
            assertEquals(SOURCE, car.at("/release/sourceVersion").asText());
            assertEquals(SOURCE + ":demo-release-1:0", car.at("/release/trancheId").asText());
            assertFalse(car.get("occupied").asBoolean());
        }
        assertEquals(new HashSet<>(windowOneUuids), seen);
        presenterSpec().get(RELEASES + "/latest").then().statusCode(200).body("value.release.windowId", equalTo("demo-release-1"))
                .body("value.release.policyVersion", equalTo(POLICY)).body("value.release.source.version", equalTo(SOURCE))
                .body("value.release.source.label", equalTo(DemoSupplyProvider.LABEL))
                .body("value.release.source.mode", equalTo("synthetic"));
    }

    @Test
    @Order(4)
    void replayAndDuplicateDeliveryDuplicateNothingAndChangedInputIs409() throws Exception {
        Object[] tick = rows("SELECT tick_now, clock_version FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ?", windowOneTick).get(0);
        Instant now = ((Instant) tick[0]);
        long version = (Long) tick[1];
        long cars = count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?");
        long ticks = count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ?");
        String same = "{\"tickId\":\"" + windowOneTick + "\",\"now\":\"" + now + "\",\"clockVersion\":" + version + "}";
        presenterSpec().body(same).post(RELEASES + "/ticks").then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.outcome.kind", equalTo("stock-released")).body("value.outcome.windowId", equalTo("demo-release-1"));
        presenterSpec().body(same).post(RELEASES + "/ticks").then().statusCode(200).body("value.replayed", equalTo(true));
        presenterSpec().body("{\"tickId\":\"" + windowOneTick + "\",\"now\":\"" + now.plusSeconds(1) + "\",\"clockVersion\":"
                + version + "}").post(RELEASES + "/ticks").then().statusCode(409).body("code", equalTo("tick-input-changed"));
        // A new delivery at the same clock position is a different tick: nothing new is due, so nothing is released.
        JsonPath clock = clock();
        Response again = clockTick("dup-" + UUID.randomUUID(), clock.getLong("value.clockVersion"));
        assertEquals("no-release", stockOutcome(again.jsonPath()).path("kind").asText());
        assertEquals(cars, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?"));
        assertEquals(ticks + 1, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ?"));
        assertEquals(1, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released'"));
    }

    @Test
    @Order(5)
    void anEmployeesRecommendationCandidatesComeFromTheReleasedCars() throws Exception {
        String brief = "{\"schemaVersion\":1,\"briefVersion\":1,\"preferences\":{\"body\":{\"value\":\"estate\","
                + "\"importance\":100,\"valueState\":\"confirmed\",\"importanceState\":\"confirmed\",\"source\":\"employee\"}},"
                + "\"essentials\":{}}";
        Response r = given().header("Authorization", "Bearer " + employee).contentType(ContentType.JSON).body(brief)
                .post(API + "/recommendations");
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode value = JSON.readTree(r.asString()).get("value");
        List<String> candidates = texts(value.get("decisions").findValues("orderUuid"));
        assertFalse(candidates.isEmpty(), "the allocator saw candidates: " + value.path("state"));
        assertTrue(new HashSet<>(windowOneUuids).containsAll(candidates), "every candidate is a released car");
        assertTrue(value.path("eligibleCount").asInt() > 0, value.toString());
        assertEquals(POLICY, value.at("/versions/policy").asText());
        // The allocator's own page read returns the very same cars.
        RunContext scope = supply.scope();
        List<String> page = new ArrayList<>();
        for (ReleasedCar car : supply.stock().page(scope, null, 500)) page.add(car.orderUuid());
        assertEquals(new HashSet<>(windowOneUuids), new HashSet<>(page));
    }

    @Test
    @Order(6)
    void aGregOrderConfirmedByProductionIsQueuedWithThePolicyLeadTime() throws Exception {
        // Greg orders two touring cars on the current versions; the presenter confirms both.
        JsonPath read = JsonPath.from(gregSpec().get(API + "/greg/orders").then().statusCode(200).extract().asString());
        String order = "{\"commandId\":\"" + cmd() + "\",\"model\":\"3 Series Touring\",\"derivative\":\"320i\",\"quantity\":2,"
                + "\"expectedPolicyVersion\":\"" + read.getString("value.versions.policy") + "\",\"expectedStockVersion\":\""
                + read.getString("value.versions.stock") + "\"}";
        JsonPath placed = JsonPath.from(gregSpec().body(order).post(API + "/greg/orders").then().statusCode(200)
                .body("value.requests[0].state", equalTo("requested")).extract().asString());
        String requestId = placed.getString("value.requests[0].requestId");
        JsonPath after = JsonPath.from(gregSpec().get(API + "/greg/orders").then().statusCode(200).extract().asString());
        long requestVersion = after.getLong("value.requests.find { it.requestId == '" + requestId + "' }.version");
        presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"requestId\":\"" + requestId + "\",\"expectedVersion\":"
                + requestVersion + ",\"action\":\"confirm\",\"quantity\":2}").post(API + "/presenter/production").then()
                .statusCode(200).body("value.requests[0].outcome", equalTo("applied"));

        supplyId = (String) rows("SELECT supply_id FROM production_confirmations WHERE environment_id = ? AND run_id = ? "
                + "AND request_id = ?", requestId).get(0)[0];
        // Queued with the policy lead time: eligible_from = confirmedAt + 56 days.
        Object[] queued = rows("SELECT EXTRACT(EPOCH FROM (eligible_from - confirmed_at))::bigint, policy_version FROM "
                + "confirmed_supply_queue WHERE environment_id = ? AND run_id = ? AND supply_id = ?", supplyId).get(0);
        assertEquals(LEAD_SECONDS, ((Number) queued[0]).longValue());
        assertEquals(POLICY, queued[1]);
        assertEquals(1, count("SELECT count(*) FROM production_confirmations WHERE environment_id = ? AND run_id = ? "
                + "AND supply_id = ? AND queued_at IS NOT NULL AND eligible_from IS NOT NULL", supplyId));

        // Before it is eligible, a later tick releases no supply car.
        advance(60);
        Response early = clockTick("early-" + UUID.randomUUID(), clock().getLong("value.clockVersion"));
        assertEquals("no-release", stockOutcome(early.jsonPath()).path("kind").asText());
        assertEquals(0, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ? AND supply_id IS NOT NULL"));
    }

    @Test
    @Order(7)
    void unfinishedWorkIsRecordedPendingAndEachRestartPathCompletesItOnce() throws Exception {
        AgroalDataSource ds = dataSource.get();
        // Window two is due (and the queued supply is not): the confirmed-supply read is down, so the tick stays pending.
        advanceTo(Instant.parse(clock().getString("value.namedTimes.release")).plusSeconds(150 * 60));
        String p1 = pendTick();
        assertEquals(1, ((Number) rows("SELECT attempts FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ?", p1).get(0)[0]).intValue());
        given().get("/q/health/ready").then().body("checks.find { it.name == 'supply-release' }.data.pendingTicks", equalTo(1));
        long cars = count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?");

        // A restarted process: a new provider with no cache and a new engine over the same database complete it once.
        ConfirmedSupplyLookup lookup = new PostgresConfirmedSupplyLookup(() -> ds, () -> supply.scope().environmentId());
        StockRelease restarted = new StockRelease(ds, selection.policy(), new DemoSupplyProvider(policy, lookup, cues()));
        List<ReleaseResult> first = restarted.reconcilePending(supply.scope(), 100);
        assertEquals(1, first.size());
        assertEquals(ReleaseResult.Status.OK, first.get(0).status(), first.get(0).code());
        assertEquals("demo-release-2", first.get(0).value().path("windowId").asText());
        assertEquals(3, first.get(0).value().path("orderUuids").size());
        assertEquals(cars + 3, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?"));
        assertEquals(1, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ? "
                + "AND window_id = 'demo-release-2'"));
        assertEquals(0, restarted.reconcilePending(supply.scope(), 100).size());
        assertEquals(1, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ? AND state = 'completed'", p1));

        // The app's own startup reconcile pass finishes a pending tick; nothing is released again.
        String p2 = pendTick();
        cars = count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?");
        assertEquals(1, startup.reconcileOnce());
        assertEquals("reconciled:1", startup.summary());
        assertEquals(1, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ? AND state = 'completed'", p2));
        assertEquals(0, startup.reconcileOnce());

        // The presenter reconcile route finishes one once; a second call processes nothing and writes nothing.
        String p3 = pendTick();
        long receipts = count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?");
        long events = count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released'");
        presenterSpec().body("{}").post(RELEASES + "/reconcile").then().statusCode(200).body("value.results.size()", equalTo(1))
                .body("value.results[0].tickId", equalTo(p3)).body("value.results[0].status", equalTo("ok"));
        presenterSpec().body("{}").post(RELEASES + "/reconcile").then().statusCode(200).body("value.results.size()", equalTo(0));
        assertEquals(0, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND state = 'pending'"));
        assertEquals(cars, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?"));
        assertEquals(receipts, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));
        assertEquals(events, count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released'"));
        given().get("/q/health/ready").then().body("checks.find { it.name == 'supply-release' }.data.pendingTicks", equalTo(0));
    }

    @Test
    @Order(8)
    void staleAndUnavailableStockAreExplicitThenConfirmedSupplyReleasesFirstExactlyOnce() throws Exception {
        // Past eligible_from the queued supply is due, and so is demo window three: the supply must go first.
        advance(LEAD_SECONDS);
        long version = clock().getLong("value.clockVersion");
        String id = "supply-" + UUID.randomUUID();
        long cars = count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?");
        long receipts = count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?");

        setFault("stale");
        clockTick(id, version).then().statusCode(503).body("code", equalTo("handler-interrupted"))
                .body("handlerId", equalTo("stock-release")).body("handlerOutcome.code", equalTo("stock-source-stale"))
                .body("handlerOutcome.retryable", equalTo(true));
        setFault("unavailable");
        clockTick(id, version).then().statusCode(503).body("handlerOutcome.code", equalTo("synthetic-stock-unavailable"))
                .body("handlerOutcome.retryable", equalTo(true));
        presenterSpec().get(CLOCK + "/ticks/" + id).then().statusCode(200).body("value.state", equalTo("interrupted"));
        assertEquals(cars, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?"));
        assertEquals(receipts, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));

        setFault("none");
        Response due = clockTick(id, version);
        assertEquals(200, due.statusCode(), due.asString());
        JsonNode out = stockOutcome(due.jsonPath());
        assertEquals("stock-released", out.path("kind").asText());
        assertEquals("supply-" + supplyId, out.path("windowId").asText());
        assertEquals(supplyId, out.path("supplyId").asText());
        supplyUuids = texts(out.get("orderUuids"));
        assertEquals(2, supplyUuids.size());
        assertEquals(0, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ? "
                + "AND window_id = 'demo-release-3'"), "demo window three is due but the supply went first");
        for (Object[] car : rows("SELECT attributes->>'orderNumber', attributes->'facts'->'display'->>'model', state, "
                + "attributes->'release'->>'sourceVersion', attributes->'release'->>'policyVersion' FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? AND attributes->'release'->>'supplyId' = ?", supplyId)) {
            assertTrue(Long.parseLong((String) car[0]) >= 9_100_000L, (String) car[0]);
            assertEquals("3 Series Touring", car[1]);
            assertEquals("released", car[2]);
            assertEquals(POLICY, car[4]);
        }
        assertEquals(2, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND attributes->'release'->>'supplyId' = ?", supplyId));
        // The provider called directly with the state before this release (the supply tranche left out) names the same cars.
        Object[] q = rows("SELECT confirmed_at, eligible_from, source_version, policy_version FROM confirmed_supply_queue "
                + "WHERE environment_id = ? AND run_id = ? AND supply_id = ?", supplyId).get(0);
        PullRequest request = new PullRequest("run-1", Instant.parse(clock().getString("value.now")), "direct", 100, 56, POLICY,
                releasedTranches().stream().filter(t -> !t.trancheId().contains(supplyId)).toList(),
                List.of(new PullRequest.QueuedSupply(supplyId, (Instant) q[0], (Instant) q[1], (String) q[2],
                        (String) q[3])));
        ProviderResponse direct = new DemoSupplyProvider(policy, (run, ids) -> Map.of(supplyId,
                new ConfirmedSupplyLookup.Confirmed("3 Series Touring", "320i", 2)), cues()).pull(request);
        assertEquals(supplyUuids, texts(((ProviderResponse.Ok) direct).value().at("/tranche/orderUuids")));

        // Resending the same tick, and a delivery of its own record, duplicate nothing.
        clockTick(id, version).then().statusCode(200);
        Object[] tick = rows("SELECT tick_now, clock_version FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ?", id).get(0);
        presenterSpec().body("{\"tickId\":\"" + id + "\",\"now\":\"" + (Instant) tick[0] + "\",\"clockVersion\":" + tick[1] + "}")
                .post(RELEASES + "/ticks").then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.outcome.supplyId", equalTo(supplyId));
        assertEquals(cars + 2, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ?"));
        assertEquals(receipts + 1, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));
        assertEquals(1, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ? AND supply_id = ?", supplyId));
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released' AND payload->>'supplyId' = ?", supplyId));
    }

    @Test
    @Order(9)
    void aLowerClockVersionIsRefusedAndNoCarWasReleasedTwice() throws Exception {
        JsonPath clock = clock();
        presenterSpec().body("{\"tickId\":\"stale-" + UUID.randomUUID() + "\",\"now\":\"" + Instant.parse(
                clock.getString("value.now")).plusSeconds(5) + "\",\"clockVersion\":" + (clock.getLong("value.clockVersion") - 1)
                + "}").post(RELEASES + "/ticks").then().statusCode(409).body("code", equalTo("release-clock-changed"));
        // 6 + 3 demo cars and the 2 supply cars, each released exactly once.
        assertEquals(11, count("SELECT count(*) FROM stock_cars WHERE environment_id = ? AND run_id = ? AND state = 'released'"));
        assertEquals(11, count("SELECT count(DISTINCT order_uuid) FROM stock_cars WHERE environment_id = ? AND run_id = ? "
                + "AND state = 'released'"));
        assertEquals(3, count("SELECT count(*) FROM stock_releases WHERE environment_id = ? AND run_id = ?"));
        assertEquals(3, count("SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'stock-released'"));
    }

    // ---- helpers ----

    /** Delivers one tick while the confirmed-supply read cannot reach Production data; it is recorded pending, then restored. */
    private String pendTick() throws Exception {
        advance(60);
        JsonPath clock = clock();
        String id = "pending-" + UUID.randomUUID();
        exec("ALTER TABLE production_requests RENAME TO production_requests_away");
        try {
            presenterSpec().body("{\"tickId\":\"" + id + "\",\"now\":\"" + clock.getString("value.now") + "\",\"clockVersion\":"
                    + clock.getLong("value.clockVersion") + "}").post(RELEASES + "/ticks").then().statusCode(503)
                    .body("code", equalTo("stock-source-unavailable")).body("retryable", equalTo(true))
                    .body("state", equalTo("pending"));
        } finally {
            exec("ALTER TABLE production_requests_away RENAME TO production_requests");
        }
        assertEquals(1, count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND tick_id = ? AND state = 'pending'", id));
        return id;
    }

    private void advanceTo(Instant target) {
        Instant now = Instant.parse(clock().getString("value.now"));
        if (target.isAfter(now)) advance(target.getEpochSecond() - now.getEpochSecond());
    }

    private List<PullRequest.Released> releasedTranches() throws SQLException {
        List<PullRequest.Released> out = new ArrayList<>();
        for (Object[] r : rows("SELECT tranche_id, order_uuids::text FROM stock_releases WHERE environment_id = ? AND run_id = ? "
                + "ORDER BY released_at, tranche_id")) {
            try {
                out.add(new PullRequest.Released((String) r[0], texts(JSON.readTree((String) r[1]))));
            } catch (java.io.IOException e) {
                throw new IllegalStateException(e);
            }
        }
        return out;
    }

    private RunCueLookup cues() {
        return new PostgresRunCueLookup(() -> dataSource.get(), () -> supply.scope().environmentId());
    }

    private void setFault(String mode) {
        presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"adapter\":\"stock\",\"mode\":\"" + mode + "\"}")
                .post(FAULTS).then().statusCode(200).body("value.faults[0].mode", equalTo(mode));
    }

    private void advance(long seconds) {
        long version = clock().getLong("value.clockVersion");
        presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":" + version + ",\"bySeconds\":" + seconds + "}")
                .post(CLOCK + "/advance").then().statusCode(200);
    }

    private JsonPath clock() {
        return presenterSpec().get(CLOCK).then().statusCode(200).extract().jsonPath();
    }

    private Response clockTick(String tickId, long version) {
        return presenterSpec().body("{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":" + version + "}").post(CLOCK + "/tick");
    }

    private static JsonNode stockOutcome(JsonPath tick) throws Exception {
        return stockOutcome(tick, "value");
    }

    private static JsonNode stockOutcome(JsonPath tick, String root) throws Exception {
        return JSON.readTree(JSON.writeValueAsString(tick.getMap(root + ".outcomes.find { it.handlerId == 'stock-release' }.outcome.value")));
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static List<String> texts(List<JsonNode> nodes) {
        List<String> out = new ArrayList<>();
        nodes.forEach(n -> out.add(n.asText()));
        return out;
    }

    private static String cmd() {
        return "cmd-" + UUID.randomUUID();
    }

    private RequestSpecification presenterSpec() {
        return given().header("Authorization", "Bearer " + presenter).contentType(ContentType.JSON);
    }

    private RequestSpecification gregSpec() {
        return given().header("Authorization", "Bearer " + greg).contentType(ContentType.JSON);
    }

    private void exec(String sql) throws SQLException {
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            st.execute(sql);
        }
    }

    private long count(String sql, Object... args) throws SQLException {
        return ((Number) rows(sql, args).get(0)[0]).longValue();
    }

    /** Runs the query with the active run's environment and run ids bound first, then the given arguments. */
    private List<Object[]> rows(String sql, Object... args) throws SQLException {
        RunContext scope = supply.scope();
        List<Object[]> out = new ArrayList<>();
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            for (int i = 0; i < args.length; i++) ps.setObject(i + 3, args[i]);
            try (ResultSet rs = ps.executeQuery()) {
                int n = rs.getMetaData().getColumnCount();
                while (rs.next()) {
                    Object[] row = new Object[n];
                    for (int i = 0; i < n; i++) {
                        Object v = rs.getObject(i + 1);
                        row[i] = v instanceof java.sql.Timestamp t ? t.toInstant() : v;
                    }
                    out.add(row);
                }
            }
        }
        return out;
    }

    private String token(String sub, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(SupplyDevCompositionProfile.ISSUER);
        c.setAudience(SupplyDevCompositionProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", SupplyDevCompositionProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }
}
