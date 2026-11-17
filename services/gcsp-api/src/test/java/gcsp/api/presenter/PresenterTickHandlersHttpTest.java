package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** A presenter tick through the started app expires a due manual claim and a due Buddy hold, and replays by tick id. */
@QuarkusTest
@TestProfile(PresenterClockProfiles.Handlers.class)
class PresenterTickHandlersHttpTest {

    private static final String POLICY = "gcsp-policy-v1";
    private static final String DIGEST = "0".repeat(64);

    /** The profile's schema as the running app sees it; the profile's own constant is per class loader. */
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    @Test
    void aTickExpiresADueManualClaimAndADueBuddyHoldAndReplaysByTickId() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        String presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        JsonPath clock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        long version = clock.getLong("value.clockVersion");
        String run = clock.getString("value.runId");
        String env = text("SELECT environment_id FROM runs WHERE run_id = ?", run);
        // Both stock authorities read their own clock for "now"; due before either is due on both.
        Instant due = Instant.parse(clock.getString("value.now")).minusSeconds(3600);
        if (due.isAfter(Instant.now().minusSeconds(3600))) due = Instant.now().minusSeconds(3600);

        seedManualClaim(env, run, due);
        seedBuddyHold(env, run, due);
        assertEquals("active", text("SELECT state FROM custody_holds WHERE hold_id = 'h-manual'", null));
        assertEquals("active", text("SELECT state FROM custody_holds WHERE hold_id = 'h-buddy'", null));

        post(presenter, "/clock/advance", "{\"commandId\":\"adv-" + UUID.randomUUID() + "\",\"expectedClockVersion\":"
                + version + ",\"bySeconds\":5}").then().statusCode(200);
        long ticked = get(presenter, "/clock").jsonPath().getLong("value.clockVersion");
        String tickId = "tick-" + UUID.randomUUID();
        String body = "{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":" + ticked + "}";
        JsonPath first = post(presenter, "/clock/tick", body).then().statusCode(200).extract().jsonPath();
        assertEquals("completed", first.getString("value.state"));
        assertTrue(first.getInt("value.outcomes.find { it.handlerId == 'manual-claim-expiry' }.outcome.value.expired") >= 1);
        assertEquals("ok", first.getString("value.outcomes.find { it.handlerId == 'manual-claim-expiry' }.outcome.status"));
        assertEquals(1, first.getInt("value.outcomes.find { it.handlerId == 'buddy-expiry' }.outcome.value.expired"));

        assertEquals("expired", text("SELECT state FROM custody_holds WHERE hold_id = 'h-manual'", null));
        assertEquals("expiry", text("SELECT release_reason FROM manual_claims WHERE hold_id = 'h-manual'", null));
        assertEquals("expired", text("SELECT state FROM custody_holds WHERE hold_id = 'h-buddy'", null));
        assertEquals("expired", text("SELECT state FROM buddy_offers WHERE hold_id = 'h-buddy'", null));
        String manualVersion = text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-manual'", null);
        String buddyVersion = text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-buddy'", null);

        JsonPath replay = post(presenter, "/clock/tick", body).then().statusCode(200).extract().jsonPath();
        assertEquals(first.getString("value.outcomes"), replay.getString("value.outcomes"));
        assertEquals(manualVersion, text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-manual'", null));
        assertEquals(buddyVersion, text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-buddy'", null));

        // After a further advance the next tick finds nothing left to expire: the effect is not repeated.
        post(presenter, "/clock/advance", "{\"commandId\":\"adv-" + UUID.randomUUID() + "\",\"expectedClockVersion\":"
                + ticked + ",\"bySeconds\":5}").then().statusCode(200);
        long next = get(presenter, "/clock").jsonPath().getLong("value.clockVersion");
        JsonPath later = post(presenter, "/clock/tick", "{\"tickId\":\"tick-" + UUID.randomUUID()
                + "\",\"expectedClockVersion\":" + next + "}").then().statusCode(200).extract().jsonPath();
        assertEquals(0, later.getInt("value.outcomes.find { it.handlerId == 'manual-claim-expiry' }.outcome.value.expired"));
        assertEquals(0, later.getInt("value.outcomes.find { it.handlerId == 'buddy-expiry' }.outcome.value.expired"));
        assertEquals(manualVersion, text("SELECT version::text FROM custody_holds WHERE hold_id = 'h-manual'", null));
    }

    private void seedManualClaim(String env, String run, Instant due) throws Exception {
        employee(env, run, "e-manual");
        car(env, run, "car-manual");
        hold(env, run, "h-manual", "car-manual", "e-manual", "cart", "{}", due);
        update("INSERT INTO manual_claims (environment_id, run_id, hold_id, employee_id, slot_id, order_uuid, mode, phase, "
                + "policy_version, draft_version, context_version, terms_digest, quote, quoted_at, valid_until) "
                + "VALUES (?, ?, 'h-manual', 'e-manual', 'slot-e-manual', 'car-manual', 'local', 'preview', ?, 1, 'ctx-1', "
                + "?, '{}'::jsonb, ?::timestamptz, ?::timestamptz)", env, run, POLICY, DIGEST, due.toString(), due.toString());
    }

    private void seedBuddyHold(String env, String run, Instant due) throws Exception {
        employee(env, run, "e-buddy");
        car(env, run, "car-buddy");
        update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, "
                + "input_digest, state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, 'alloc-seed', 'stock-released', 'evt-seed', ?, 'pending', now(), 1, ?, '{}'::jsonb, 0)",
                env, run, DIGEST, POLICY);
        update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, slot_id, "
                + "configuration_id, policy_version, quoted_at, quote) VALUES (?, ?, 'q-buddy', 'alloc-seed', 'car-buddy', "
                + "'e-buddy', 'slot-e-buddy', 'cfg-1', ?, now(), '{}'::jsonb)", env, run, POLICY);
        String attributes = "{\"quoteId\":\"q-buddy\",\"offerId\":\"o-buddy\",\"policyVersion\":\"" + POLICY + "\"}";
        hold(env, run, "h-buddy", "car-buddy", "e-buddy", "buddy-offer", attributes, due);
        update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, state, "
                + "brief_version, policy_version, expires_at) VALUES (?, ?, 'o-buddy', 'h-buddy', 'q-buddy', 'e-buddy', "
                + "'car-buddy', 'active', 1, ?, ?::timestamptz)", env, run, POLICY, due.toString());
    }

    private void employee(String env, String run, String id) throws Exception {
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?)", env, run, id);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) VALUES (?, ?, ?, ?, 1)",
                env, run, "slot-" + id, id);
    }

    private void car(String env, String run, String orderUuid) throws Exception {
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, 'cfg-1', 'released', '{}'::jsonb)", env, run, orderUuid);
    }

    private void hold(String env, String run, String holdId, String orderUuid, String employee, String type,
            String attributes, Instant expiresAt) throws Exception {
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at, attributes) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', ?::timestamptz, ?::jsonb)",
                env, run, holdId, orderUuid, employee, "slot-" + employee, type, expiresAt.toString(), attributes);
    }

    private void update(String sql, String... args) throws Exception {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setString(i + 1, args[i]);
            ps.executeUpdate();
        }
    }

    private String text(String sql, String arg) throws Exception {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            if (arg != null) ps.setString(1, arg);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private Connection connect() throws Exception {
        Connection c = PresenterClockProfiles.plain().getConnection();
        c.createStatement().execute("SET search_path TO " + schema);
        return c;
    }
}
