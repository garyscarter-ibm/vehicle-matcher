package gcsp.api.returns;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;

/** The latest delivered presenter tick for the run, by one indexed read (supply_release_ticks_clock). */
public final class TickReturnClock implements ReturnClock {

    static final String SQL = "SELECT tick_now FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
            + "ORDER BY clock_version DESC, delivered_seq DESC LIMIT 1";

    private final DataSource dataSource;

    public TickReturnClock(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** A database failure surfaces as an unchecked exception so callers answer unavailable rather than guess a time. */
    @Override
    public Optional<Instant> now(RunContext ctx) {
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(SQL)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(rs.getObject(1, java.time.OffsetDateTime.class).toInstant()) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("The demo clock could not be read", e);
        }
    }
}
