package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;

/** The latest presenter tick's now (index appointment_ticks_latest); empty before the first tick. */
public final class TickClock implements AppointmentClock {

    private static final String LATEST = "SELECT tick_now FROM appointment_ticks WHERE environment_id = ? AND run_id = ? "
            + "ORDER BY tick_now DESC, seq DESC LIMIT 1";

    private final DataSource dataSource;

    public TickClock(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public Optional<Instant> now(RunContext context) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(LATEST)) {
            ps.setString(1, context.environmentId());
            ps.setString(2, context.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                Timestamp t = rs.getTimestamp(1);
                return Optional.of(t.toInstant());
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Appointment ticks are unreadable", e);
        }
    }
}
