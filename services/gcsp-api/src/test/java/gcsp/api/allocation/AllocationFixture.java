package gcsp.api.allocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.postgresql.ds.PGSimpleDataSource;

/** A fresh, uniquely named migrated schema with the claimed environment and active run-1; dropped by close(). */
final class AllocationFixture implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String ENV = "test-env";
    static final String RUN = "run-1";
    static final String POLICY = "gcsp-policy-v1";
    static final Instant T0 = Instant.parse("2026-11-14T09:00:00Z");
    private static final AtomicInteger SEQ = new AtomicInteger();

    final String url;
    final String schema;

    private AllocationFixture(String url, String schema) {
        this.url = url;
        this.schema = schema;
    }

    /** Skips only when GCSP_TEST_DATABASE_URL is unset. */
    static AllocationFixture create() throws SQLException {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        String schema = "gcsp_a_" + Long.toHexString(System.nanoTime()) + "_" + Integer.toHexString(SEQ.incrementAndGet());
        Flyway.configure().dataSource(plain(url)).schemas(schema).defaultSchema(schema).createSchemas(true)
                .locations("classpath:db/migration").load().migrate();
        AllocationFixture f = new AllocationFixture(url, schema);
        f.update("INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", ENV);
        f.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", ENV, RUN);
        return f;
    }

    static PGSimpleDataSource plain(String url) throws SQLException {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(url);
        return ds;
    }

    /** A new connection source bound to this schema; each call is an independent "pool". */
    PGSimpleDataSource pool() throws SQLException {
        PGSimpleDataSource ds = plain(url);
        ds.setCurrentSchema(schema);
        return ds;
    }

    RunContext ctx() {
        return new RunContext(ENV, RUN, "test");
    }

    static AllocationScope scope() {
        return new AllocationScope(ENV, RUN, POLICY, T0, 1);
    }

    static JsonNode json(String text) {
        try {
            return JSON.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    /** An engaged Buddy employee with one slot, one current contract ending on {@code contractEnd} and brief v1. */
    void employee(String id, String contractEnd) throws SQLException {
        employee(id, contractEnd, 1, true);
    }

    void employee(String id, String contractEnd, int capacity, boolean engaged) throws SQLException {
        String slot = "slot-" + id;
        ObjectNode attrs = JSON.createObjectNode().put("companyId", "co-1").put("schemeId", "scheme-1")
                .put("gradeId", "g-1").put("entitlementSlotId", slot);
        update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, ?, ?, ?::jsonb)", ENV,
                RUN, id, attrs.toString());
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, ?)", ENV, RUN, slot, id, capacity);
        if (contractEnd != null) {
            ObjectNode record = JSON.createObjectNode();
            ArrayNode contracts = record.putArray("contracts");
            contracts.addObject().put("status", "current").put("employeeId", id).put("schemeId", "scheme-1")
                    .put("slotId", slot).put("contractEndDate", contractEnd);
            update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record) "
                    + "VALUES (?, ?, ?, 'set-1', ?::jsonb)", ENV, RUN, id, record.toString());
        }
        brief(id, 1, digest(id + "-v1"), engaged);
    }

    /** Sets the employee's current confirmed brief to {@code version} (inserting the row and moving the head). */
    void brief(String employeeId, long version, String semanticDigest, boolean engaged) throws SQLException {
        update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 0) "
                + "ON CONFLICT DO NOTHING", ENV, RUN, employeeId);
        String buddy = engaged
                ? "{\"searchConsent\":true,\"holdConsent\":true,\"paused\":false,\"permissionVersion\":1}"
                : "{\"searchConsent\":true,\"holdConsent\":false,\"paused\":false,\"permissionVersion\":1}";
        update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, "
                + "operation, content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) "
                + "VALUES (?, ?, ?, ?, ?, 'confirmed', '{}'::jsonb, ?::jsonb, ?, ?, 'test', now(), ?)", ENV, RUN,
                employeeId, version, version == 1 ? null : version - 1, buddy, semanticDigest, POLICY,
                "brief-" + employeeId + "-" + version);
        update("UPDATE brief_heads SET brief_version = ? WHERE environment_id = ? AND run_id = ? AND employee_id = ?",
                version, ENV, RUN, employeeId);
    }

    /** A released car visible to every employee of co-1 and scheme-1. */
    void car(String orderUuid) throws SQLException {
        ObjectNode attrs = JSON.createObjectNode();
        ObjectNode visibility = attrs.putObject("visibility");
        visibility.putArray("companyIds").add("co-1");
        visibility.putArray("schemeIds").add("scheme-1");
        visibility.putNull("employeeIds");
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, ?, 'released', ?::jsonb)", ENV, RUN, orderUuid, "cfg-" + orderUuid, attrs.toString());
    }

    /** An occupying or allocated hold inserted directly (a cart hold, as another Story would leave it). */
    void hold(String holdId, String orderUuid, String employeeId, int unit, String state) throws SQLException {
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'cart', ?, now() + interval '1 hour')", ENV,
                RUN, holdId, orderUuid, employeeId, "slot-" + employeeId, unit, state);
    }

    /** An allocated or occupying hold with explicit attributes (for example a renewal id). */
    void hold(String holdId, String orderUuid, String employeeId, int unit, String state, String attributes)
            throws SQLException {
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at, attributes) VALUES (?, ?, ?, ?, ?, ?, ?, 'cart', ?, "
                + "now() + interval '1 hour', ?::jsonb)", ENV, RUN, holdId, orderUuid, employeeId, "slot-" + employeeId,
                unit, state, attributes);
    }

    /** A declined Buddy offer for the employee and car, taken under {@code briefVersion}. */
    void declinedOffer(String employeeId, String orderUuid, long briefVersion) throws SQLException {
        String key = employeeId + "-" + orderUuid;
        update("INSERT INTO allocation_runs (environment_id, run_id, allocation_id, trigger_type, source_event_id, "
                + "input_digest, state, evaluated_at, clock_version, policy_version, plan, contender_count) "
                + "VALUES (?, ?, 'alloc-old', 'stock-released', 'evt-old', ?, 'pending', now(), 1, ?, '{}'::jsonb, 0) "
                + "ON CONFLICT DO NOTHING", ENV, RUN, digest("old"), POLICY);
        update("INSERT INTO buddy_quotes (environment_id, run_id, quote_id, allocation_id, order_uuid, employee_id, "
                + "slot_id, configuration_id, policy_version, quoted_at, quote) VALUES (?, ?, ?, 'alloc-old', ?, ?, ?, ?, ?, "
                + "now(), '{}'::jsonb)", ENV, RUN, "q-" + key, orderUuid, employeeId, "slot-" + employeeId,
                "cfg-" + orderUuid, POLICY);
        update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'buddy-offer', 'released', now())", ENV, RUN,
                "h-" + key, orderUuid, employeeId, "slot-" + employeeId);
        update("INSERT INTO buddy_offers (environment_id, run_id, offer_id, hold_id, quote_id, employee_id, order_uuid, "
                + "state, brief_version, policy_version, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'declined', ?, ?, now())",
                ENV, RUN, "o-" + key, "h-" + key, "q-" + key, employeeId, orderUuid, briefVersion, POLICY);
    }

    static String digest(String seed) {
        return gcsp.api.persistence.Canonical.digest(JSON.getNodeFactory().textNode(seed));
    }

    long count(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String text(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    List<String> column(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                List<String> out = new java.util.ArrayList<>();
                while (rs.next()) out.add(rs.getString(1));
                return out;
            }
        }
    }

    void update(String sql, Object... params) throws SQLException {
        try (Connection c = pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Occupying holds, as "employee:car" pairs in hold order. */
    List<String> occupying() throws SQLException {
        return column("SELECT employee_id || ':' || order_uuid FROM custody_holds WHERE state IN "
                + "('active', 'claim-pending', 'release-pending', 'selection-pending') ORDER BY employee_id, order_uuid");
    }

    /** The ordered contender list of an allocation, as "employee:car" pairs. */
    List<String> contenders(String allocationId) throws SQLException {
        return column("SELECT employee_id || ':' || order_uuid FROM allocation_contenders WHERE allocation_id = ? "
                + "ORDER BY ordinal", allocationId);
    }

    @Override
    public void close() throws SQLException {
        try (Connection c = plain(url).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
