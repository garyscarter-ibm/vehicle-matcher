package gcsp.api.learning;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;

/** The actual run clock; a missing clock is unavailable, never replaced with projection or storage time. */
@ApplicationScoped
public class RunLearningClock implements LearningClock {

    @Inject
    RunClockHolder holder;

    @Override
    public Reading now(RunContext context) {
        if (context == null || !holder.available()) return null;
        try {
            return holder.clock().now(context.environmentId(), context.runId())
                    .map(RunLearningClock::reading).orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Reading reading(ClockReading clock) {
        return new Reading(PolicyClock.iso(clock.now()), clock.clockVersion());
    }

    @Override
    public Reading now(Connection snapshot, RunContext context) throws SQLException {
        try (PreparedStatement ps = snapshot.prepareStatement("SELECT clock_instant, clock_version FROM run_clocks "
                + "WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, context.environmentId());
            ps.setString(2, context.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Reading(PolicyClock.iso(rs.getObject(1, OffsetDateTime.class).toInstant()), rs.getLong(2)) : null;
            }
        }
    }
}
