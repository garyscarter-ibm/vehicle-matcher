package gcsp.api.notify;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.WorkResult;
import io.agroal.api.AgroalDataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.UUID;

/** Seeds the rows a notify HTTP test needs, under ids unique to that test, through the app's own datasource. */
final class NotifySeed {

    private static final ObjectMapper JSON = new ObjectMapper();

    private NotifySeed() {}

    static String uniqueId(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    static RunContext run(Persistence persistence) {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), "notify-test");
    }

    /** An offer intent written through the business path, so its outbox row commits with a changed row. */
    static String offer(Persistence persistence, String offerId, String employeeId) {
        RunContext run = run(persistence);
        Outcome outcome = persistence.runner().execute(run,
                new Command("notify.seed", "seed-" + offerId, JSON.createObjectNode()), tx -> {
                    tx.write("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) "
                            + "VALUES (?, ?, ?, 'cfg', 'available')", run.environmentId(), run.runId(), "car-" + offerId);
                    NotificationIntent.offer(tx, offerId, employeeId);
                    return WorkResult.ok(JSON.createObjectNode());
                });
        assertInstanceOf(Outcome.Committed.class, outcome);
        return "notification:offer:" + offerId + ":v1";
    }

    static void employee(AgroalDataSource ds, RunContext run, String employeeId, String name) throws SQLException {
        update(ds, "INSERT INTO employees (environment_id, run_id, employee_id, attributes) "
                + "VALUES (?, ?, ?, ?::jsonb) ON CONFLICT DO NOTHING",
                run.environmentId(), run.runId(), employeeId, JSON.createObjectNode().put("name", name).toString());
    }

    static void clearRecipient(AgroalDataSource ds, RunContext run, String employeeId) throws SQLException {
        update(ds, "DELETE FROM notification_recipients WHERE environment_id = ? AND run_id = ? AND employee_id = ?",
                run.environmentId(), run.runId(), employeeId);
    }

    static void recipientAddress(AgroalDataSource ds, RunContext run, String employeeId, String address)
            throws SQLException {
        clearRecipient(ds, run, employeeId);
        update(ds, "INSERT INTO notification_recipients (environment_id, run_id, employee_id, delivery_email, version) "
                + "VALUES (?, ?, ?, ?, 1)", run.environmentId(), run.runId(), employeeId, address);
    }

    /** A captured send, as the dispatcher stores it: state sent, transport captured, the rendered message. */
    static void delivered(AgroalDataSource ds, RunContext run, String eventId, OfferMessage message)
            throws SQLException {
        update(ds, "INSERT INTO notification_deliveries (environment_id, run_id, event_id, state, attempts, "
                + "attempted_at, transport, message) VALUES (?, ?, ?, 'sent', 1, now(), 'captured', ?::jsonb)",
                run.environmentId(), run.runId(), eventId, message.toJson().toString());
    }

    static String text(AgroalDataSource ds, String sql, Object... params) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = bind(c, sql, params);
                ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    static long count(AgroalDataSource ds, String sql, Object... params) throws SQLException {
        return Long.parseLong(text(ds, sql, params));
    }

    private static void update(AgroalDataSource ds, String sql, Object... params) throws SQLException {
        try (Connection c = ds.getConnection(); PreparedStatement ps = bind(c, sql, params)) {
            ps.executeUpdate();
        }
    }

    private static PreparedStatement bind(Connection c, String sql, Object... params) throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql);
        for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
        return ps;
    }
}
