package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
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

/** The presenter scenario endpoints with provider demo, over the native test database. */
@QuarkusTest
@TestProfile(PresenterScenarioProfiles.Demo.class)
class PresenterScenarioHttpTest {

    private static final String[] GETS = {"/scenarios", "/scenarios/current"};
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    String presenter;
    String employee;
    String greg;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
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

    JsonPath current() {
        return get(presenter, "/scenarios/current").then().statusCode(200).extract().jsonPath();
    }

    String resetBody(String command, String expectedRun, String scenario) {
        JsonPath catalogue = get(presenter, "/scenarios").jsonPath();
        String base = "value.scenarios.find { it.scenarioId == '" + scenario + "' }.";
        return "{\"commandId\":\"" + command + "\",\"expectedRunId\":\"" + expectedRun + "\",\"scenarioId\":\"" + scenario
                + "\",\"scenarioVersion\":\"" + catalogue.getString(base + "scenarioVersion") + "\",\"fixtureVersion\":\""
                + catalogue.getString(base + "fixtureVersion") + "\",\"policyVersion\":\""
                + catalogue.getString(base + "policyVersion") + "\"}";
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

    @Test
    void everyEndpointRefusesAnonymousEmployeeAndGreg() {
        for (String path : GETS) {
            get(null, path).then().statusCode(401).body("code", equalTo("bearer-missing"));
            for (String who : new String[] {employee, greg}) {
                get(who, path).then().statusCode(403).body("code", equalTo("role-required"));
            }
        }
        post(null, "/scenarios/reset", "{}").then().statusCode(401);
        for (String who : new String[] {employee, greg}) {
            post(who, "/scenarios/reset", "{}").then().statusCode(403).body("code", equalTo("role-required"));
        }
    }

    @Test
    void queryParametersAndForeignFieldsAreRefused() {
        for (String path : GETS) {
            get(presenter, path + "?employeeId=employee-paula").then().statusCode(400).body("code", equalTo("unsupported-query"));
        }
        post(presenter, "/scenarios/reset?runId=x", "{}").then().statusCode(400).body("code", equalTo("unsupported-query"));
        String run = current().getString("value.runId");
        String body = resetBody(id(), run, "gcsp-clock-scenario-v1");
        post(presenter, "/scenarios/reset", body.replace("}", ",\"employeeId\":\"employee-paula\"}")).then().statusCode(400)
                .body("code", equalTo("invalid-scenario-command")).body("reasons.field", hasItem("employeeId"));
        post(presenter, "/scenarios/reset", body.replace("}", ",\"principalId\":\"demo-paula\"}")).then().statusCode(400)
                .body("reasons.field", hasItem("principalId"));
        post(presenter, "/scenarios/reset", "{\"commandId\":\"c\"}").then().statusCode(400)
                .body("reasons.field", hasItem("expectedRunId"));
        post(presenter, "/scenarios/reset", "not json").then().statusCode(400);
        assertEquals(run, current().getString("value.runId"));
    }

    @Test
    void theCatalogueHasTheContractShapeAndNoSwitch() {
        get(presenter, "/scenarios").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.catalogueVersion", equalTo("gcsp-scenario-catalogue-v1"))
                .body("value.policyVersion", notNullValue()).body("value.scenarios.size()", equalTo(9))
                .body("value.scenarios.find { it.kind == 'mechanics' }.availability.outcome", equalTo("available"))
                .body("value.scenarios.find { it.scenarioId == 'offer-expires' }.availability.outcome", equalTo("not available yet"))
                .body("value.scenarios.find { it.scenarioId == 'offer-expires' }.availability.missingCapabilities",
                        hasItem("offer-expiry"))
                .body("value.scenarios[0].principals[0].employeeId", notNullValue())
                .body("value.scenarios[0].principals[0].principalId", nullValue())
                .body("value.scenarios[0].inputProvenance", notNullValue())
                .body("value.scenarios[0].clockStart", notNullValue()).body("value.scenarios[0].namedTimes.release", notNullValue());
    }

    @Test
    void currentShowsTheMechanicsScenarioClockAndRun() {
        JsonPath c = current();
        assertEquals("gcsp-clock-scenario-v1", c.getString("value.currentScenario.scenarioId"));
        assertTrue(c.getLong("value.clockVersion") > 0);
        assertEquals("gcsp-scenario-catalogue-v1", c.getString("value.catalogueVersion"));
        assertTrue(c.getString("value.runId").length() > 0);
    }

    @Test
    void resetMovesToANewPreparedRunAndReplaysByCommandId() throws Exception {
        String run = current().getString("value.runId");
        String command = id();
        String body = resetBody(command, run, "gcsp-clock-scenario-v1");
        JsonPath first = post(presenter, "/scenarios/reset", body).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.retiredRunId", equalTo(run)).body("value.replayed", equalTo(false))
                .body("value.scenario.scenarioId", equalTo("gcsp-clock-scenario-v1")).body("value.clock.now", notNullValue())
                .extract().jsonPath();
        String activated = first.getString("value.activatedRunId");
        assertTrue(activated.startsWith("demo-"));
        assertEquals(activated, current().getString("value.runId"));
        assertEquals(5, count("SELECT count(*) FROM employees WHERE run_id = ?", activated));
        assertEquals(1, count("SELECT count(*) FROM run_clocks WHERE run_id = ?", activated));
        post(presenter, "/scenarios/reset", body).then().statusCode(200).body("value.replayed", equalTo(true))
                .body("value.activatedRunId", equalTo(activated));
        // The same command with other input is a conflict, and a stale run id is 409.
        post(presenter, "/scenarios/reset", body.replace(run, activated)).then().statusCode(409)
                .body("code", equalTo("command-input-changed"));
        post(presenter, "/scenarios/reset", resetBody(id(), run, "gcsp-clock-scenario-v1")).then().statusCode(409)
                .body("code", equalTo("stale-run"));
    }

    @Test
    void staleVersionsAreAConflictWithTheCurrentVersionAndAJourneyIs503BeforeAnyWrite() throws Exception {
        String run = current().getString("value.runId");
        post(presenter, "/scenarios/reset", resetBody(id(), run, "gcsp-clock-scenario-v1").replace("gcsp-clock-fixtures-v1", "old"))
                .then().statusCode(409).body("code", equalTo("stale-version")).body("field", equalTo("fixtureVersion"))
                .body("currentVersion", equalTo("gcsp-clock-fixtures-v1")).body("action", equalTo("refresh"));
        post(presenter, "/scenarios/reset", resetBody(id(), run, "gcsp-clock-scenario-v1").replace("gcsp-clock-scenario-v1\",\"scenarioVersion",
                "nope\",\"scenarioVersion")).then().statusCode(404).body("code", equalTo("scenario-not-found"));
        post(presenter, "/scenarios/reset", resetBody(id(), run, "offer-expires")).then().statusCode(503)
                .body("code", equalTo("scenario-not-available-yet")).body("retryable", equalTo(false))
                .body("missingCapabilities", hasItem("offer-expiry"));
        assertEquals(run, current().getString("value.runId"));
    }
}
