package gcsp.api.scenario;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.RepositoryAccountRecords;
import gcsp.api.account.SourceResult;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.scenario.ScenarioService.ResetRequest;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Preparation, catalogue and reset over a real schema; each service() is a new pool, as after a restart. */
class DemoPreparationTest {

    private static final String RUN = "run-1";
    ScenarioFixture fx;

    @BeforeEach
    void setUp() throws Exception {
        fx = ScenarioFixture.create();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (fx != null) fx.close();
    }

    private long people(String run) throws SQLException {
        return fx.count("SELECT count(*) FROM employees WHERE environment_id = ? AND run_id = ?", ScenarioFixture.ENV, run);
    }

    private ResetRequest reset(String command, String expected, String scenario, ScenarioService s, RunContext scope) {
        ObjectNode entry = find(((ClockResult.Ok) s.catalogue(scope)).value(), scenario);
        return new ResetRequest(command, expected, scenario, entry.get("scenarioVersion").textValue(),
                entry.get("fixtureVersion").textValue(), entry.get("policyVersion").textValue());
    }

    private static ObjectNode find(JsonNode catalogue, String id) {
        for (JsonNode s : catalogue.get("scenarios")) if (id.equals(s.get("scenarioId").textValue())) return (ObjectNode) s;
        throw new AssertionError(id);
    }

    @Test
    void nothingIsSeededUntilPreparationRuns() throws Exception {
        assertEquals(0, people(RUN));
        assertEquals(0, fx.count("SELECT count(*) FROM scenario_runs"));
        assertEquals(0, fx.count("SELECT count(*) FROM run_clocks"));
    }

    @Test
    void startupPreparesTheActiveRunOnceWithItsOwnClock() throws Exception {
        ClockResult first = fx.service().startup(ScenarioFixture.ENV, RUN);
        assertTrue(first.ok(), first.toString());
        assertEquals(5, people(RUN));
        assertEquals(5, fx.count("SELECT count(*) FROM employee_account_records"));
        assertEquals(5, fx.count("SELECT count(*) FROM entitlement_slots"));
        assertEquals("gcsp-clock-scenario-v1", fx.text("SELECT scenario_id FROM scenario_runs WHERE run_id = ?", RUN));
        assertEquals("prepared", fx.text("SELECT state FROM scenario_runs WHERE run_id = ?", RUN));
        assertEquals(1, fx.count("SELECT count(*) FROM run_clocks WHERE run_id = ?", RUN));
        assertEquals(0, fx.count("SELECT count(*) FROM employees WHERE employee_id = 'operator-presenter'"));
    }

    @Test
    void aSecondStartupChangesNothingAndAnEditedRecordSurvives() throws Exception {
        fx.service().startup(ScenarioFixture.ENV, RUN);
        fx.update("UPDATE employee_account_records SET record = jsonb_set(record, '{account,name}', '\"Edited\"'), version = 9 "
                + "WHERE employee_id = 'employee-paula'");
        long revision = fx.count("SELECT revision FROM runs WHERE run_id = ?", RUN);
        ClockResult again = fx.service().startup(ScenarioFixture.ENV, RUN);
        assertTrue(again.ok());
        assertEquals(5, people(RUN));
        assertEquals(revision, fx.count("SELECT revision FROM runs WHERE run_id = ?", RUN));
        assertEquals("Edited", fx.text("SELECT record->'account'->>'name' FROM employee_account_records "
                + "WHERE employee_id = 'employee-paula'"));
        assertEquals(9, fx.count("SELECT version FROM employee_account_records WHERE employee_id = 'employee-paula'"));
    }

    @Test
    void restartPreservesActiveWorkAndClockState() throws Exception {
        ScenarioService before = fx.service();
        before.startup(ScenarioFixture.ENV, RUN);
        var clock = fx.clock();
        ClockResult state = clock.state(fx.presenter(RUN));
        long version = ((ClockResult.Ok) state).value().get("clockVersion").asLong();
        assertTrue(clock.advance(fx.presenter(RUN), "adv-1", version, 30L, null).ok());
        fx.update("UPDATE employee_account_records SET version = 7 WHERE employee_id = 'employee-alex'");
        ScenarioService after = fx.service();
        assertTrue(after.startup(ScenarioFixture.ENV, RUN).ok());
        var next = ((ClockResult.Ok) fx.clock().state(fx.presenter(RUN))).value();
        assertEquals(version + 1, next.get("clockVersion").asLong());
        assertEquals(7, fx.count("SELECT version FROM employee_account_records WHERE employee_id = 'employee-alex'"));
        assertEquals(RUN, fx.text("SELECT run_id FROM runs WHERE status = 'active'"));
    }

