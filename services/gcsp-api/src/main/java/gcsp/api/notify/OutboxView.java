package gcsp.api.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import javax.sql.DataSource;

/** The presenter's safe projection of notification jobs: never the payload, an address, provider ids or digests. */
public final class OutboxView {

    public static final int MAX_ROWS = 500;
    private static final Pattern CODE = Pattern.compile("^[a-z][a-z0-9-]{0,63}$");
    private static final ObjectMapper JSON = new ObjectMapper();

    public record Recipient(String employeeId, String name) {}

    public record Message(String jobId, String messageKind, String state, String transport, int attempts, String error,
            Instant nextAttemptAt, Instant time, Recipient recipient, String subject, String textBody, String htmlBody,
            String offerLink) {}

    private OutboxView() {}

    /** Newest first, then jobId; at most min(limit, 500) rows. */
    public static List<Message> list(DataSource dataSource, RunContext ctx, int limit) throws SQLException {
        String sql = "SELECT o.event_id, o.payload->>'messageKind', o.payload->>'recipientEmployeeId', d.state, "
                + "d.transport, coalesce(d.attempts, 0), d.error, d.next_attempt_at, "
                + "coalesce(CASE WHEN d.state = 'sent' THEN d.updated_at ELSE d.attempted_at END, o.created_at) AS at, "
                + "d.message::text, e.attributes->>'name' FROM outbox_events o "
                + "LEFT JOIN notification_deliveries d ON d.environment_id = o.environment_id AND d.run_id = o.run_id "
                + "AND d.event_id = o.event_id LEFT JOIN employees e ON e.environment_id = o.environment_id "
                + "AND e.run_id = o.run_id AND e.employee_id = o.payload->>'recipientEmployeeId' "
                + "WHERE o.environment_id = ? AND o.run_id = ? AND o.event_type LIKE 'notification.%' "
                + "ORDER BY at DESC, o.event_id LIMIT ?";
        List<Message> out = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setInt(3, Math.max(0, Math.min(limit, MAX_ROWS)));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(project(rs));
            }
        }
        return out;
    }

    private static Message project(ResultSet rs) throws SQLException {
        String transport = rs.getString(5);
        String error = rs.getString(7);
        JsonNode message = null;
        try {
            if (rs.getString(10) != null) message = JSON.readTree(rs.getString(10));
        } catch (java.io.IOException e) {
            throw new SQLException("Stored message is unreadable");
        }
        String employeeId = rs.getString(3);
        String name = message != null && message.path("recipient").path("name").isTextual()
                ? message.path("recipient").path("name").asText() : rs.getString(11);
        return new Message(rs.getString(1), rs.getString(2), rs.getString(4) == null ? "pending" : rs.getString(4),
                "captured".equals(transport) || "configured".equals(transport) ? transport : null, rs.getInt(6),
                error == null ? null : CODE.matcher(error).matches() ? error : "unknown", instant(rs, 8), instant(rs, 9),
                new Recipient(employeeId, name), text(message, "subject"), text(message, "textBody"),
                text(message, "htmlBody"), text(message, "offerLink"));
    }

    private static String text(JsonNode message, String field) {
        return message != null && message.path(field).isTextual() ? message.path(field).asText() : null;
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }
}
