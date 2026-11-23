package gcsp.api.activity;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.allocation.Allocation;
import gcsp.api.allocation.AllocationResult;
import gcsp.api.allocation.AllocationScope;
import gcsp.api.allocation.Trigger;
import gcsp.api.persistence.Canonical;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/** GET /api/gcsp/v1/activity over real JWTs, native PostgreSQL and one real allocation. */
@QuarkusTest
@TestProfile(ActivityProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ActivityHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String URL = "/api/gcsp/v1/activity";
    private static final String ENV = "test-env";
    private static final String PAULA = "employee-paula";
    private static final String OTHER = "E-1002";
    private static final Instant NOW = Instant.parse("2026-11-14T09:00:00Z");
    private static final Pattern INSTANT = Pattern.compile("^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d+)?Z$");
    private static final List<String> STATES = List.of("no-brief", "paused", "offer", "offer-closed", "searching", "never-searched");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Allocation allocation;

    @Inject
    AgroalDataSource dataSource;

    @Test
    @Order(1)
    void refusesWithoutBearerForGregAndPresenterAndForAnyQuery() throws Exception {
        given().when().get(URL).then().statusCode(401).body("code", equalTo("bearer-missing"));
        given().header("Authorization", "Bearer " + token("sub-greg")).when().get(URL).then().statusCode(403)
                .body("status", equalTo("forbidden"));
        given().header("Authorization", "Bearer " + token("sub-presenter")).when().get(URL).then().statusCode(403);
        given().header("Authorization", "Bearer " + token("sub-employee-a")).queryParam("runId", "run-1").when().get(URL).then()
                .statusCode(400).body("code", equalTo("unsupported-query")).header("Cache-Control", equalTo("no-store"));
    }

    @Test
    @Order(2)
    void anEmployeeWithNoBriefHasAnEmptyProjectionAndNoTickMeansNotChecked() throws Exception {
        // No clock row yet: the run clock is unavailable and the route says so, retryably.
        if (count("SELECT count(*) FROM run_clocks") == 0) {
            given().header("Authorization", "Bearer " + token("sub-employee-b")).when().get(URL).then().statusCode(503)
                    .body("code", equalTo("clock-unavailable")).body("retryable", equalTo(true));
            update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                    + "fixture_version, starts_at, named_times) VALUES (?, 'run-1', ?, 7, 's1', 'f1', ?, '{}'::jsonb)",
                    ENV, ts(NOW), ts(NOW));
        }
        update("UPDATE run_clocks SET last_tick_id = NULL WHERE environment_id = ?", ENV);
        Response r = get("sub-employee-b");
        r.then().statusCode(200).header("Cache-Control", equalTo("no-store")).body("status", equalTo("ok"));
        JsonNode v = JSON.readTree(r.asString()).get("value");
        assertEquals("no-brief", v.get("state").textValue());
        assertTrue(v.get("permission").isNull());
        assertTrue(v.get("briefVersion").isNull());
        assertTrue(v.get("lastSuccessfulCheck").isNull());
        assertTrue(v.get("currentOffer").isNull());
        assertEquals("not-recorded", v.get("searchEvidence").get("status").textValue());
        assertEquals(0, v.get("offers").size());
        assertEquals("not-recorded", v.get("stateChangesEvidence").get("status").textValue());
        assertEquals("not-checked", v.get("sourceStatus").textValue());
        assertParses(v, OTHER);
    }

    @Test
    @Order(3)
    void anEngagedEmployeeSeesTheirOwnOfferCheckAndChangesAndNobodyElse() throws Exception {
        // The brief row was seeded without its outbox event: add the producer's event, and one that matches no brief.
        update("INSERT INTO command_receipts (environment_id, run_id, actor_id, command_id, command_type, input_digest, result, "
                + "run_revision) VALUES (?, 'run-1', ?, 'activity-seed', 'brief.confirm', ?, '{}'::jsonb, 1)", ENV, "employee:" + PAULA,
                "0".repeat(64));
        update("INSERT INTO outbox_events (environment_id, run_id, event_id, actor_id, command_id, event_type, payload, run_revision) "
                + "VALUES (?, 'run-1', ?, ?, 'activity-seed', 'brief-changed', ?::jsonb, 1)", ENV, "brief:" + PAULA + ":1",
                "employee:" + PAULA, "{\"operation\":\"confirmed\",\"briefVersion\":1,\"previousBriefVersion\":null,\"employeeId\":\"" + PAULA + "\"}");
        update("INSERT INTO outbox_events (environment_id, run_id, event_id, actor_id, command_id, event_type, payload, run_revision) "
                + "VALUES (?, 'run-1', ?, ?, 'activity-seed', 'brief-changed', ?::jsonb, 1)", ENV, "brief:" + PAULA + ":9",
                "employee:" + PAULA, "{\"operation\":\"engaged\",\"briefVersion\":9,\"previousBriefVersion\":8,\"employeeId\":\"" + PAULA + "\"}");
        AllocationScope scope = new AllocationScope(ENV, "run-1", "gcsp-policy-v1", NOW, 1);
        AllocationResult.Completed done = assertInstanceOf(AllocationResult.Completed.class,
                allocation.service().allocate(scope, new Trigger("stock-released", "activity-stock-1", List.of(), List.of())));

        JsonNode v = JSON.readTree(get("sub-employee-a").then().statusCode(200).extract().asString()).get("value");
        assertParses(v, PAULA);
        assertEquals("offer", v.get("state").textValue());
        assertEquals(1, v.get("briefVersion").longValue());
        assertTrue(v.get("permission").get("canSearch").booleanValue() && v.get("permission").get("canHold").booleanValue());
        String offerId = text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", PAULA);
        JsonNode current = v.get("currentOffer");
        assertEquals(offerId, current.get("offerRef").get("offerId").textValue());
        assertEquals("/gcsp/offers/" + offerId.replace(":", "%3A") + "?runId=run-1", current.get("href").textValue());
        assertEquals("active", current.get("state").textValue());
        assertEquals(1, v.get("offers").size());
        JsonNode check = v.get("lastSuccessfulCheck");
        assertEquals("offer-held", check.get("outcome").textValue());
        assertTrue(check.get("carsChecked").intValue() >= 1 && check.get("suitableCars").intValue() >= 1);
        assertEquals("1", check.get("clockVersion").textValue());
        assertEquals(text("SELECT clock_version FROM run_clocks"), v.get("clockVersion").textValue());
        assertNotNull(done.allocationId());
        assertEquals(1, v.get("searchEvidence").get("checks").intValue());
        assertEquals("recorded", v.get("searchEvidence").get("status").textValue());
        assertEquals(1, v.get("stateChanges").size());
        assertEquals("brief:" + PAULA + ":1", v.get("stateChanges").get(0).get("eventId").textValue());
        assertEquals("confirmed", v.get("stateChanges").get(0).get("operation").textValue());
        assertTrue(v.get("stateChanges").get(0).get("previousBriefVersion").isNull());
        assertEquals("incomplete", v.get("stateChangesEvidence").get("status").textValue());
        assertEquals(1, v.get("stateChangesEvidence").get("rejectedReceipts").intValue());

        // The other employee evaluated nothing and was offered nothing: none of it shows for them.
        JsonNode other = JSON.readTree(get("sub-employee-b").then().statusCode(200).extract().asString()).get("value");
        assertEquals("no-brief", other.get("state").textValue());
        assertTrue(other.get("currentOffer").isNull() && other.get("lastSuccessfulCheck").isNull());
        assertEquals(0, other.get("offers").size());
        assertEquals(0, other.get("stateChanges").size());
        assertFalse(other.toString().contains(offerId));
        assertFalse(other.toString().contains(PAULA));
    }

    @Test
    @Order(4)
    void sourceStatusFollowsTheRunsLatestTick() throws Exception {
        String order = "[{\"handlerId\":\"release\",\"stage\":\"release-pull\"},{\"handlerId\":\"buddy-allocation\",\"stage\":\"buddy-allocation\"}]";
        String ok = "{\"status\":\"ok\",\"value\":{}}";
        tick("t-ok", "completed", order, "[{\"handlerId\":\"release\",\"stage\":\"release-pull\",\"outcome\":" + ok
                + "},{\"handlerId\":\"buddy-allocation\",\"stage\":\"buddy-allocation\",\"outcome\":" + ok + "}]");
        assertEquals("ok", status());
        tick("t-bad", "interrupted", order, "[{\"handlerId\":\"release\",\"stage\":\"release-pull\",\"outcome\":{\"status\":\"unavailable\","
                + "\"code\":\"x\",\"retryable\":true}}]");
        assertEquals("unavailable", status());
    }

    @Test
    @Order(5)
    void offerHrefKeepsEncodedIdentityAndRunWhenActiveAndExpired() throws Exception {
        String offerId = "offer /+?#%é";
        Instant created = Instant.parse(text("SELECT to_char(max(created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') FROM buddy_offers"));
        seedOffer("run-1", PAULA, offerId, created.plusSeconds(1));
        seedOffer("run-1", OTHER, "other-employee-offer", created.plusSeconds(2));
        update("INSERT INTO runs (environment_id, run_id, status, retired_at) VALUES (?, 'other-run', 'retired', now())", ENV);
        seedOffer("other-run", PAULA, "other-run-offer", created.plusSeconds(3));

        String href = "/gcsp/offers/offer%20%2F%2B%3F%23%25%C3%A9?runId=run-1";
        for (String state : List.of("active", "expired")) {
            if (state.equals("expired")) update("UPDATE buddy_offers SET state = 'expired', version = version + 1 "
                    + "WHERE environment_id = ? AND run_id = 'run-1' AND offer_id = ?", ENV, offerId);
            JsonNode value = JSON.readTree(get("sub-employee-a").then().statusCode(200).extract().asString()).get("value");
            assertEquals("run-1", value.get("runId").textValue());
            assertEquals(PAULA, value.get("employeeId").textValue());
            JsonNode current = value.get("currentOffer");
            assertEquals(offerId, current.get("offerRef").get("offerId").textValue());
            assertEquals(href, current.get("href").textValue());
            assertEquals(state, current.get("state").textValue());
            assertEquals(state.equals("active") ? 1 : 2, current.get("version").intValue());
            assertEquals(2, value.get("offers").size());
            assertFalse(value.toString().contains("other-employee-offer"));
            assertFalse(value.toString().contains("other-run-offer"));
            JsonNode other = JSON.readTree(get("sub-employee-b").then().statusCode(200).extract().asString()).get("value");
            assertEquals("other-employee-offer", other.get("currentOffer").get("offerRef").get("offerId").textValue());
            assertEquals(1, other.get("offers").size());
            assertFalse(other.toString().contains(offerId));
        }
    }

    private void seedOffer(String run, String employee, String id, Instant created) throws SQLException {
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                ENV, run, employee);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, ?, ?, 1)",
                ENV, run, id, employee);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                + "VALUES (?, ?, ?, 'config-1', 'held')", ENV, run, id);
        update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, input_digest, "
                + "state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, ?, 'stock-released', ?, ?, 'pending', ?, 1, 'policy-1', '{}'::jsonb, 0)",
                ENV, run, id, id, "0".repeat(64), ts(created));
        update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, slot_id, "
                + "configuration_id, policy_version, quoted_at, quote) VALUES (?, ?, ?, ?, ?, ?, ?, 'config-1', 'policy-1', ?, '{}'::jsonb)",
                ENV, run, id, id, id, employee, id, ts(created));
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'buddy-offer', 'active', ?)",
                ENV, run, id, id, employee, id, ts(created.plusSeconds(7200)));
        update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, "
                + "state, brief_version, policy_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, 'policy-1', ?, ?)",
                ENV, run, id, id, id, employee, id, ts(created.plusSeconds(7200)), ts(created));
    }

    private String status() throws Exception {
        return JSON.readTree(get("sub-employee-a").then().statusCode(200).extract().asString()).get("value").get("sourceStatus").textValue();
    }

    private void tick(String id, String state, String order, String outcomes) throws SQLException {
        update("INSERT INTO clock_ticks (environment_id, run_id, tick_id, kind, input_digest, target_now, target_clock_version, "
                + "policy_version, handler_order, missing_stages, outcomes, state) VALUES (?, 'run-1', ?, 'presenter', ?, ?, 7, 'p', "
                + "?::jsonb, '[]'::jsonb, ?::jsonb, ?)", ENV, id, Canonical.digest(JSON.getNodeFactory().textNode(id)), ts(NOW), order,
                outcomes, state);
        update("UPDATE run_clocks SET last_tick_id = ? WHERE environment_id = ? AND run_id = 'run-1'", id, ENV);
    }

    /** The rules of activity.client.ts for the fields it requires. */
    private static void assertParses(JsonNode v, String employeeId) {
        assertEquals("run-1", v.get("runId").textValue());
        assertEquals(employeeId, v.get("employeeId").textValue());
        assertTrue(INSTANT.matcher(v.get("asOf").textValue()).matches());
        assertTrue(v.get("clockVersion").isTextual() && !v.get("clockVersion").textValue().isEmpty());
        JsonNode brief = v.get("briefVersion");
        assertTrue(brief.isNull() || brief.isIntegralNumber() && brief.longValue() > 0);
        assertEquals(brief.isNull(), v.get("permission").isNull());
        assertTrue(STATES.contains(v.get("state").textValue()));
        assertTrue(List.of("not-checked", "evidence-unavailable", "unavailable", "delayed", "ok").contains(v.get("sourceStatus").textValue()));
        assertTrue(v.get("offers").isArray() && v.get("stateChanges").isArray());
        if (!v.get("permission").isNull()) {
            for (String k : List.of("searchConsent", "holdConsent", "paused", "canSearch", "canHold")) assertTrue(v.get("permission").get(k).isBoolean(), k);
            assertTrue(v.get("permission").get("permissionVersion").longValue() > 0);
        }
        for (JsonNode o : v.get("offers")) assertOffer(o);
        if (!v.get("currentOffer").isNull()) {
            assertOffer(v.get("currentOffer"));
            assertTrue(v.get("currentOffer").get("href").textValue().startsWith("/gcsp/"));
        }
        if (!v.get("lastSuccessfulCheck").isNull()) {
            JsonNode c = v.get("lastSuccessfulCheck");
            assertTrue(INSTANT.matcher(c.get("checkedAt").textValue()).matches() && c.get("clockVersion").isTextual());
            assertTrue(c.get("carsChecked").intValue() >= 0 && c.get("suitableCars").intValue() <= c.get("carsChecked").intValue());
            assertTrue(c.get("exclusions").isArray());
            assertTrue(List.of("offer-held", "no-match").contains(c.get("outcome").textValue()));
        }
        for (JsonNode s : v.get("stateChanges")) {
            assertEquals("brief-changed", s.get("eventType").textValue());
            assertTrue(s.get("briefVersion").longValue() > 0 && INSTANT.matcher(s.get("occurredAt").textValue()).matches());
            assertTrue(s.has("previousBriefVersion"));
        }
        assertTrue(List.of("incomplete", "recorded", "not-recorded").contains(v.get("stateChangesEvidence").get("status").textValue()));
        assertTrue(v.get("stateChangesEvidence").get("rejectedReceipts").intValue() >= 0);
    }

    private static void assertOffer(JsonNode o) {
        assertFalse(o.get("offerRef").get("offerId").textValue().isEmpty());
        assertTrue(o.get("version").longValue() > 0);
        assertTrue(o.get("briefVersion").isNull() || o.get("briefVersion").longValue() > 0);
        assertTrue(INSTANT.matcher(o.get("createdAt").textValue()).matches() && INSTANT.matcher(o.get("expiresAt").textValue()).matches());
        for (String k : List.of("holdId", "orderUuid", "policyVersion", "quoteId")) assertFalse(o.get(k).textValue().isEmpty(), k);
    }

    private Response get(String subject) throws Exception {
        return given().header("Authorization", "Bearer " + token(subject)).when().get(URL);
    }

    private String token(String subject) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer("https://issuer.test/realms/gcsp");
        claims.setAudience("gcsp-api");
        claims.setSubject(subject);
        claims.setExpirationTimeMinutesInTheFuture(10);
        claims.setIssuedAtToNow();
        claims.setClaim("azp", "gcsp-web");
        claims.setClaim("scope", "openid gcsp-api");
        claims.setClaim("realm_access", Map.of("roles", List.of(subject.equals("sub-greg") ? "greg" : subject.equals("sub-presenter") ? "presenter" : "employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private static java.sql.Timestamp ts(Instant i) {
        return java.sql.Timestamp.from(i);
    }

    private void update(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            ps.executeUpdate();
        }
    }

    private String text(String sql, Object... parameters) throws SQLException {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                String value = rs.getString(1);
                assertNotNull(value);
                return value;
            }
        }
    }

    private long count(String sql) throws SQLException {
        return Long.parseLong(text(sql));
    }
}
