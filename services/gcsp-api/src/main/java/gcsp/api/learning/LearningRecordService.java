package gcsp.api.learning;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import javax.sql.DataSource;

/**
 * Port of Node createObservedLearningRecordService().readRecords over PostgreSQL. Greg only; no route, as in Node.
 * Every source is read in one READ ONLY REPEATABLE READ transaction, so one snapshot replaces Node's two fenced reads.
 */
@ApplicationScoped
public class LearningRecordService {

    public static final String DECLINE_REASONS_KEY = "offer.declineReasons.v1";

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final Supplier<DataSource> dataSource;
    private final PolicyService policy;
    private final LearningClock clock;
    private final LearningOutcomeRows outcomes;

    @Inject
    public LearningRecordService(Persistence persistence, Instance<AgroalDataSource> dataSource, PolicyService policy,
            LearningClock clock, LearningOutcomeRows outcomes) {
        this(() -> persistence.active() ? dataSource.get() : null, policy, clock, outcomes);
    }

    /** A null supplier result means persistence is not configured. */
    public LearningRecordService(Supplier<DataSource> dataSource, PolicyService policy, LearningClock clock,
            LearningOutcomeRows outcomes) {
        this.dataSource = dataSource;
        this.policy = policy;
        this.clock = clock;
        this.outcomes = outcomes;
    }

