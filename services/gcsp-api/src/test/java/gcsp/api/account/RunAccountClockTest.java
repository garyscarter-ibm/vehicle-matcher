package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import gcsp.api.clock.RunClock;
import gcsp.api.clock.RunClockHolder;
import java.time.InstantSource;
import java.util.List;
import org.junit.jupiter.api.Test;

class RunAccountClockTest {

    static RunAccountClock clock(RepositoryFixture db) throws Exception {
        RunClock run = new RunClock(db.pool(), null, null, List.of(), InstantSource.system());
        return new RunAccountClock(new RunClockHolder() {
            @Override
            public RunClock clock() { return run; }
        });
    }

    static void seedClock(RepositoryFixture db, AccountScope scope, String now, long version) throws Exception {
        db.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, ?, ?::timestamptz, ?, 'scenario-v1', "
                + "'fixture-v1', ?::timestamptz, '{}'::jsonb)",
                scope.environmentId(), scope.runId(), now, version, now);
    }

    static AccountScope scope(AccountScope original, String environment, String run) {
        return new AccountScope(environment, run, original.employeeId(), original.name(), original.roles(),
                original.companyId(), original.schemeId(), original.gradeId(), original.entitlementSlotId(),
                original.policyVersion());
    }

    @Test
    void readsTheScopedInstantAndActualVersionAfreshWithUtcMilliseconds() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            seedClock(db, fx.scope, "2026-11-05T10:00:00.123456+01:00", 41);
            RunAccountClock clock = clock(db);
            assertEquals(new AccountClockPort.ClockReading("2026-11-05T09:00:00.123Z", "41"), clock.now(fx.scope));
            db.update("UPDATE run_clocks SET clock_instant = '2026-11-06T09:00:00Z', clock_version = 42");
            assertEquals(new AccountClockPort.ClockReading("2026-11-06T09:00:00.000Z", "42"), clock.now(fx.scope));
            assertThrows(ClockUnavailableException.class,
                    () -> clock.now(scope(fx.scope, "other-environment", fx.scope.runId())));
            assertThrows(ClockUnavailableException.class,
                    () -> clock.now(scope(fx.scope, fx.scope.environmentId(), "missing-run")));

            db.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = ?", fx.scope.runId());
            db.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'next-run', 'active')",
                    fx.scope.environmentId());
            AccountScope next = scope(fx.scope, fx.scope.environmentId(), "next-run");
            assertThrows(ClockUnavailableException.class, () -> clock.now(fx.scope));
            assertThrows(ClockUnavailableException.class, () -> clock.now(next));
            seedClock(db, next, "2026-11-07T09:00:00Z", 7);
            assertEquals(new AccountClockPort.ClockReading("2026-11-07T09:00:00.000Z", "7"), clock.now(next));
        }
    }

    @Test
    void anUnreadableClockRefusesInsteadOfReturningWallTime() throws Exception {
        GoldenFixture fx = new GoldenFixture("paula");
        try (RepositoryFixture db = RepositoryFixture.create()) {
            db.claim(fx);
            RunAccountClock clock = clock(db);
            db.update("ALTER TABLE run_clocks RENAME TO unavailable_clocks");
            try {
                assertThrows(gcsp.api.clock.ClockUnavailableException.class, () -> clock.now(fx.scope));
                fx.clock = clock;
                assertEquals("clock", fx.read().refusal().get("source").asText());
            } finally {
                db.update("ALTER TABLE unavailable_clocks RENAME TO run_clocks");
            }
            seedClock(db, fx.scope, fx.now, 1);
            assertEquals(fx.now, clock.now(fx.scope).now());
        }
    }
}
