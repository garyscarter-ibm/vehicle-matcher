package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.as;
import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.ResultSet;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Synthetic stock faults and the reset journey over the native test database, demo scenario and tranche-plan supply. */
@QuarkusTest
@TestProfile(PresenterScenarioProfiles.Journey.class)
class PresenterFaultsJourneyHttpTest {

    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    RunClockDocumentClock runClockDocuments;

    String presenter;
    String employee;
    String greg;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        // The documents tests' shared @Alternative clock would pin the time; use the real binding here.
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        employee = PresenterClockSupport.token(signingJwk, "sub-employee", "employee");
        greg = PresenterClockSupport.token(signingJwk, "sub-greg", "greg");
    }

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    static String id() {
        return "cmd-" + UUID.randomUUID();
    }

    long count(String sql, String run) throws Exception {
        try (Connection c = PresenterClockProfiles.plain().getConnection()) {
            c.createStatement().execute("SET search_path TO " + schema);
            var ps = c.prepareStatement(sql);
            ps.setString(1, run);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String fault(String command, String adapter, String mode) {
        return "{\"commandId\":\"" + command + "\",\"adapter\":\"" + adapter + "\",\"mode\":\"" + mode + "\"}";
    }

    @Test
    void faultEndpointsRefuseNonPresentersAndBadInput() {
        get(null, "/scenarios/faults").then().statusCode(401);
        post(null, "/scenarios/faults", "{}").then().statusCode(401);
        for (String who : new String[] {employee, greg}) {
            get(who, "/scenarios/faults").then().statusCode(403).body("code", equalTo("role-required"));
            post(who, "/scenarios/faults", fault(id(), "stock", "none")).then().statusCode(403)
                    .body("code", equalTo("role-required"));
        }
        get(presenter, "/scenarios/faults?runId=x").then().statusCode(400).body("code", equalTo("unsupported-query"));
        post(presenter, "/scenarios/faults", fault(id(), "stock", "broken")).then().statusCode(400)
                .body("code", equalTo("invalid-fault-command")).body("reasons.find { it.field == 'mode' }.reason",
                        equalTo("Choose one of: none, unavailable, stale."));
        post(presenter, "/scenarios/faults", fault(id(), "ordering", "none")).then().statusCode(400)
                .body("reasons.field", hasItem("adapter"));
        post(presenter, "/scenarios/faults", "{\"commandId\":\"c\",\"adapter\":\"stock\",\"mode\":\"none\",\"runId\":\"x\"}")
                .then().statusCode(400).body("reasons.field", hasItem("runId"));
        get(presenter, "/scenarios/faults").then().statusCode(200).body("value.faults[0].adapter", equalTo("stock"))
                .body("value.faults[0].modes", contains("none", "unavailable", "stale"))
                .body("value.faults[1].adapter", equalTo("ordering")).body("value.faults[1].available", equalTo(false))
                .body("value.faults[1].reason", equalTo("not available yet"));
    }

    @Test
    void aStockFaultInterruptsTheReleaseTickAndTheSameTickResumesOnceCleared() throws Exception {
        for (String path : new String[] {"/clock", "/controls", "/scenarios", "/scenarios/current", "/scenarios/faults"}) {
            get(employee, path).then().statusCode(403);
            get(greg, path).then().statusCode(403);
            get(null, path).then().statusCode(401);
        }
        String firstRun = get(presenter, "/scenarios/current").jsonPath().getString("value.runId");
        assertEquals(5, count("SELECT count(*) FROM employees WHERE run_id = ?", firstRun));
        get(presenter, "/scenarios/faults").then().body("value.runId", equalTo(firstRun))
                .body("value.faults[0].mode", equalTo("none"));

        JsonPath controls = get(presenter, "/controls").then().statusCode(200).extract().jsonPath();
        assertEquals("available", controls.getString("value.controls.nextRelease.status"));
        long version = controls.getLong("value.clockVersion");

        String setCommand = id();
        post(presenter, "/scenarios/faults", fault(setCommand, "stock", "unavailable")).then().statusCode(200)
                .body("value.faults[0].mode", equalTo("unavailable"));
        post(presenter, "/scenarios/faults", fault(setCommand, "stock", "unavailable")).then().statusCode(200)
                .body("value.faults[0].mode", equalTo("unavailable"));
        post(presenter, "/scenarios/faults", fault(setCommand, "stock", "stale")).then().statusCode(409)
                .body("code", equalTo("command-input-changed"));
        get(presenter, "/scenarios/faults").then().body("value.faults[0].mode", equalTo("unavailable"));

        JsonPath interrupted = post(presenter, "/controls/tick", "{\"commandId\":\"" + id() + "\",\"expectedClockVersion\":"
                + version + ",\"mode\":\"next-release\"}").then().statusCode(503).body("code", equalTo("handler-interrupted"))
                .body("handlerId", equalTo("stock-release")).body("handlerOutcome.code", equalTo("synthetic-stock-unavailable"))
                .body("handlerOutcome.retryable", equalTo(true)).extract().jsonPath();
        String tickId = interrupted.getString("tickId");
        long tickVersion = interrupted.getLong("advance.clockVersion");
        as(presenter).get("/api/gcsp/v1/presenter/releases/latest").then().statusCode(200)
                .body("value.release", nullValue());
        get(presenter, "/clock/ticks/" + tickId).then().body("value.state", equalTo("interrupted"));

        post(presenter, "/scenarios/faults", fault(id(), "stock", "stale")).then().statusCode(200);
        post(presenter, "/clock/tick", "{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":" + tickVersion + "}")
                .then().statusCode(503).body("handlerOutcome.code", equalTo("stock-source-stale"));

        post(presenter, "/scenarios/faults", fault(id(), "stock", "none")).then().statusCode(200)
                .body("value.faults[0].mode", equalTo("none"));
        JsonPath done = post(presenter, "/clock/tick", "{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":"
                + tickVersion + "}").then().statusCode(200).body("value.state", equalTo("completed"))
                .body("value.handlerOrder.handlerId", contains("stock-release", "lifecycle-appointments",
                        "lifecycle-documents", "lifecycle-return-outcomes", "captured-outbox"))
                .body("value.handlerOrder.stage", contains("release-pull", "pending-reconciliation",
                        "pending-reconciliation", "pending-reconciliation", "outbox-dispatch"))
                .extract().jsonPath();
        assertTrue(done.getList("value.missingStages").contains("manual-expiry"));
        assertTrue(done.getList("value.missingStages").contains("buddy-expiry"));
        assertEquals("stock-released", done.getString("value.outcomes.find { it.handlerId == 'stock-release' }.outcome.value.kind"));
        as(presenter).get("/api/gcsp/v1/presenter/releases/latest").then().statusCode(200)
                .body("value.release.trancheId", org.hamcrest.Matchers.notNullValue());

        // Reset to the mechanics scenario: a new prepared run with no fault; the old run keeps every row.
        long oldTicks = count("SELECT count(*) FROM clock_ticks WHERE run_id = ?", firstRun);
        long oldFaults = count("SELECT count(*) FROM scenario_faults WHERE run_id = ?", firstRun);
        assertTrue(oldFaults > 0);
        post(presenter, "/scenarios/faults", fault(id(), "stock", "unavailable")).then().statusCode(200);
        String body = resetBody(id(), firstRun);
        JsonPath reset = post(presenter, "/scenarios/reset", body).then().statusCode(200).body("value.replayed", equalTo(false))
                .extract().jsonPath();
        String newRun = reset.getString("value.activatedRunId");
        assertNotEquals(firstRun, newRun);
        assertEquals(5, count("SELECT count(*) FROM employees WHERE run_id = ?", newRun));
        get(presenter, "/scenarios/faults").then().body("value.runId", equalTo(newRun))
                .body("value.faults[0].mode", equalTo("none"));
        assertEquals(0, count("SELECT count(*) FROM scenario_faults WHERE run_id = ?", newRun));
        JsonPath current = get(presenter, "/scenarios/current").jsonPath();
        assertEquals(newRun, current.getString("value.runId"));
        assertEquals(get(presenter, "/scenarios").jsonPath().getString("value.scenarios[0].clockStart"),
                current.getString("value.now"));
        assertEquals(oldTicks, count("SELECT count(*) FROM clock_ticks WHERE run_id = ?", firstRun));
        assertEquals(oldFaults, count("SELECT count(*) FROM scenario_faults WHERE run_id = ?", firstRun));
        post(presenter, "/scenarios/reset", body).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.activatedRunId", equalTo(newRun)).body("value.retiredRunId", equalTo(firstRun));
    }

    private String resetBody(String command, String expectedRun) {
        JsonPath catalogue = get(presenter, "/scenarios").jsonPath();
        String base = "value.scenarios.find { it.scenarioId == 'gcsp-clock-scenario-v1' }.";
        return "{\"commandId\":\"" + command + "\",\"expectedRunId\":\"" + expectedRun
                + "\",\"scenarioId\":\"gcsp-clock-scenario-v1\",\"scenarioVersion\":\""
                + catalogue.getString(base + "scenarioVersion") + "\",\"fixtureVersion\":\""
                + catalogue.getString(base + "fixtureVersion") + "\",\"policyVersion\":\""
                + catalogue.getString(base + "policyVersion") + "\"}";
    }
}