    public LearningRecordResult readRecords(Principal principal) {
        if (principal == null) return LearningRecordResult.unavailable("not-configured");
        try {
            Access.requireAnyRole(principal, Role.GREG);
        } catch (IdentityRefusal e) {
            return LearningRecordResult.failure(e.status(), e.code(), e.reason(), e.retryable());
        }
        if (blank(principal.environmentId()) || blank(principal.runId()) || blank(principal.policyVersion())) {
            return LearningRecordResult.unavailable("not-configured");
        }
        String runId = principal.runId();
        try {
            LearningClock.Reading time = clock.now(new RunContext(principal.environmentId(), runId, "learning:" + principal.subject()));
            if (!validClock(time)) return LearningRecordResult.unavailable("clock-invalid");
            JsonNode registry = declineRegistry(runId, time.now(), principal.policyVersion());
            List<String> codes = registry == null ? null : declineCodes(registry);
            if (codes == null) return LearningRecordResult.unavailable("decline-reasons-unavailable");
            DataSource source = dataSource.get();
            if (source == null) return LearningRecordResult.unavailable("persistence-not-configured");
            return snapshot(source, principal, time, registry, codes);
        } catch (LearningSourceException | JsonProcessingException e) {
            return LearningRecordResult.unavailable("source-invalid");
        } catch (SQLException e) {
            return LearningRecordResult.unavailable("database-unavailable");
        } catch (RuntimeException e) {
            return LearningRecordResult.unavailable("source-invalid");
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static boolean validClock(LearningClock.Reading time) {
        if (time == null || time.now() == null || !Instants.valid(time.now())) return false;
        Object v = time.clockVersion();
        return v instanceof String s && !s.isEmpty() || v instanceof Integer i && i > 0 || v instanceof Long l && l > 0;
    }

    /** The registry's value ({schemaVersion, reasons}) at the principal's version; null when it is not exactly that. */
    private JsonNode declineRegistry(String runId, String now, String policyVersion) {
        PolicyResult out = policy.getAssumption(DECLINE_REASONS_KEY, new PolicyRead(runId, now, policyVersion));
        if (!out.ok() || !policyVersion.equals(out.policyVersion()) || out.value() == null) return null;
        return out.value().get("value");
    }

    /** Node declineCodes: schemaVersion 1 and a non-empty list of unique non-empty text codes, else null. */
    private static List<String> declineCodes(JsonNode registry) {
        JsonNode reasons = Js.get(registry, "reasons");
        if (!Js.isNumberEqual(Js.get(registry, "schemaVersion"), 1) || reasons == null || !reasons.isArray() || reasons.isEmpty()) return null;
        Set<String> codes = new LinkedHashSet<>();
        for (JsonNode reason : reasons) {
            JsonNode code = Js.get(reason, "code");
            if (!Js.isText(code) || code.textValue().isEmpty() || !codes.add(code.textValue())) return null;
        }
        return new ArrayList<>(codes);
    }

    private LearningRecordResult snapshot(DataSource source, Principal principal, LearningClock.Reading time, JsonNode registry,
            List<String> codes) throws SQLException, JsonProcessingException {
        String env = principal.environmentId();
        String runId = principal.runId();
        try (Connection c = source.getConnection()) {
            try {
                c.setReadOnly(true);
                c.setAutoCommit(false);
                c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                if (!runActive(c, env, runId)) {
                    return LearningRecordResult.failure("conflict", "stale-run", "The run is retired or does not exist.", false);
                }
                ObjectNode rows = JSON.objectNode();
                ArrayNode briefs = readBriefs(c, env, runId);
                rows.set("briefs", briefs);
                rows.set("employees", employees(briefs, runId));
                rows.set("entitlement_slots", readSlots(c, env, runId));
                LearningOutcomeRows.Rows outcome = outcomes.read(c, env, runId);
                rows.set("offers", array(outcome.offers()));
                rows.set("holds", array(outcome.holds()));
                rows.set("decisions", array(outcome.decisions()));
                rows.set("quotes", array(outcome.quotes()));
                rows.set("stock", readStock(c, env, runId, outcome));
                rows.set("receipts", array(outcome.receipts()));
                ArrayNode records = ObservedLearningProjection.project(rows, runId, time.now(), time.clockVersion(), codes);
                ObjectNode clockValue = JSON.objectNode();
                clockValue.put("runId", runId).put("now", time.now());
                if (time.clockVersion() instanceof String s) clockValue.put("clockVersion", s);
                else clockValue.put("clockVersion", ((Number) time.clockVersion()).longValue());
                ObjectNode value = JSON.objectNode();
                value.put("runId", runId).put("asOf", time.now());
                value.put("projectionVersion", ObservedLearningProjection.projectionVersion(rows, clockValue, registry));
                value.set("records", records);
                ObjectNode sources = value.putObject("outcomeSources");
                if (outcomes.bound()) {
                    sources.put("status", "known");
                } else {
                    sources.put("status", "unknown").put("reason", "outcome-producers-not-bound");
                }
                return LearningRecordResult.ok(value);
            } finally {
                release(c);
            }
        }
    }

    private static void release(Connection c) {
        try {
            c.rollback();
            c.setReadOnly(false);
            c.setAutoCommit(true);
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
        } catch (SQLException ignored) {
            // The pool discards a connection that cannot be reset.
        }
    }

    /** The first statement of the snapshot: also the run's status, so a retired run is refused. */
    private static boolean runActive(Connection c, String env, String runId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT status FROM runs WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, env);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && "active".equals(rs.getString(1));
            }
        }
    }

    /** Every brief row is an immutable confirmed version (engage, pause and preference updates copy the content). */
    private static ArrayNode readBriefs(Connection c, String env, String runId) throws SQLException, JsonProcessingException {
        ArrayNode out = JSON.arrayNode();
        try (PreparedStatement ps = c.prepareStatement("SELECT employee_id, brief_version, policy_version, confirmed_at, content::text "
                + "FROM briefs WHERE environment_id = ? AND run_id = ? ORDER BY employee_id, brief_version")) {
            ps.setString(1, env);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    JsonNode content = MAPPER.readTree(rs.getString(5));
                    ObjectNode row = out.addObject();
                    row.put("runId", runId).put("employeeId", rs.getString(1)).put("briefVersion", rs.getLong(2));
                    row.put("status", "confirmed").put("policyVersion", rs.getString(3));
                    row.put("confirmedAt", PolicyClock.iso(rs.getObject(4, OffsetDateTime.class).toInstant()));
                    if (content.has("preferences")) row.set("preferences", content.get("preferences"));
                    if (content.has("essentials")) row.set("essentials", content.get("essentials"));
                }
            }
        }
        return out;
    }

    /** Java employees hold no roles and a brief owner may be absent; only an employee writes their own brief, so each owner is one. */
    private static ArrayNode employees(ArrayNode briefs, String runId) {
        ArrayNode out = JSON.arrayNode();
        Set<String> seen = new HashSet<>();
        for (JsonNode b : briefs) {
            String id = b.get("employeeId").textValue();
            if (seen.add(id)) out.addObject().put("runId", runId).put("employeeId", id).putArray("roles").add("employee");
        }
        return out;
    }

    private static ArrayNode readSlots(Connection c, String env, String runId) throws SQLException {
        ArrayNode out = JSON.arrayNode();
        try (PreparedStatement ps = c.prepareStatement("SELECT slot_id, employee_id FROM entitlement_slots "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY slot_id")) {
            ps.setString(1, env);
            ps.setString(2, runId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.addObject().put("runId", runId).put("entitlementSlotId", rs.getString(1)).put("employeeId", rs.getString(2));
            }
        }
        return out;
    }

    /** Stock only corroborates an allocated hold, so one statement reads just the cars the outcome rows name. */
    private static ArrayNode readStock(Connection c, String env, String runId, LearningOutcomeRows.Rows rows) throws SQLException {
        Set<String> orders = new LinkedHashSet<>();
        for (List<JsonNode> list : List.of(rows.offers(), rows.holds(), rows.quotes())) {
            for (JsonNode row : list) if (Js.isText(Js.get(row, "orderUuid"))) orders.add(row.get("orderUuid").textValue());
        }
        ArrayNode out = JSON.arrayNode();
        try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid, configuration_id, state FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY (?) ORDER BY order_uuid")) {
            ps.setString(1, env);
            ps.setString(2, runId);
            Array list = c.createArrayOf("text", orders.toArray());
            try {
                ps.setArray(3, list);
            } finally {
                list.free();
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.addObject().put("runId", runId).put("orderUuid", rs.getString(1)).put("configurationId", rs.getString(2))
                            .put("state", rs.getString(3));
                }
            }
        }
        return out;
    }

    private static ArrayNode array(List<JsonNode> rows) {
        ArrayNode out = JSON.arrayNode();
        rows.forEach(out::add);
        return out;
    }
}