    @Test
    void theSeededShapeIsReadByTheRepositoryAccountProvider() throws Exception {
        fx.service().startup(ScenarioFixture.ENV, RUN);
        AccountRecordsPort port = new RepositoryAccountRecords(fx.pool());
        SourceResult employment = port.readEmployment(ScenarioFixture.ENV, RUN, "employee-paula");
        assertEquals(SourceResult.OK, employment.status());
        assertEquals("Paula Mason", employment.value().get("name").textValue());
        assertEquals("slot-paula", employment.value().get("entitlementSlotId").textValue());
        AccountScope scope = new AccountScope(ScenarioFixture.ENV, RUN, "employee-paula", "Paula Mason", List.of("employee"),
                "demo-bmw-fs-uk", "choices-fs-uk", "G7", "slot-paula", "gcsp-policy-v1");
        SourceResult contract = port.readEmployeeContract(scope);
        assertEquals(SourceResult.OK, contract.status());
        assertEquals("manual:employee-paula:v1", contract.value().get("recordSetId").textValue());
        assertEquals("slot-paula", contract.value().get("slots").get(0).get("entitlementSlotId").textValue());
        assertEquals("entitled", contract.value().get("slots").get(0).get("state").textValue());
        assertEquals(SourceResult.OK, port.readDrivers(scope).status());
        assertEquals(SourceResult.NOT_FOUND,
                port.readEmployment(ScenarioFixture.ENV, RUN, "operator-presenter").status());
    }

    @Test
    void theCatalogueListsMechanicsAvailableAndEveryJourneyNotYet() throws Exception {
        ScenarioService s = fx.service();
        JsonNode catalogue = ((ClockResult.Ok) s.catalogue(fx.presenter(RUN))).value();
        assertEquals("gcsp-scenario-catalogue-v1", catalogue.get("catalogueVersion").textValue());
        assertEquals(9, catalogue.get("scenarios").size());
        for (JsonNode e : catalogue.get("scenarios")) {
            boolean mechanics = "mechanics".equals(e.get("kind").textValue());
            assertEquals(mechanics, e.get("availability").get("available").booleanValue());
            assertEquals(mechanics ? "available" : "not available yet", e.get("availability").get("outcome").textValue());
            assertEquals(mechanics, e.get("availability").get("missingCapabilities").isEmpty());
            assertTrue(e.get("clockStart").textValue().endsWith("Z"));
            assertFalse(e.get("principals").isEmpty());
            e.get("principals").forEach(p -> assertFalse(p.has("principalId")));
        }
        assertEquals("gcsp-clock-fixtures-v1", find(catalogue, "gcsp-clock-scenario-v1").get("fixtureVersion").textValue());
    }

