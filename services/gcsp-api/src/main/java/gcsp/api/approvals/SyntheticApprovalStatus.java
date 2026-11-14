package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.postgresql.util.PGobject;

/**
 * The simulated ordering system: its decision is the scenario-keyed intent, stored once in its own table over its
 * own short autocommit connection (an external system never shares the caller's transaction).
 */
public final class SyntheticApprovalStatus implements ApprovalStatusProvider {

    static final String PROVIDER = "synthetic-ordering-status:v1";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String INVALID = "invalid-status-operation";

    private final DataSource dataSource;

    public SyntheticApprovalStatus(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public String mode() {
        return "synthetic";
    }

    @Override
    public String provider() {
        return PROVIDER;
    }

    @Override
    public Response requestDecision(RunContext ctx, Request r) {
        if (!valid(ctx, r) || r.occurredAt() == null) return Response.of(Status.UNSUPPORTED, r, INVALID, "The request is malformed.");
        ObjectNode outcome = JSON.createObjectNode();
        outcome.put("status", "confirmed");
        outcome.put("operationId", r.operationId());
        outcome.put("orderUuid", r.orderUuid());
        outcome.put("stage", r.stage());
        outcome.put("state", r.intendedDecision());
        outcome.put("providerReference", PROVIDER + ":" + r.operationId());
        outcome.put("decidedAt", Time.format(r.occurredAt()));
        outcome.put("fictional", true);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO approval_synthetic_decisions (environment_id, "
                    + "run_id, operation_id, input_digest, outcome) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")) {
                PGobject o = new PGobject();
                o.setType("jsonb");
                o.setValue(outcome.toString());
                ps.setString(1, ctx.environmentId());
                ps.setString(2, ctx.runId());
                ps.setString(3, r.operationId());
                ps.setString(4, r.inputDigest());
                ps.setObject(5, o);
                ps.executeUpdate();
            }
            return stored(c, ctx, r);
        } catch (SQLException e) {
            return Response.of(Status.UNAVAILABLE, r, "status-store-unavailable", "The approval system could not be reached.");
        }
    }

    @Override
    public Response reconcile(RunContext ctx, Request r) {
        if (!valid(ctx, r)) return Response.of(Status.UNSUPPORTED, r, INVALID, "The request is malformed.");
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            return stored(c, ctx, r);
        } catch (SQLException e) {
            return Response.of(Status.UNAVAILABLE, r, "status-store-unavailable", "The approval system could not be reached.");
        }
    }

    private static Response stored(Connection c, RunContext ctx, Request r) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT input_digest, outcome::text FROM approval_synthetic_decisions "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, r.operationId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return Response.of(Status.NOT_FOUND, r, null, null);
                if (!rs.getString(1).equals(r.inputDigest())) {
                    return Response.of(Status.CONFLICT, r, "idempotency-input-changed", "The decision was recorded with different input.");
                }
                JsonNode o = JSON.readTree(rs.getString(2));
                return new Response(Status.CONFIRMED, o.path("operationId").asText(), o.path("orderUuid").asText(),
                        o.path("stage").asText(), o.path("state").asText(), o.path("providerReference").asText(),
                        Time.parse(o.path("decidedAt").asText(null)), null, null, o.path("fictional").asBoolean(false));
            } catch (IOException e) {
                throw new SQLException("Stored decision is unreadable");
            }
        }
    }

    private static boolean valid(RunContext ctx, Request r) {
        return r != null && ctx != null && r.operationId() != null && !r.operationId().isBlank()
                && ctx.runId().equals(r.runId()) && r.orderUuid() != null && r.stage() != null
                && ("approved".equals(r.intendedDecision()) || "declined".equals(r.intendedDecision()))
                && r.inputDigest() != null && r.inputDigest().matches("[0-9a-f]{64}");
    }
}
