package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.EnvironmentGuard;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

/** Exact stock identity from stock_cars: one primary-key read in the caller's run, whatever the release state (as Node). */
public final class StockRowReader implements StockPort {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String READ = "SELECT order_uuid, configuration_id, attributes::text FROM stock_cars "
            + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?";

    private final DataSource source;
    private final EnvironmentGuard guard;

    public StockRowReader(DataSource source, EnvironmentGuard guard) {
        this.source = source;
        this.guard = guard;
    }

    /** The row's stored fields; facts is the attributes.facts object or null. */
    private record Row(String orderUuid, String configurationId, String orderNumber, JsonNode facts) {}

    @Override
    public RunLookup currentRun(String environmentId) {
        try {
            if (environmentId == null) return new RunLookup("source-unavailable", null);
            EnvironmentGuard.RunState run = guard.currentRun();
            if (!environmentId.equals(run.environmentId())) return new RunLookup("source-unavailable", null);
            return new RunLookup("ok", run.runId());
        } catch (RuntimeException e) {
            return new RunLookup("source-unavailable", null);
        }
    }

    @Override
    public StockRead read(EvidenceContext context, String orderUuid) {
        try {
            Row row = fetch(context, orderUuid);
            if (row == null) return new StockRead("not-found", null);
            return new StockRead("ok", new StockRecord(context.runId(), row.orderUuid(), row.orderNumber(),
                    row.configurationId(), row.facts()));
        } catch (SQLException | RuntimeException e) {
            return new StockRead("source-unavailable", null);
        }
    }

    @Override
    public StockClassification classify(EvidenceContext context, String orderUuid) {
        try {
            Row row = fetch(context, orderUuid);
            if (row == null) return StockClassification.notFound();
            JsonNode identity = VehicleDetails.stockSyntheticIdentity(new StockRecord(context.runId(), row.orderUuid(),
                    row.orderNumber(), row.configurationId(), row.facts()));
            JsonNode vehicleId = Js.field(identity, "vehicleId");
            if (!Js.text(vehicleId)) return StockClassification.mismatch();
            return StockClassification.ok(row.configurationId(), vehicleId.textValue());
        } catch (SQLException | RuntimeException e) {
            return StockClassification.unavailable();
        }
    }

    private Row fetch(EvidenceContext context, String orderUuid) throws SQLException {
        if (context == null || !context.trusted() || orderUuid == null) throw new IllegalStateException("Stock is not readable");
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(READ)) {
            ps.setString(1, context.environmentId());
            ps.setString(2, context.runId());
            ps.setString(3, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                JsonNode attributes = parse(rs.getString(3));
                JsonNode number = attributes.get("orderNumber");
                JsonNode facts = attributes.get("facts");
                return new Row(rs.getString(1), rs.getString(2), number != null && number.isTextual() ? number.textValue() : null,
                        facts == null || facts.isNull() ? null : facts);
            }
        }
    }

    private static JsonNode parse(String text) {
        try {
            return JSON.readTree(text);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Stock attributes are not readable JSON");
        }
    }
}
