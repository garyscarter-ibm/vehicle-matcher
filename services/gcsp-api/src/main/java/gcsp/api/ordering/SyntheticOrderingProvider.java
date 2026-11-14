package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.postgresql.util.PGobject;

/**
 * The simulated ordering system: its answer is stored once per operation in its own table over its own short
 * autocommit connection (an external system never shares the caller's transaction). Nothing is fabricated.
 */
public final class SyntheticOrderingProvider implements OrderingProviderPort {

    static final String PROVIDER = "synthetic-ordering:v1";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String INVALID = "invalid-ordering-operation";
    private static final String DOWN = "ordering-store-unavailable";

    private final DataSource dataSource;

    public SyntheticOrderingProvider(DataSource dataSource) {
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
    public ProviderResponse execute(OrderingScope scope, ProviderRequest r) {
        if (!valid(scope, r)) return ProviderResponse.of(Status.UNSUPPORTED, scope, r, INVALID);
        ObjectNode outcome = JSON.createObjectNode();
        outcome.put("status", "confirmed");
        outcome.put("operationId", r.operationId());
        outcome.put("orderUuid", r.orderUuid());
        outcome.put("orderNumber", r.orderNumber());
        outcome.put("configurationId", r.configurationId());
        outcome.put("orderStatus", r.firstApprovalStage());
        outcome.put("providerReference", PROVIDER + ":" + r.operationId());
        outcome.put("fictional", true);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO ordering_synthetic_receipts (environment_id, "
                    + "run_id, operation_id, input_digest, outcome) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")) {
                PGobject o = new PGobject();
                o.setType("jsonb");
                o.setValue(outcome.toString());
                ps.setString(1, scope.environmentId());
                ps.setString(2, scope.runId());
                ps.setString(3, r.operationId());
                ps.setString(4, r.inputDigest());
                ps.setObject(5, o);
                ps.executeUpdate();
            }
            return stored(c, scope, r);
        } catch (SQLException e) {
            return ProviderResponse.of(Status.UNKNOWN, scope, r, DOWN);
        }
    }

    @Override
    public ProviderResponse reconcile(OrderingScope scope, ProviderRequest r) {
        if (!valid(scope, r)) return ProviderResponse.of(Status.UNSUPPORTED, scope, r, INVALID);
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            return stored(c, scope, r);
        } catch (SQLException e) {
            return ProviderResponse.of(Status.UNKNOWN, scope, r, DOWN);
        }
    }

    private static ProviderResponse stored(Connection c, OrderingScope scope, ProviderRequest r) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT input_digest, outcome::text FROM ordering_synthetic_receipts "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ?")) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, r.operationId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return ProviderResponse.of(Status.NOT_FOUND, scope, r, null);
                if (!rs.getString(1).equals(r.inputDigest())) {
                    return ProviderResponse.of(Status.UNKNOWN, scope, r, "idempotency-input-changed");
                }
                JsonNode o = JSON.readTree(rs.getString(2));
                return new ProviderResponse(Status.CONFIRMED, o.path("operationId").asText(), scope.runId(),
                        o.path("orderUuid").asText(), o.path("orderNumber").asText(), o.path("configurationId").asText(),
                        o.path("orderStatus").asText(), o.path("providerReference").asText(), null,
                        o.path("fictional").asBoolean(false));
            } catch (IOException e) {
                throw new SQLException("Stored ordering receipt is unreadable");
            }
        }
    }

    private static boolean valid(OrderingScope scope, ProviderRequest r) {
        return r != null && scope != null && notBlank(r.operationId()) && r.operationId().equals(r.idempotencyKey())
                && notBlank(r.orderUuid()) && r.orderNumber() != null && r.orderNumber().matches("\\d{7}")
                && notBlank(r.configurationId()) && notBlank(r.firstApprovalStage())
                && r.inputDigest() != null && r.inputDigest().matches("[0-9a-f]{64}");
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