    @Test
    void resetPreparesTheNewRunAndLeavesTheOldRowsUntouched() throws Exception {
        ScenarioService s = fx.service();
        s.startup(ScenarioFixture.ENV, RUN);
        RunContext scope = fx.presenter(RUN);
        ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, scope);
        ClockResult done = s.reset(scope, req);
        assertTrue(done.ok(), done.toString());
        JsonNode v = ((ClockResult.Ok) done).value();
        String next = ScenarioService.newRunId(ScenarioFixture.ENV, RUN, "cmd-1");
        assertEquals(next, v.get("activatedRunId").textValue());
        assertEquals(RUN, v.get("retiredRunId").textValue());
        assertFalse(v.get("replayed").booleanValue());
        assertEquals(next, v.get("clock").get("runId").textValue());
        assertEquals(next, fx.text("SELECT run_id FROM runs WHERE status = 'active'"));
        assertEquals("retired", fx.text("SELECT status FROM runs WHERE run_id = ?", RUN));
        assertEquals(5, people(next));
        assertEquals(5, people(RUN));
        assertEquals(1, fx.count("SELECT count(*) FROM run_clocks WHERE run_id = ?", next));
        assertEquals(1, fx.count("SELECT count(*) FROM scenario_runs WHERE run_id = ?", next));
    }

    @Test
    void replayingTheSameResetReturnsTheSameReceiptEvenAfterAnotherReset() throws Exception {
        ScenarioService s = fx.service();
        s.startup(ScenarioFixture.ENV, RUN);
        RunContext scope = fx.presenter(RUN);
        ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, scope);
        JsonNode first = ((ClockResult.Ok) s.reset(scope, req)).value();
        String active = first.get("activatedRunId").textValue();
        JsonNode replay = ((ClockResult.Ok) s.reset(fx.presenter(active), req)).value();
        assertTrue(replay.get("replayed").booleanValue());
        assertEquals(active, replay.get("activatedRunId").textValue());
        assertEquals(1, fx.count("SELECT count(*) FROM run_resets"));
        ResetRequest second = reset("cmd-2", active, "gcsp-clock-scenario-v1", s, fx.presenter(active));
        assertTrue(s.reset(fx.presenter(active), second).ok());
        JsonNode historical = ((ClockResult.Ok) s.reset(fx.presenter(ScenarioService.newRunId(ScenarioFixture.ENV, active, "cmd-2")),
                req)).value();
        assertTrue(historical.get("replayed").booleanValue());
        assertEquals(active, historical.get("activatedRunId").textValue());
        assertEquals(2, fx.count("SELECT count(*) FROM run_resets"));
    }

    @Test
    void aChangedInputOrStaleVersionOrStaleRunIsRefusedAndWritesNothing() throws Exception {
        ScenarioService s = fx.service();
        s.startup(ScenarioFixture.ENV, RUN);
        RunContext scope = fx.presenter(RUN);
        ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, scope);
        assertTrue(s.reset(scope, req).ok());
        String active = ScenarioService.newRunId(ScenarioFixture.ENV, RUN, "cmd-1");
        ResetRequest changed = new ResetRequest("cmd-1", active, req.scenarioId(), req.scenarioVersion(), req.fixtureVersion(),
                req.policyVersion());
        ClockResult.Failure conflict = (ClockResult.Failure) s.reset(fx.presenter(active), changed);
        assertEquals("command-input-changed", conflict.code());
        ResetRequest oldVersion = new ResetRequest("cmd-9", active, req.scenarioId(), "old", req.fixtureVersion(),
                req.policyVersion());
        ClockResult.Failure stale = (ClockResult.Failure) s.reset(fx.presenter(active), oldVersion);
        assertEquals("stale-version", stale.code());
        assertEquals("scenarioVersion", stale.detail().get("field").textValue());
        assertEquals("refresh", stale.detail().get("action").textValue());
        ResetRequest wrongRun = new ResetRequest("cmd-8", RUN, req.scenarioId(), req.scenarioVersion(), req.fixtureVersion(),
                req.policyVersion());
        assertEquals("stale-run", ((ClockResult.Failure) s.reset(fx.presenter(active), wrongRun)).code());
        ClockResult.Failure unknown = (ClockResult.Failure) s.reset(fx.presenter(active),
                new ResetRequest("cmd-7", active, "nope", "a", "b", "c"));
        assertEquals("scenario-not-found", unknown.code());
        assertEquals(2, fx.count("SELECT count(*) FROM runs"));
        assertEquals(1, fx.count("SELECT count(*) FROM run_resets"));
    }

    @Test
    void aJourneyIsRefusedBeforeAnyWrite() throws Exception {
        ScenarioService s = fx.service();
        s.startup(ScenarioFixture.ENV, RUN);
        RunContext scope = fx.presenter(RUN);
        ResetRequest req = reset("cmd-1", RUN, "main-successful-journey", s, scope);
        ClockResult.Failure refused = (ClockResult.Failure) s.reset(scope, req);
        assertEquals("scenario-not-available-yet", refused.code());
        assertFalse(refused.retryable());
        assertEquals(ClockResult.Status.UNAVAILABLE, refused.status());
        assertTrue(refused.detail().get("missingCapabilities").size() > 0);
        assertEquals(1, fx.count("SELECT count(*) FROM runs"));
        assertEquals(0, fx.count("SELECT count(*) FROM run_resets"));
        assertEquals(RUN, fx.text("SELECT run_id FROM runs WHERE status = 'active'"));
    }

    @Test
    void anInterruptedResetIsCompletedByTheSameCommandAndByTheStartupPass() throws Exception {
        ScenarioService s = fx.service();
        s.startup(ScenarioFixture.ENV, RUN);
        RunContext scope = fx.presenter(RUN);
        ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, scope);
        String next = ScenarioService.newRunId(ScenarioFixture.ENV, RUN, "cmd-1");
        assertInstanceOf(Outcome.Committed.class,
                fx.rawReset().reset(ScenarioFixture.ENV, "presenter:test", "scenario:reset:cmd-1", RUN, next));
        assertEquals(0, people(next));
        ClockResult done = s.reset(fx.presenter(next), req);
        assertTrue(done.ok(), done.toString());
        assertTrue(((ClockResult.Ok) done).value().get("replayed").booleanValue());
        assertEquals(5, people(next));
        assertEquals(1, fx.count("SELECT count(*) FROM run_clocks WHERE run_id = ?", next));

        reset("cmd-2", next, "gcsp-clock-scenario-v1", s, fx.presenter(next));
        String third = ScenarioService.newRunId(ScenarioFixture.ENV, next, "cmd-2");
        fx.rawReset().reset(ScenarioFixture.ENV, "presenter:test", "scenario:reset:cmd-2", next, third);
        assertEquals(0, people(third));
        assertTrue(fx.service().startup(ScenarioFixture.ENV, third).ok());
        assertEquals(5, people(third));
        assertEquals("gcsp-clock-scenario-v1", fx.text("SELECT scenario_id FROM scenario_runs WHERE run_id = ?", third));
    }

    @Test
    void resetIsRefusedOnADatabaseThatDoesNotAllowItAndOnANameMismatch() throws Exception {
        try (ScenarioFixture locked = ScenarioFixture.create("GCSP_TEST_DATABASE_URL", false)) {
            ScenarioService s = locked.service();
            s.startup(ScenarioFixture.ENV, RUN);
            ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, locked.presenter(RUN));
            ClockResult.Failure refused = (ClockResult.Failure) s.reset(locked.presenter(RUN), req);
            assertEquals("reset-not-allowed", refused.code());
            assertEquals(1, locked.count("SELECT count(*) FROM runs"));
        }
        ScenarioService wrong = fx.service("gcsp_test_running");
        wrong.startup(ScenarioFixture.ENV, RUN);
        ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", wrong, fx.presenter(RUN));
        assertEquals("reset-isolation-mismatch", ((ClockResult.Failure) wrong.reset(fx.presenter(RUN), req)).code());
        assertEquals(1, fx.count("SELECT count(*) FROM runs"));
    }

    @Test
    void theRunningDatabaseIsNeverResetEvenWhenItsOwnFlagWouldAllowIt() throws Exception {
        try (ScenarioFixture running = ScenarioFixture.create("GCSP_TEST_RUNNING_DATABASE_URL", false)) {
            ScenarioService s = running.service();
            s.startup(ScenarioFixture.ENV, RUN);
            ResetRequest req = reset("cmd-1", RUN, "gcsp-clock-scenario-v1", s, running.presenter(RUN));
            assertEquals("reset-not-allowed", ((ClockResult.Failure) s.reset(running.presenter(RUN), req)).code());
            assertEquals(RUN, running.text("SELECT run_id FROM runs WHERE status = 'active'"));
            assertEquals(0, running.count("SELECT count(*) FROM run_resets"));
        }
    }

    @Test
    void aPreparedScenarioRowIsFinal() throws Exception {
        fx.service().startup(ScenarioFixture.ENV, RUN);
        org.junit.jupiter.api.Assertions.assertThrows(SQLException.class,
                () -> fx.update("UPDATE scenario_runs SET fixture_version = 'x'"));
        org.junit.jupiter.api.Assertions.assertThrows(SQLException.class, () -> fx.update("DELETE FROM scenario_runs"));
    }
}
