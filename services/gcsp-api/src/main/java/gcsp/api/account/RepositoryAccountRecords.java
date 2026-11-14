package gcsp.api.account;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import javax.sql.DataSource;
import org.jboss.logging.Logger;

/** Reads one employee's account facts from PostgreSQL in the records shape; read-only, never repairs a missing key. */
public final class RepositoryAccountRecords implements AccountRecordsPort {

    public static final String UNAVAILABLE = "repository-unavailable";
    private static final Logger LOG = Logger.getLogger(RepositoryAccountRecords.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final DateTimeFormatter MILLIS_Z = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    private static final String[] MEMBERSHIP = {"name", "companyId", "schemeId", "gradeId", "entitlementSlotId"};

    // One statement gives record and slots one snapshot; "C" collation keeps slot order stable.
    private static final String CONTRACT_SQL = "SELECT r.record_set_id, r.record::text, r.version, s.slot_id, s.capacity, "
            + "s.attributes::text, s.version, s.created_at, s.updated_at "
            + "FROM employee_account_records r LEFT JOIN entitlement_slots s ON s.environment_id = r.environment_id "
            + "AND s.run_id = r.run_id AND s.employee_id = r.employee_id "
            + "WHERE r.environment_id = ? AND r.run_id = ? AND r.employee_id = ? ORDER BY s.slot_id COLLATE \"C\"";
    private static final String DRIVERS_SQL = "SELECT record_set_id, record::text, version FROM employee_account_records "
            + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?";
    private static final String EMPLOYMENT_SQL = "SELECT attributes::text FROM employees "
            + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?";

    private final DataSource dataSource;

    public RepositoryAccountRecords(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
        return query(EMPLOYMENT_SQL, environmentId, runId, employeeId, rs -> {
            if (!rs.next()) return SourceResult.notFound();
            JsonNode attributes = JSON.readTree(rs.getString(1));
            ObjectNode out = F.objectNode().put("employeeId", employeeId);
            for (String key : MEMBERSHIP) {
                if (attributes.has(key)) out.set(key, attributes.get(key));
            }
            return SourceResult.ok(out);
        });
    }

    @Override
    public SourceResult readEmployeeContract(AccountScope scope) {
        return query(CONTRACT_SQL, scope.environmentId(), scope.runId(), scope.employeeId(), rs -> {
            if (!rs.next()) return SourceResult.notFound();
            JsonNode record = JSON.readTree(rs.getString(2));
            ObjectNode out = base(scope, rs.getString(1), rs.getLong(3));
            for (String key : new String[] {"source", "account", "contracts", "histories"}) {
                if (record.has(key)) out.set(key, record.get(key));
            }
            ArrayNode slots = out.putArray("slots");
            do {
                String slotId = rs.getString(4);
                if (slotId != null) slots.add(slot(scope, rs, slotId));
            } while (rs.next());
            return SourceResult.ok(out);
        });
    }

    @Override
    public SourceResult readDrivers(AccountScope scope) {
        return query(DRIVERS_SQL, scope.environmentId(), scope.runId(), scope.employeeId(), rs -> {
            if (!rs.next()) return SourceResult.notFound();
            JsonNode record = JSON.readTree(rs.getString(2));
            ObjectNode out = base(scope, rs.getString(1), rs.getLong(3));
            for (String key : new String[] {"source", "drivers", "employeeFacts"}) {
                if (record.has(key)) out.set(key, record.get(key));
            }
            return SourceResult.ok(out);
        });
    }

    private static ObjectNode base(AccountScope scope, String recordSetId, long version) {
        ObjectNode out = F.objectNode().put("runId", scope.runId()).put("environmentId", scope.environmentId())
                .put("employeeId", scope.employeeId()).put("recordSetId", recordSetId);
        out.set("repositoryVersion", number(version));
        return out;
    }

    /** Typed columns win over any same-named attribute key; absent attribute keys stay absent. */
    private static ObjectNode slot(AccountScope scope, ResultSet rs, String slotId) throws SQLException, JsonProcessingException {
        ObjectNode slot = F.objectNode();
        slot.put("employeeId", scope.employeeId()).put("entitlementSlotId", slotId).put("capacity", rs.getInt(5))
                .put("runId", scope.runId());
        slot.set("version", number(rs.getLong(7)));
        slot.put("createdAt", iso(rs.getObject(8, OffsetDateTime.class)));
        slot.put("updatedAt", iso(rs.getObject(9, OffsetDateTime.class)));
        ObjectNode attributes = (ObjectNode) JSON.readTree(rs.getString(6));
        attributes.fields().forEachRemaining(e -> {
            if (!slot.has(e.getKey())) slot.set(e.getKey(), e.getValue());
        });
        return slot;
    }

    private static JsonNode number(long v) {
        return v >= Integer.MIN_VALUE && v <= Integer.MAX_VALUE ? F.numberNode((int) v) : F.numberNode(v);
    }

    private static String iso(OffsetDateTime t) {
        return MILLIS_Z.format(t.withOffsetSameInstant(ZoneOffset.UTC));
    }

    private interface RowReader {
        SourceResult read(ResultSet rs) throws SQLException, JsonProcessingException;
    }

    private SourceResult query(String sql, String environmentId, String runId, String employeeId, RowReader reader) {
        try (Connection c = dataSource.getConnection()) {
            c.setReadOnly(true);
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setString(1, environmentId);
                ps.setString(2, runId);
                ps.setString(3, employeeId);
                try (ResultSet rs = ps.executeQuery()) {
                    return reader.read(rs);
                }
            }
        } catch (SQLException | RuntimeException | JsonProcessingException e) {
            LOG.warnf("Account repository read failed (%s)", e.getClass().getSimpleName());
            return SourceResult.unavailable(UNAVAILABLE);
        }
    }
}
