package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/** A return operation's stored provider payload joined to its pending-operation custody row, by primary key. */
record OpRow(String operationId, String orderUuid, String step, JsonNode payload, String inputDigest, String state,
        long version, int attempts) {

    private static final String SQL = "SELECT o.order_uuid, o.step, o.payload::text, o.input_digest, p.state, p.version, "
            + "p.attempts FROM return_operations o JOIN pending_operations p ON p.environment_id = o.environment_id "
            + "AND p.run_id = o.run_id AND p.operation_id = o.operation_id "
            + "WHERE o.environment_id = ? AND o.run_id = ? AND o.operation_id = ?";

    boolean open() {
        return "intent".equals(state) || "pending".equals(state);
    }

    static OpRow read(Connection c, RunContext ctx, String operationId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(SQL)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, operationId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? map(operationId, rs) : null;
            }
        }
    }

    static OpRow read(Tx tx, String operationId) throws SQLException {
        RunContext c = tx.context();
        return tx.first(SQL, rs -> map(operationId, rs), c.environmentId(), c.runId(), operationId).orElse(null);
    }

    private static OpRow map(String operationId, ResultSet rs) throws SQLException {
        try {
            return new OpRow(operationId, rs.getString(1), rs.getString(2), ReturnJson.JSON.readTree(rs.getString(3)),
                    rs.getString(4), rs.getString(5), rs.getLong(6), rs.getInt(7));
        } catch (IOException e) {
            throw new SQLException("Stored return operation is unreadable");
        }
    }
}
