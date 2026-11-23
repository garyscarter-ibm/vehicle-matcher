package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.claims.ClaimClock;
import gcsp.api.clock.ClockConfiguration;
import gcsp.api.policy.PolicyService;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.*;
import org.postgresql.ds.PGSimpleDataSource;

/** Real signed OIDC, native PostgreSQL, actual account/claim/order services and presenter time; no clock alternative. */
@QuarkusTest
@TestProfile(ClaimRunClockHttpTest.Profile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ClaimRunClockHttpTest {
    private static String ownedSchema;
    private static Instant initial;
    private static String paulaHold;
    @ConfigProperty(name = "gcsp.test.signing-jwk") String signingJwk;
    @ConfigProperty(name = "quarkus.flyway.default-schema") String schema;
    @Inject Persistence persistence;
    @Inject Instance<AgroalDataSource> dataSource;
    @Inject ClaimClock claimClock;
    @Inject PolicyService policy;
    private ApptHttp http;

    public static class Profile extends HandoverJourneyProfile {
        private static final String SCHEMA = "gcsp_f581_" + Long.toHexString(System.nanoTime());
        @Override public Map<String, String> getConfigOverrides() {
            Map<String, String> m = new java.util.HashMap<>(super.getConfigOverrides());
            if ("true".equals(m.get("quarkus.datasource.active"))) {
                m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
                m.put("quarkus.flyway.schemas", SCHEMA);
                m.put("quarkus.flyway.default-schema", SCHEMA);
            }
            return m;
        }
    }

    @BeforeEach void setup() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        http = new ApptHttp(signingJwk);
    }

    @AfterAll static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.matches("gcsp_f581_[a-f0-9]+")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            s.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    private Response post(String who, String route, JsonNode input) throws Exception {
        return http.as(who).body(input.toString()).post(BASE + route);
    }
    private JsonNode ok(Response r) throws Exception {
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }
    private JsonNode clock() throws Exception { return ok(http.as("presenter").get(BASE + "/presenter/clock")); }
    private void advance(Instant to) throws Exception {
        ObjectNode input = ApptHttp.JSON.createObjectNode().put("commandId", "adv-" + ApptHttp.id())
                .put("expectedClockVersion", clock().get("clockVersion").asLong()).put("to", to.toString());
        ok(post("presenter", "/presenter/clock/advance", input));
    }
    private void sql(String sql, Object... args) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement p = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) p.setObject(i + 1, args[i]);
            p.executeUpdate();
        }
    }
    private String text(String sql, Object... args) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement p = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) p.setObject(i + 1, args[i]);
            try (var r = p.executeQuery()) { assertTrue(r.next()); return r.getString(1); }
        }
    }
    private long claims() throws Exception { return ApptHttp.count(dataSource.get(), "SELECT count(*) FROM manual_claims"); }
    private void draft(String who) throws Exception {
        JsonNode account = ok(http.as(who).get(BASE + "/manual/account"));
        assertEquals("ready", account.get("state").asText());
        ObjectNode input = ApptHttp.JSON.createObjectNode().put("commandId", "draft-" + ApptHttp.id())
                .put("expectedDraftVersion", 0).put("expectedContextVersion", account.get("contextVersion").asText());
        input.set("choices", ApptHttp.JSON.readTree(StockDbFixture.complete().toString().replace("paula", who)
                .replace("Paula Mason", who).replace("2026-11-12", "2026-11-30")));
        ok(post(who, "/manual/draft", input));
    }
    private ObjectNode claimInput(String who) throws Exception {
        JsonNode stock = ok(http.as(who).get(BASE + "/manual/stock"));
        for (JsonNode d : stock.get("decisions")) if ("eligible".equals(d.path("gateStatus").asText())) {
            return ((ObjectNode) d.get("claimInput")).deepCopy().put("commandId", "claim-" + ApptHttp.id());
        }
        throw new AssertionError("no eligible real browse result: " + stock);
    }
    private ObjectNode command(JsonNode hold) {
        return ApptHttp.JSON.createObjectNode().put("commandId", "cmd-" + ApptHttp.id())
                .put("holdId", hold.get("holdId").asText()).put("expectedHoldVersion", hold.get("version").asLong())
                .put("expectedDraftVersion", 1);
    }
    private void lineage(JsonNode value, ObjectNode input, Instant at) {
        JsonNode q = value.get("quote"), h = value.get("hold");
        assertEquals(input.get("orderUuid"), q.get("orderUuid"));
        assertEquals(q.get("orderUuid"), h.get("orderUuid"));
        assertEquals(at, Instant.parse(q.get("quotedAt").asText()));
        assertTrue(Instant.parse(q.get("validUntil").asText()).isAfter(at));
        assertEquals(at.plusSeconds(q.at("/timing/previewSeconds").asLong()), Instant.parse(h.get("expiresAt").asText()));
        assertEquals("gcsp-policy-v1", q.get("policyVersion").asText());
        assertEquals(input.get("expectedDraftVersion"), q.get("draftVersion"));
        assertEquals(input.get("expectedContextVersion"), q.get("contextVersion"));
        assertEquals(input.get("expectedTermsDigest"), q.get("termsDigest"));
    }

    @Test @Order(1)
    void aFreshQuoteBeforeWallTimeClaimsReviewsAndOrdersAtItsActualRunInstant() throws Exception {
        // A historical paused run is explicit test input, independent of the hour the covering batch starts.
        // No business timestamp exists yet; neither quotes nor holds are rebased or rewritten.
        assertEquals(0, claims());
        assertEquals(0, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM custody_holds"));
        initial = Instant.parse("2026-11-05T09:00:00Z");
        var run = persistence.guard().currentRun();
        ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, run.runId(), initial);
        assertTrue(loaded.ok(), loaded.problem());
        ClockConfiguration config = loaded.configuration();
        assertEquals(initial, config.startsAt(), "the historical input uses the canonical clock template");
        ObjectNode paused = (ObjectNode) ApptHttp.JSON.readTree(text("SELECT to_jsonb(c)::text FROM run_clocks c"));
        paused.put("clock_instant", initial.toString()).put("starts_at", initial.toString())
                .put("clock_version", config.initialClockVersion()).put("scenario_version", config.scenarioVersion())
                .put("fixture_version", config.fixtureVersion()).putNull("last_tick_id");
        ObjectNode named = paused.putObject("named_times");
        config.namedTimes().forEach((name, at) -> named.put(name, at.toString()));
        sql("TRUNCATE run_clocks");
        sql("INSERT INTO run_clocks SELECT (jsonb_populate_record(NULL::run_clocks, ?::jsonb)).*", paused.toString());
        assertEquals(initial, Instant.parse(clock().get("now").asText()));
        assertEquals(initial, claimClock.now(new RunContext(run.environmentId(), run.runId(), "probe")));
        assertTrue(initial.plusSeconds(7200).isBefore(Instant.now()));
        try (Connection c = dataSource.get().getConnection()) {
            List<JsonNode> rows = new ArrayList<>(StockDbFixture.rows());
            ObjectNode extra = rows.get(0).deepCopy();
            String id = StockDbFixture.UUID_PREFIX + "9";
            extra.put("orderUuid", id).put("orderNumber", "1000009");
            ((ObjectNode) extra.at("/facts/sourceKeys")).put("stockId", id);
            ((ObjectNode) extra.at("/facts/facts/eligibilityModelKey")).put("value", "U11 X1|20i");
            rows.add(extra);
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), rows);
        }
        draft("paula"); draft("alex");
        ObjectNode input = claimInput("paula");
        JsonNode held = ok(post("paula", "/manual/claim", input));
        lineage(held, input, initial);
        paulaHold = held.at("/hold/holdId").asText();
        String pinned = text("SELECT quote::text FROM manual_claims WHERE hold_id = ?", paulaHold);
        Response replay = post("paula", "/manual/claim", input);
        assertEquals(held, ok(replay));
        assertTrue(body(replay).get("replayed").asBoolean());
        assertEquals(403, post("alex", "/manual/claim/review", command(held.get("hold"))).statusCode());
        JsonNode review = ok(post("paula", "/manual/claim/review", command(held.get("hold"))));
        assertEquals(initial.plusSeconds(held.at("/quote/timing/reviewSeconds").asLong()),
                Instant.parse(review.at("/hold/expiresAt").asText()));
        JsonNode terms = ok(http.as("paula").get(BASE + "/manual/order/terms"));
        ObjectNode order = ApptHttp.JSON.createObjectNode().put("commandId", "order-" + ApptHttp.id())
                .put("expectedQuoteId", review.at("/quote/quoteId").asText())
                .put("expectedStockVersion", review.at("/quote/stockVersion").asLong())
                .put("termsDigest", terms.get("termsDigest").asText());
        order.set("source", command(review.get("hold")).remove(List.of("commandId")));
        ((ObjectNode) order.get("source")).put("type", "cart");
        order.putObject("declarations").put("terms", true).put("driver", true).put("return", true);
        JsonNode ordered = ok(post("paula", "/manual/order", order));
        assertEquals("acknowledged", ordered.get("status").asText());
        assertEquals(initial, Instant.parse(ordered.at("/selection/receivedAt").asText()));
        assertEquals(input.get("orderUuid"), ordered.at("/selection/orderUuid"));
        assertEquals(pinned, text("SELECT quote::text FROM manual_claims WHERE hold_id = ?", paulaHold));
        assertEquals(initial, Instant.parse(clock().get("now").asText()));
    }

    @Test @Order(2)
    void unchangedAndAheadPresenterTimeRetainPinnedInstantsAndExpireAtTheExactBoundary() throws Exception {
        ObjectNode input = claimInput("alex");
        JsonNode held = ok(post("alex", "/manual/claim", input));
        lineage(held, input, initial);
        String hold = held.at("/hold/holdId").asText();
        String pinned = text("SELECT quote::text FROM manual_claims WHERE hold_id = ?", hold);
        String expiry = held.at("/hold/expiresAt").asText();
        for (int i = 0; i < 2; i++) {
            JsonNode read = ok(http.as("alex").get(BASE + "/manual/claim"));
            assertEquals(expiry, read.at("/hold/expiresAt").asText());
        }
        advance(Instant.parse(expiry));
        JsonNode expired = ok(http.as("alex").get(BASE + "/manual/claim"));
        assertEquals("expired", expired.at("/hold/state").asText());
        assertEquals(expiry, expired.at("/hold/expiresAt").asText());
        assertEquals(pinned, text("SELECT quote::text FROM manual_claims WHERE hold_id = ?", hold));
        assertEquals(409, post("alex", "/manual/claim/review", command(held.get("hold"))).statusCode());
        Instant ahead = Instant.now().plusSeconds(3600).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        advance(ahead);
        ObjectNode fresh = claimInput("alex");
        JsonNode next = ok(post("alex", "/manual/claim", fresh));
        lineage(next, fresh, ahead);
        ObjectNode release = command(next.get("hold")).put("reason", "cancel");
        JsonNode released = ok(post("alex", "/manual/claim/release", release));
        assertEquals("released", released.at("/hold/state").asText());
        assertEquals(next.get("quote"), released.get("quote"));
    }

    @Test @Order(3)
    void unavailableAndForeignPersistedClocksNeverCreateNewClaimAuthorityOrRewriteExistingInstants() throws Exception {
        ObjectNode input = claimInput("alex");
        long before = claims();
        String pinned = text("SELECT jsonb_agg(jsonb_build_array(c.quote,c.valid_until,h.expires_at) ORDER BY c.hold_id)::text "
                + "FROM manual_claims c JOIN custody_holds h USING(environment_id,run_id,hold_id)");
        // Fault injection only in this test-owned schema; the actual clock adapter/SQL remains in use.
        sql("ALTER TABLE run_clocks RENAME TO f581_clock_saved");
        try {
            Response unreadable = post("alex", "/manual/claim", input);
            assertEquals(503, unreadable.statusCode(), unreadable.asString());
            assertEquals("clock-unavailable", body(unreadable).get("code").asText());
            sql("CREATE TABLE run_clocks (LIKE f581_clock_saved INCLUDING ALL)");
            try {
                Response missing = post("alex", "/manual/claim", input);
                assertEquals(503, missing.statusCode(), missing.asString());
                assertEquals("clock-unavailable", body(missing).get("code").asText());
                sql("INSERT INTO run_clocks SELECT (jsonb_populate_record(NULL::run_clocks, to_jsonb(c) "
                        + "|| jsonb_build_object('environment_id','foreign-env','run_id','foreign-run'))).* FROM f581_clock_saved c");
                Response foreign = post("alex", "/manual/claim", input);
                assertEquals(503, foreign.statusCode(), foreign.asString());
                assertEquals("clock-unavailable", body(foreign).get("code").asText());
            } finally { sql("DROP TABLE run_clocks"); }
        } finally { sql("ALTER TABLE f581_clock_saved RENAME TO run_clocks"); }
        var run = persistence.guard().currentRun();
        assertThrows(IllegalStateException.class, () -> claimClock.now(new RunContext("foreign-env", run.runId(), "probe")));
        assertThrows(IllegalStateException.class, () -> claimClock.now(new RunContext(run.environmentId(), "missing-run", "probe")));
        sql("INSERT INTO runs(environment_id,run_id,status,retired_at) VALUES (?, 'f581-retired', 'retired', now())", run.environmentId());
        assertThrows(IllegalStateException.class, () -> claimClock.now(new RunContext(run.environmentId(), "f581-retired", "probe")));
        assertEquals(before, claims());
        assertEquals(pinned, text("SELECT jsonb_agg(jsonb_build_array(c.quote,c.valid_until,h.expires_at) ORDER BY c.hold_id)::text "
                + "FROM manual_claims c JOIN custody_holds h USING(environment_id,run_id,hold_id)"));
        JsonNode valid = ok(post("alex", "/manual/claim", input));
        assertEquals("active", valid.at("/hold/state").asText());
        ok(post("alex", "/manual/claim/release", command(valid.get("hold")).put("reason", "cancel")));
    }
}
