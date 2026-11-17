package gcsp.api.demand;

import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Offers and decisions of the run read from native PostgreSQL inside the projection's snapshot connection. */
@ApplicationScoped
public class PostgresOfferRecordsAdapter implements OfferRecordsPort {

    static final String OFFERS = "SELECT offer_id, employee_id, order_uuid, hold_id, state, brief_version, policy_version "
            + "FROM buddy_offers WHERE environment_id = ? AND run_id = ?";
    static final String DECISIONS = "SELECT offer_id, employee_id, decision, reason_code, (versions->>'briefVersion')::bigint, "
            + "versions->>'policy' FROM offer_decisions WHERE environment_id = ? AND run_id = ?";

    @Override
    public Optional<OfferRecords> read(Connection snapshot, DemandScope scope) throws SQLException {
        List<OfferRow> offers = new ArrayList<>();
        try (PreparedStatement ps = snapshot.prepareStatement(OFFERS)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    offers.add(new OfferRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                            rs.getLong(6), rs.getString(7)));
                }
            }
        }
        List<DecisionRow> decisions = new ArrayList<>();
        try (PreparedStatement ps = snapshot.prepareStatement(DECISIONS)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    long brief = rs.getLong(5);
                    Long briefVersion = rs.wasNull() ? null : brief;
                    decisions.add(new DecisionRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), briefVersion,
                            rs.getString(6)));
                }
            }
        }
        return Optional.of(new OfferRecords(List.copyOf(offers), List.copyOf(decisions)));
    }
}
