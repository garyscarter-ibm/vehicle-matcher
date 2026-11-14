package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;

/** One return_outcomes row, keyed by the order's primary key. */
final class OutcomeRow {

    private static final String READ = "SELECT order_uuid, operation_id, expected_outcome, confirm_after, state, occurred_at, "
            + "provider_reference, appointment::text, location::text, old_contract_id, entitlement_slot_id, exception_type, "
            + "policy_version, pending_last_known, blocked_code, blocked_reason, version FROM return_outcomes "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?";

    String orderUuid, operationId, expectedOutcome, state, providerReference, oldContractId, entitlementSlotId, exceptionType;
    String policyVersion, pendingLastKnown, blockedCode, blockedReason;
    Instant confirmAfter, occurredAt;
    JsonNode appointment, location;
    long version;

    boolean awaiting() {
        return "awaiting".equals(state);
    }

    boolean done() {
        return !awaiting();
    }

    static OutcomeRow read(Connection c, RunContext ctx, String orderUuid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(READ)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(rs) : null;
            }
        }
    }

    static OutcomeRow read(Tx tx, String orderUuid) throws SQLException {
        RunContext c = tx.context();
        return tx.first(READ, OutcomeRow::map, c.environmentId(), c.runId(), orderUuid).orElse(null);
    }

    private static OutcomeRow map(ResultSet rs) throws SQLException {
        try {
            OutcomeRow r = new OutcomeRow();
            r.orderUuid = rs.getString(1);
            r.operationId = rs.getString(2);
            r.expectedOutcome = rs.getString(3);
            r.confirmAfter = instant(rs, 4);
            r.state = rs.getString(5);
            r.occurredAt = instant(rs, 6);
            r.providerReference = rs.getString(7);
            r.appointment = ReturnJson.JSON.readTree(rs.getString(8));
            r.location = ReturnJson.JSON.readTree(rs.getString(9));
            r.oldContractId = rs.getString(10);
            r.entitlementSlotId = rs.getString(11);
            r.exceptionType = rs.getString(12);
            r.policyVersion = rs.getString(13);
            r.pendingLastKnown = rs.getString(14);
            r.blockedCode = rs.getString(15);
            r.blockedReason = rs.getString(16);
            r.version = rs.getLong(17);
            return r;
        } catch (IOException e) {
            throw new SQLException("Stored return outcome is unreadable");
        }
    }

    private static Instant instant(ResultSet rs, int i) throws SQLException {
        OffsetDateTime t = rs.getObject(i, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    /** A new awaiting outcome that waits on its operation. */
    void insert(Tx tx) throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO return_outcomes (environment_id, run_id, order_uuid, operation_id, expected_outcome, "
                + "confirm_after, state, appointment, location, old_contract_id, entitlement_slot_id, exception_type, "
                + "policy_version, pending_last_known) VALUES (?, ?, ?, ?, ?, ?, 'awaiting', ?, ?, ?, ?, ?, ?, 'waiting')",
                c.environmentId(), c.runId(), orderUuid, operationId, expectedOutcome, confirmAfter, appointment, location,
                oldContractId, entitlementSlotId, exceptionType, policyVersion);
    }

    /** Writes the settle columns if the stored version is still {@code expected}; else stale-version. */
    void update(Tx tx, long expected) throws SQLException {
        RunContext c = tx.context();
        tx.cas("UPDATE return_outcomes SET state = ?, occurred_at = ?, provider_reference = ?, pending_last_known = ?, "
                + "blocked_code = ?, blocked_reason = ?, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ? AND version = ?", state, occurredAt,
                providerReference, pendingLastKnown, blockedCode, blockedReason, c.environmentId(), c.runId(), orderUuid,
                expected);
    }
}
