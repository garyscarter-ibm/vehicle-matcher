package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.Persistence;
import gcsp.api.scenario.ScenarioWiring;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import gcsp.api.supply.SupplyDevCompositionProfile;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Main's frozen starting inputs and actual release handlers over signed OIDC and an isolated PostgreSQL schema. */
@QuarkusTest
@TestProfile(PresenterScenarioMainHttpTest.Main.class)
class PresenterScenarioMainHttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SCENARIO = "main-successful-journey";
    private static final String POLICY = "gcsp-policy-v1+offer-journey-v1";
    private static String ownedSchema;

    public static class Main extends SupplyDevCompositionProfile {
        private static final String SCHEMA = "gcsp_s_pclock_main_" + Long.toHexString(System.nanoTime());

        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = super.getConfigOverrides();
            c.put("gcsp.environment.policy-version", POLICY);
            c.put("gcsp.allocation.candidates.provider", "recommendation");
            c.put("gcsp.mail.transport", "");
            c.put("gcsp.notify.drain-interval", "10m");
            if (System.getenv("GCSP_TEST_DATABASE_URL") != null) {
                c.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", SCHEMA);
                c.put("quarkus.flyway.schemas", SCHEMA);
                c.put("quarkus.flyway.default-schema", SCHEMA);
            }
            return c;
        }
    }

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    ScenarioWiring scenarios;

    @Inject
    PolicyService policy;

    String presenter;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
    }

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    @Test
    void mainStartsWithTheFrozenBriefThenRealReleaseProducesTheOfferAndCapturedNotification() throws Exception {
        get(presenter, "/scenarios").then().statusCode(200)
                .body("value.scenarios.find { it.scenarioId == '" + SCENARIO + "' }.availability.available", equalTo(true))
                .body("value.scenarios.find { it.scenarioId == '" + SCENARIO + "' }.availability.missingCapabilities.size()", equalTo(0));
        String retired = current().getString("value.runId");
        String body = resetBody(id(), retired);
        JsonPath reset = post(presenter, "/scenarios/reset", body).then().statusCode(200)
                .body("value.replayed", equalTo(false)).body("value.scenario.scenarioId", equalTo(SCENARIO))
                .extract().jsonPath();
        String run = reset.getString("value.activatedRunId");
        assertNotEquals(retired, run);
        assertEquals(run, current().getString("value.runId"));
        assertFrozenBrief(run);
        for (String table : new String[] {"stock_cars", "stock_releases", "custody_holds", "buddy_offers", "notification_deliveries"}) {
            assertEquals(0, count(run, "SELECT count(*) FROM " + table + " WHERE run_id = ?"), table);
        }
        assertEquals(0, count(run, "SELECT count(*) FROM outbox_events WHERE run_id = ? AND event_type LIKE 'notification.%'"));
        assertResetReplay(body, run);

        JsonPath clock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        Instant release = Instant.parse(clock.getString("value.namedTimes.release"));
        assertTrue(Instant.parse(clock.getString("value.now")).isBefore(release));
        String releaseBody = "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":"
                + clock.getLong("value.clockVersion") + ",\"mode\":\"next-release\"}";
        JsonPath released = post(presenter, "/controls/tick", releaseBody).then().statusCode(200)
                .body("value.advance.now", equalTo(clock.getString("value.namedTimes.release"))).body("value.tick.state", equalTo("completed"))
                .body("value.tick.outcomes.find { it.handlerId == 'stock-release' }.outcome.value.kind", equalTo("stock-released"))
                .body("value.tick.outcomes.find { it.handlerId == 'stock-release' }.outcome.value.windowId", equalTo("demo-release-1"))
                .body("value.tick.outcomes.find { it.handlerId == 'buddy-allocation' }.outcome.status", equalTo("ok"))
                .body("value.tick.outcomes.find { it.handlerId == 'captured-outbox' }.outcome.status", equalTo("ok"))
                .extract().jsonPath();
        assertEquals(6, count(run, "SELECT count(*) FROM stock_cars WHERE run_id = ?"));
        assertEquals(1, count(run, "SELECT count(*) FROM buddy_offers o JOIN custody_holds h USING "
                + "(environment_id, run_id, hold_id) WHERE o.run_id = ? AND o.employee_id = 'employee-paula' "
                + "AND o.state = 'active' AND o.brief_version = 1 AND h.state = 'active' AND h.hold_type = 'buddy-offer' "
                + "AND o.order_uuid = h.order_uuid"));
        assertEquals(1, count(run, "SELECT count(*) FROM notification_deliveries d JOIN outbox_events e USING "
                + "(environment_id, run_id, event_id) WHERE d.run_id = ? AND d.state = 'sent' AND d.transport = 'captured' "
                + "AND e.payload->>'recipientEmployeeId' = 'employee-paula'"));
        get(presenter, "/outbox").then().statusCode(200).body("value.runId", equalTo(run))
                .body("value.messages.find { it.recipient.employeeId == 'employee-paula' }.transport", equalTo("captured"));
        long revision = count(run, "SELECT revision FROM runs WHERE run_id = ?");
        post(presenter, "/controls/tick", releaseBody).then().statusCode(200)
                .body("value.tick.tickId", equalTo(released.getString("value.tick.tickId")));
        assertEquals(revision, count(run, "SELECT revision FROM runs WHERE run_id = ?"));
        assertResetReplay(body, run);
        assertEquals(clock.getString("value.namedTimes.release"), get(presenter, "/clock").jsonPath().getString("value.now"));
        assertEquals(1, count(run, "SELECT count(*) FROM buddy_offers WHERE run_id = ?"));
        assertFrozenBrief(run);
    }

    @Test
    void mainRefusesStaleVersionsAndChangedResetInputsBeforeWriting() throws Exception {
        String run = current().getString("value.runId");
        String body = resetBody(id(), run);
        post(presenter, "/scenarios/reset", body.replace("main-successful-journey-inputs-v2", "old"))
                .then().statusCode(409).body("code", equalTo("stale-version"))
                .body("field", equalTo("fixtureVersion")).body("currentVersion", equalTo("main-successful-journey-inputs-v2"));
        assertEquals(run, current().getString("value.runId"));
        String activated = post(presenter, "/scenarios/reset", body).then().statusCode(200)
                .extract().jsonPath().getString("value.activatedRunId");
        post(presenter, "/scenarios/reset", body.replace(run, activated)).then().statusCode(409)
                .body("code", equalTo("command-input-changed"));
        post(presenter, "/scenarios/reset", resetBody(id(), run)).then().statusCode(409)
                .body("code", equalTo("stale-run"));
        assertEquals(activated, current().getString("value.runId"));
        assertFrozenBrief(activated);
    }

    @Test
    void interruptedMainPreparationResumesTheSameActivatedRunAndOnlyConfirmsOneBrief() throws Exception {
        String retired = current().getString("value.runId");
        String body = resetBody(id(), retired);
        try (Connection c = connection()) {
            c.createStatement().execute("ALTER TABLE brief_heads RENAME TO unavailable_brief_heads");
            try {
                post(presenter, "/scenarios/reset", body).then().statusCode(503)
                        .body("code", equalTo("scenario-preparation-incomplete"));
            } finally {
                c.createStatement().execute("ALTER TABLE unavailable_brief_heads RENAME TO brief_heads");
            }
        }
        String pending = current().getString("value.runId");
        assertNotEquals(retired, pending);
        assertEquals(1, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ? "
                + "AND scenario_id = 'main-successful-journey' AND state = 'preparing'"));
        assertEquals(0, count(pending, "SELECT count(*) FROM briefs WHERE run_id = ?"));
        JsonPath frozenClock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        long frozenVersion = frozenClock.getLong("value.clockVersion");
        String[] paths = {"/clock/advance", "/controls/tick", "/clock/tick"};
        String[] commands = {
                "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":" + frozenVersion + ",\"to\":\"release\"}",
                "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":" + frozenVersion + ",\"mode\":\"next-release\"}",
                "{\"tickId\":\"" + id() + "\",\"expectedClockVersion\":" + frozenVersion + "}"
        };
        for (int i = 0; i < paths.length; i++) {
            post(presenter, paths[i], commands[i]).then().statusCode(503)
                    .body("code", equalTo("scenario-preparation-incomplete")).body("retryable", equalTo(true));
            JsonPath unchanged = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
            assertEquals(frozenClock.getString("value.now"), unchanged.getString("value.now"));
            assertEquals(frozenVersion, unchanged.getLong("value.clockVersion"));
            assertEquals(0, count(pending, "SELECT count(*) FROM stock_cars WHERE run_id = ?"));
            assertEquals(0, count(pending, "SELECT count(*) FROM buddy_offers WHERE run_id = ?"));
        }
        post(presenter, "/scenarios/reset", body).then().statusCode(200)
                .body("value.activatedRunId", equalTo(pending)).body("value.replayed", equalTo(true));
        assertEquals(1, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ? AND state = 'prepared'"));
        assertEquals(1, count(pending, "SELECT count(*) FROM run_resets WHERE activated_run_id = ?"));
        assertFrozenBrief(pending);
        assertResetReplay(body, pending);
        JsonPath preparedClock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        assertEquals(frozenClock.getString("value.now"), preparedClock.getString("value.now"));
        assertEquals(frozenVersion, preparedClock.getLong("value.clockVersion"));
        String oneSecondLater = new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
                .format(Instant.parse(preparedClock.getString("value.now")).plusSeconds(1));
        post(presenter, "/clock/advance", "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":"
                + preparedClock.getLong("value.clockVersion") + ",\"bySeconds\":1}").then().statusCode(200)
                .body("value.now", equalTo(oneSecondLater));
        JsonPath advanced = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        post(presenter, "/controls/tick", "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":"
                + advanced.getLong("value.clockVersion") + ",\"mode\":\"next-release\"}").then().statusCode(200)
                .body("value.advance.now", equalTo(preparedClock.getString("value.namedTimes.release")))
                .body("value.tick.state", equalTo("completed"));
        assertEquals(1, count(pending, "SELECT count(*) FROM buddy_offers WHERE run_id = ? AND employee_id = 'employee-paula' AND state = 'active'"));
    }

    @Test
    void failureBeforeTheScenarioMarkerWaitsThroughTheStartupPassThenReplaysTheOriginalMainReset() throws Exception {
        String retired = current().getString("value.runId");
        String body = resetBody(id(), retired);
        try (Connection c = connection()) {
            c.createStatement().execute("ALTER TABLE employees RENAME TO unavailable_employees");
            try {
                post(presenter, "/scenarios/reset", body).then().statusCode(503)
                        .body("code", equalTo("scenario-preparation-incomplete"));
            } finally {
                c.createStatement().execute("ALTER TABLE unavailable_employees RENAME TO employees");
            }
        }
        String pending = current().getString("value.runId");
        assertNotEquals(retired, pending);
        assertEquals(0, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ?"));
        assertEquals(0, count(pending, "SELECT count(*) FROM employees WHERE run_id = ?"));
        JsonPath frozenClock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        ClockResult.Failure startup = assertInstanceOf(ClockResult.Failure.class, scenarios.startupPass());
        assertEquals("scenario-preparation-incomplete", startup.code());
        assertTrue(startup.retryable());
        assertEquals(pending, current().getString("value.runId"));
        assertEquals(0, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ?"));
        assertEquals(0, count(pending, "SELECT count(*) FROM employees WHERE run_id = ?"));
        JsonPath afterStartup = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        assertEquals(frozenClock.getString("value.now"), afterStartup.getString("value.now"));
        assertEquals(frozenClock.getLong("value.clockVersion"), afterStartup.getLong("value.clockVersion"));

        post(presenter, "/scenarios/reset", body).then().statusCode(200)
                .body("value.activatedRunId", equalTo(pending)).body("value.replayed", equalTo(true));
        assertEquals(pending, current().getString("value.runId"));
        assertEquals(SCENARIO, current().getString("value.currentScenario.scenarioId"));
        assertFrozenBrief(pending);
        JsonPath preparedClock = get(presenter, "/clock").then().statusCode(200).extract().jsonPath();
        assertEquals(frozenClock.getString("value.now"), preparedClock.getString("value.now"));
        assertEquals(frozenClock.getLong("value.clockVersion"), preparedClock.getLong("value.clockVersion"));
        post(presenter, "/controls/tick", "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":"
                + preparedClock.getLong("value.clockVersion") + ",\"mode\":\"next-release\"}").then().statusCode(200)
                .body("value.advance.now", equalTo(preparedClock.getString("value.namedTimes.release")))
                .body("value.tick.state", equalTo("completed"));
        assertEquals(1, count(pending, "SELECT count(*) FROM buddy_offers WHERE run_id = ? AND employee_id = 'employee-paula' AND state = 'active'"));
    }

    @Test
    void failedRequiredAdoptionLeavesMainUnpreparedAndTheSameResetRecoversIt() throws Exception {
        String retired = current().getString("value.runId");
        String body = resetBody(id(), retired);
        try (Connection c = connection()) {
            c.createStatement().execute("CREATE FUNCTION f594_reject_reviewed_policy() RETURNS trigger LANGUAGE plpgsql AS $$ "
                    + "BEGIN IF NEW.policy_version = '" + POLICY + "' THEN RAISE EXCEPTION 'f594 adoption unavailable'; "
                    + "END IF; RETURN NEW; END $$");
            c.createStatement().execute("CREATE TRIGGER f594_reject_reviewed_policy BEFORE INSERT ON policy_versions "
                    + "FOR EACH ROW EXECUTE FUNCTION f594_reject_reviewed_policy()");
            try {
                post(presenter, "/scenarios/reset", body).then().statusCode(503)
                        .body("code", equalTo("scenario-preparation-incomplete")).body("retryable", equalTo(true));
                String pending = current().getString("value.runId");
                assertNotEquals(retired, pending);
                String now = get(presenter, "/clock").then().statusCode(200).extract().jsonPath().getString("value.now");
                var active = policy.getActiveVersion(new PolicyRead(pending, now, null));
                assertTrue(active.ok(), "base policy reads remain available during the adoption fault");
                assertEquals("gcsp-policy-v1", active.policyVersion());
                assertEquals(0, count(pending, "SELECT count(*) FROM briefs WHERE run_id = ?"));
                assertEquals(0, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ?"));
            } finally {
                c.createStatement().execute("DROP TRIGGER f594_reject_reviewed_policy ON policy_versions");
                c.createStatement().execute("DROP FUNCTION f594_reject_reviewed_policy()");
            }
        }
        String pending = current().getString("value.runId");
        post(presenter, "/scenarios/reset", body).then().statusCode(200)
                .body("value.activatedRunId", equalTo(pending)).body("value.replayed", equalTo(true));
        assertEquals(1, count(pending, "SELECT count(*) FROM scenario_runs WHERE run_id = ? AND state = 'prepared'"));
        assertFrozenBrief(pending);
        assertResetReplay(body, pending);
    }

    private void assertResetReplay(String body, String run) throws Exception {
        long revision = count(run, "SELECT revision FROM runs WHERE run_id = ?");
        long resets = count(run, "SELECT count(*) FROM run_resets WHERE activated_run_id = ?");
        post(presenter, "/scenarios/reset", body).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.activatedRunId", equalTo(run));
        assertEquals(run, current().getString("value.runId"));
        assertEquals(revision, count(run, "SELECT revision FROM runs WHERE run_id = ?"));
        assertEquals(resets, count(run, "SELECT count(*) FROM run_resets WHERE activated_run_id = ?"));
    }

    private void assertFrozenBrief(String run) throws Exception {
        String employee = PresenterClockSupport.token(signingJwk, "sub-paula", "employee");
        PresenterClockSupport.as(employee).get("/api/gcsp/v1/context").then().statusCode(200)
                .body("value.runId", equalTo(run)).body("value.policyVersion", equalTo(POLICY));
        PresenterClockSupport.as(employee).get("/api/gcsp/v1/brief").then().statusCode(200)
                .body("value.brief.policyVersion", equalTo(POLICY)).body("value.brief.briefVersion", equalTo(1));
        assertEquals(1, count(run, "SELECT count(*) FROM briefs WHERE run_id = ?"));
        try (Connection c = connection(); PreparedStatement ps = c.prepareStatement(
                "SELECT content::text, buddy::text, brief_version, operation, policy_version FROM briefs WHERE run_id = ? AND employee_id = 'employee-paula'")) {
            ps.setString(1, run);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                JsonNode content = JSON.readTree(rs.getString(1));
                JsonNode buddy = JSON.readTree(rs.getString(2));
                assertEquals(1, content.path("preferences").size());
                assertEquals("estate", content.at("/preferences/body/value").asText());
                assertEquals(80, content.at("/preferences/body/importance").asInt());
                assertEquals("confirmed", content.at("/preferences/body/valueState").asText());
                assertEquals("confirmed", content.at("/preferences/body/importanceState").asText());
                assertEquals(5, content.at("/essentials/seats/value").asInt());
                assertEquals("not-ready", content.at("/essentials/charging/value").asText());
                assertTrue(buddy.path("enabled").asBoolean());
                assertTrue(buddy.path("searchConsent").asBoolean());
                assertTrue(buddy.path("holdConsent").asBoolean());
                assertEquals(1, rs.getLong(3));
                assertEquals("confirmed", rs.getString(4));
                assertEquals(POLICY, rs.getString(5));
            }
        }
    }

    private JsonPath current() {
        return get(presenter, "/scenarios/current").then().statusCode(200).extract().jsonPath();
    }

    private String resetBody(String command, String run) {
        JsonPath catalogue = get(presenter, "/scenarios").then().statusCode(200).extract().jsonPath();
        String at = "value.scenarios.find { it.scenarioId == '" + SCENARIO + "' }.";
        return "{\"commandId\":\"" + command + "\",\"expectedRunId\":\"" + run + "\",\"scenarioId\":\"" + SCENARIO
                + "\",\"scenarioVersion\":\"" + catalogue.getString(at + "scenarioVersion") + "\",\"fixtureVersion\":\""
                + catalogue.getString(at + "fixtureVersion") + "\",\"policyVersion\":\"" + catalogue.getString(at + "policyVersion") + "\"}";
    }

    private Connection connection() throws Exception {
        Connection c = PresenterClockProfiles.plain().getConnection();
        c.createStatement().execute("SET search_path TO " + schema);
        return c;
    }

    private long count(String run, String sql) throws Exception {
        try (Connection c = connection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, run);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                return rs.getLong(1);
            }
        }
    }

    private static String id() {
        return "main-" + UUID.randomUUID();
    }
}
