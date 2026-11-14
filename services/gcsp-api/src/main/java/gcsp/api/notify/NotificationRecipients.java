package gcsp.api.notify;

import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import javax.sql.DataSource;

/** Read access to the employee's own delivery email setting (written by a later endpoint). */
public final class NotificationRecipients {

    /** deliveryEmail is null when the employee has none; version is 0 until first written. */
    public record Setting(String deliveryEmail, long version) {}

    private NotificationRecipients() {}

    public static Optional<Setting> read(DataSource dataSource, RunContext ctx, String employeeId)
            throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT delivery_email, version FROM notification_recipients "
                        + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(new Setting(rs.getString(1), rs.getLong(2))) : Optional.empty();
            }
        }
    }
}
