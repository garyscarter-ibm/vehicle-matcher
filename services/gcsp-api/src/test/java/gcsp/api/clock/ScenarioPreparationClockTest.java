package gcsp.api.clock;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ScenarioPreparationClockTest {

    private ClockFixture fixture;

    @BeforeEach
    void setUp() throws Exception {
        fixture = ClockFixture.create();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (fixture != null) fixture.close();
    }

    private void preparing(String scenario) throws Exception {
        fixture.update("INSERT INTO scenario_runs (environment_id, run_id, scenario_id, scenario_version, fixture_version, "
                + "policy_version, preparation_version, state) VALUES (?, 'run-1', ?, 'scenario-v1', 'fixtures-v1', "
                + "'gcsp-policy-v1', 'preparation-v1', 'preparing')", ClockFixture.ENV, scenario);
    }

    private static void incomplete(ClockResult result) {
        var failure = assertInstanceOf(ClockResult.Failure.class, result);
        assertEquals(ClockResult.Status.UNAVAILABLE, failure.status());
        assertEquals("scenario-preparation-incomplete", failure.code());
        assertTrue(failure.retryable());
    }

    @Test
    void pendingJourneyPreventsEveryClockMoveAndTheSameCommandWorksAfterPreparation() throws Exception {
        RunClock clock = fixture.started();
        preparing("main-successful-journey");
        long receipts = fixture.count("SELECT count(*) FROM command_receipts");
        incomplete(clock.advance(fixture.ctx(), "advance-pending", 1, 60L, null));
        incomplete(clock.presenterTick(fixture.ctx(), "step-pending", 1, PresenterMode.STEP, null));
        incomplete(clock.presenterTick(fixture.ctx(), "release-pending", 1, PresenterMode.NEXT_RELEASE, null));
        incomplete(clock.presenterTick(fixture.ctx(), "to-pending", 1, PresenterMode.TO, "release"));
        assertEquals(ClockFixture.START, clock.now(ClockFixture.ENV, "run-1").orElseThrow().now());
        assertEquals(1, clock.now(ClockFixture.ENV, "run-1").orElseThrow().clockVersion());
        assertEquals(receipts, fixture.count("SELECT count(*) FROM command_receipts"));
        assertEquals(0, fixture.count("SELECT count(*) FROM clock_ticks"));
        fixture.update("UPDATE scenario_runs SET state = 'prepared', prepared_at = now() WHERE run_id = 'run-1'");
        assertTrue(clock.advance(fixture.ctx(), "advance-pending", 1, 60L, null).ok());
    }

    @Test
    void pendingJourneyPreventsExplicitAndStartupTicksWithoutCallingHandlers() throws Exception {
        FakeHandler handler = new FakeHandler("pending-probe", "release-pull");
        RunClock clock = fixture.started(handler);
        preparing("main-successful-journey");
        long receipts = fixture.count("SELECT count(*) FROM command_receipts");
        incomplete(clock.tick(fixture.ctx(), "pending-explicit", 1, TickKind.PRESENTER));
        incomplete(clock.tick(fixture.ctx(), "pending-automatic", 1, TickKind.STARTUP));
        incomplete(clock.reconcileStartup(ClockFixture.ENV, "run-1"));
        assertEquals(0, handler.calls());
        assertEquals(0, fixture.count("SELECT count(*) FROM clock_ticks"));
        assertEquals(0, fixture.count("SELECT count(*) FROM clock_handler_receipts"));
        assertEquals(receipts, fixture.count("SELECT count(*) FROM command_receipts"));
        assertEquals(ClockFixture.START, clock.now(ClockFixture.ENV, "run-1").orElseThrow().now());
        fixture.update("UPDATE scenario_runs SET state = 'prepared', prepared_at = now() WHERE run_id = 'run-1'");
        assertTrue(clock.tick(fixture.ctx(), "pending-explicit", 1, TickKind.PRESENTER).ok());
        assertEquals(1, handler.calls());
    }

    @Test
    void aScenarioResetWithoutItsFirstMarkerWaitsButIdentifiedMechanicsMayProceed() throws Exception {
        RunClock clock = fixture.started();
        fixture.update("INSERT INTO runs (environment_id, run_id, status, retired_at) "
                + "VALUES (?, 'retired-run', 'retired', now())", ClockFixture.ENV);
        fixture.update("INSERT INTO run_resets (environment_id, command_id, actor_id, input_digest, retired_run_id, "
                + "activated_run_id) VALUES (?, 'scenario:reset:gap', 'presenter:test', repeat('a', 64), 'retired-run', 'run-1')",
                ClockFixture.ENV);
        incomplete(clock.advance(fixture.ctx(), "gap-advance", 1, 60L, null));
        incomplete(clock.tick(fixture.ctx(), "gap-tick", 1, TickKind.PRESENTER));
        preparing("gcsp-clock-scenario-v1");
        assertTrue(clock.advance(fixture.ctx(), "gap-advance", 1, 60L, null).ok());
        assertTrue(clock.tick(fixture.ctx(), "gap-tick", 2, TickKind.PRESENTER).ok());
    }
}
