package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import org.junit.jupiter.api.Test;

/** Run-clock identity and record facts must come from one database snapshot. */
class RunLearningClockTest {

    private static final RunContext CONTEXT = new RunContext(LearningDb.ENV, LearningDb.RUN, "greg");

    @Test
    void missingAndOtherRunClocksNeverSubstituteWallTime() throws Exception {
        try (LearningDb db = LearningDb.create(); Connection c = db.pool().getConnection()) {
            RunLearningClock clock = new RunLearningClock();
            assertNull(clock.now(c, CONTEXT));
            insertClock(db);
            assertEquals(new LearningClock.Reading(LearningDb.NOW, 7L), clock.now(c, CONTEXT));
            assertNull(clock.now(c, new RunContext("other-env", LearningDb.RUN, "greg")));
            assertNull(clock.now(c, new RunContext(LearningDb.ENV, "other-run", "greg")));
        }
    }

    @Test
    void concurrentClockAdvanceCannotChangeTheRecordSnapshot() throws Exception {
        try (LearningDb db = LearningDb.create(); Connection c = db.pool().getConnection()) {
            insertClock(db);
            c.setReadOnly(true);
            c.setAutoCommit(false);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            RunLearningClock clock = new RunLearningClock();
            assertEquals(7L, clock.now(c, CONTEXT).clockVersion());
            db.update("UPDATE run_clocks SET clock_instant = clock_instant + interval '1 day', "
                    + "clock_version = 8 WHERE environment_id = ? AND run_id = ?", LearningDb.ENV, LearningDb.RUN);
            assertEquals(new LearningClock.Reading(LearningDb.NOW, 7L), clock.now(c, CONTEXT));
            c.rollback();
            assertEquals(new LearningClock.Reading("2026-11-14T12:00:00.000Z", 8L), clock.now(c, CONTEXT));
        }
    }

    private static void insertClock(LearningDb db) throws Exception {
        db.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, ?, ?::timestamptz, 7, 'scenario-1', 'fixture-1', "
                + "?::timestamptz, '{}'::jsonb)", LearningDb.ENV, LearningDb.RUN, LearningDb.NOW, LearningDb.NOW);
    }
}
