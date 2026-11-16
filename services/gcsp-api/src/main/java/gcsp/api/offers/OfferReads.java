package gcsp.api.offers;

import gcsp.api.offers.OfferRecords.OfferRecord;
import gcsp.api.offers.OfferRecords.OfferSummary;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** Read-only SQL over buddy_offers, custody_holds and buddy_quotes; every statement is a primary-key or indexed lookup. */
final class OfferReads {

    private static final String JOINED = "SELECT o.offer_id, o.employee_id, o.hold_id, h.state, o.quote_id, "
            + "q.order_uuid, q.configuration_id, o.state, o.expires_at, o.version, h.version, o.created_at, "
            + "o.policy_version, o.brief_version::text, q.quoted_at, q.valid_until, q.monthly_points, q.vehicle_name, "
            + "q.image_path, q.quote->>'gateStatus' FROM buddy_offers o "
            + "JOIN custody_holds h ON h.environment_id = o.environment_id AND h.run_id = o.run_id AND h.hold_id = o.hold_id "
            + "JOIN buddy_quotes q ON q.environment_id = o.environment_id AND q.run_id = o.run_id "
            + "AND q.quote_id = o.quote_id WHERE o.environment_id = ? AND o.run_id = ? AND o.offer_id = ?";

    private static final String FACTS = "SELECT o.employee_id, o.state, o.expires_at, q.vehicle_name, q.monthly_points, "
            + "q.image_path FROM buddy_offers o JOIN buddy_quotes q ON q.environment_id = o.environment_id "
            + "AND q.run_id = o.run_id AND q.quote_id = o.quote_id "
            + "WHERE o.environment_id = ? AND o.run_id = ? AND o.offer_id = ?";

    private static final String OTHER_RUN = "SELECT 1 FROM runs r WHERE r.environment_id = ? AND r.status <> 'active' "
            + "AND EXISTS (SELECT 1 FROM buddy_offers o WHERE o.environment_id = r.environment_id "
            + "AND o.run_id = r.run_id AND o.offer_id = ?)";

    private static final String LIST = "SELECT offer_id, state, created_at FROM buddy_offers WHERE environment_id = ? "
            + "AND run_id = ? AND employee_id = ? ORDER BY created_at DESC, offer_id LIMIT ?";

    record Facts(String employeeId, String state, Instant expiresAt, String vehicleName, Integer monthlyPoints,
            String imagePath) {}

    private final BooleanSupplier active;
    private final Supplier<DataSource> source;

    OfferReads(BooleanSupplier active, Supplier<DataSource> source) {
        this.active = active;
        this.source = source;
    }

    boolean active() {
        return active.getAsBoolean();
    }

    /** The environment's active run, or empty when it has none. */
    Optional<String> activeRun(Connection c, String environmentId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT run_id FROM runs WHERE environment_id = ? AND status = 'active'")) {
            ps.setString(1, environmentId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(rs.getString(1)) : Optional.empty();
            }
        }
    }

    Connection open() throws SQLException {
        return source.get().getConnection();
    }

    /** The joined offer, or empty; a stale flag is returned through {@link #inOtherRun}. */
    Optional<OfferRecord> find(Connection c, String environmentId, String runId, String offerId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(JOINED)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, offerId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(new OfferRecord(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                        rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), instant(rs, 9),
                        rs.getLong(10), rs.getLong(11), instant(rs, 12), rs.getString(13), rs.getString(14),
                        instant(rs, 15), instant(rs, 16), integer(rs, 17), rs.getString(18), rs.getString(19),
                        rs.getString(20)));
            }
        }
    }

    boolean inOtherRun(Connection c, String environmentId, String offerId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(OTHER_RUN)) {
            ps.setString(1, environmentId);
            ps.setString(2, offerId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    List<OfferSummary> list(Connection c, String environmentId, String runId, String employeeId) throws SQLException {
        List<OfferSummary> rows = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement(LIST)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, employeeId);
            ps.setInt(4, OfferRecords.LIST_LIMIT);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(new OfferSummary(rs.getString(1), rs.getString(2), instant(rs, 3)));
            }
        }
        return rows;
    }

    Optional<Facts> facts(Connection c, String environmentId, String runId, String offerId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(FACTS)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, offerId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Optional.empty();
                return Optional.of(new Facts(rs.getString(1), rs.getString(2), instant(rs, 3), rs.getString(4),
                        integer(rs, 5), rs.getString(6)));
            }
        }
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime at = rs.getObject(column, OffsetDateTime.class);
        return at == null ? null : at.toInstant();
    }

    private static Integer integer(ResultSet rs, int column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }
}
