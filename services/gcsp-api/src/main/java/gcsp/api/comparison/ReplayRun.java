package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.check;
import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountScope;
import gcsp.api.account.AccountService;
import gcsp.api.account.NoCurrentCarRelationships;
import gcsp.api.account.RepositoryAccountRecords;
import gcsp.api.claims.ClaimScope;
import gcsp.api.claims.ManualClaims;
import gcsp.api.claims.PolicyClaimTiming;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyAccountAdapter;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.sql.Array;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;

/**
 * One isolated run: a throwaway PostgreSQL schema holding the seeded cohort and stock, a virtual clock and the Java
 * claims and account services over it (Node openComparisonRun). close() drops the schema on every exit path.
 */
final class ReplayRun implements AutoCloseable {

    private static final int CHUNK = 500;
    private static final List<String> OCCUPYING = List.of("active", "claim-pending", "release-pending", "selection-pending");

    /** The occupying holder of a car, if any, with its stock row. */
    record CarState(String orderUuid, long version, String state, String holder) {}

    final String schema;
    final String environmentId;
    final String runId;
    final String identityDigest;
    final String policyVersion;
    final String inputHash;
    final ComparisonInputs inputs;
    final PolicyService policy;
    final JsonNode adapterRow;
    final ReplayClock clock;
    final ClaimScope system;
    final Map<String, JsonNode> employees = new HashMap<>();
    final List<ReplayStock.Row> stock;
    private final Function<String, DataSource> sources;
    private final ReplayConnection pool;
    private final AccountService account;
    private ManualClaims claims;
    private Runnable tickHook = () -> {};
    private boolean closed;

    private ReplayRun(Function<String, DataSource> sources, String schema, String environmentId, String runId,
            String identityDigest, ComparisonInputs inputs, PolicyService policy, JsonNode adapterRow,
            List<ReplayStock.Row> stock) {
        this.sources = sources;
        this.schema = schema;
        this.environmentId = environmentId;
        this.runId = runId;
        this.identityDigest = identityDigest;
        this.inputs = inputs;
        this.policy = policy;
        this.adapterRow = adapterRow;
        this.stock = stock;
        this.policyVersion = inputs.manifest().get("policyVersion").textValue();
        this.inputHash = inputs.manifest().get("inputHash").textValue();
        this.clock = new ReplayClock(Instant.ofEpochMilli(
                ComparisonValidation.parseInstant(inputs.manifest().get("startsAt").textValue()).getAsLong()));
        this.system = new ClaimScope(environmentId, runId, "comparison-system", "system", policyVersion);
        this.pool = new ReplayConnection(sources.apply(schema));
        this.account = new AccountService(new RepositoryAccountRecords(pool), new PolicyAccountAdapter(policy), clock,
                new NoCurrentCarRelationships());
        for (JsonNode employee : inputs.employees()) employees.put(employee.get("employeeId").textValue(), employee);
    }

    ManualClaims claims() {
        return claims;
    }

    DataSource pool() {
        return pool;
    }

    /** Extra work a tick also does (Node's clock runs every registered expiry handler); the buddy route adds its own. */
    void onTick(Runnable hook) {
        this.tickHook = hook;
    }

    ClaimScope scope(String employeeId) {
        return new ClaimScope(environmentId, runId, "comparison:" + employeeId, employeeId, policyVersion);
    }

    AccountOutcome account(String employeeId) {
        return account.readAccount(new AccountScope(environmentId, runId, employeeId, null, List.of("employee"), null,
                null, null, null, policyVersion));
    }

    void installClaims(ReplaySelection selection) {
        this.claims = new ManualClaims(pool, clock, new PolicyClaimTiming(policy), selection, (tx, holdId) -> Optional.empty());
    }

    // ---- open ----

    /** Validates the inputs and policy as harness.js does, creates and seeds the schema; the caller must close(). */
    static ReplayRun open(Function<String, DataSource> sources, ComparisonReplay.Request request, PolicyService policy,
            SeedEvaluation evaluation, String route) {
        ComparisonInputs inputs = request.inputs();
        ObjectNode manifest = inputs.manifest();
        check(route != null && !route.isEmpty() && request.codeRevision() != null && !request.codeRevision().isEmpty(), "inputs");
        check(manifest.get("startsAt") != null && ComparisonValidation.parseInstant(manifest.get("startsAt").textValue()).isPresent()
                && manifest.get("policyVersion") != null && manifest.get("policyVersion").isTextual(), "inputHash");
        ObjectNode digestInput = JSON.objectNode();
        digestInput.set("employees", inputs.employees());
        digestInput.set("stock", inputs.stock());
        digestInput.set("releaseSchedule", inputs.releaseSchedule());
        String policyVersion = manifest.get("policyVersion").textValue();
        check(CanonicalJson.digest(digestInput).equals(manifest.get("inputHash").textValue()), "inputHash");
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (JsonNode employee : inputs.employees()) ids.add(employee.get("employeeId").textValue());
        check(ids.size() == inputs.employees().size(), "inputHash");
        check(evaluation.inputHash.equals(manifest.get("inputHash").textValue())
                && manifest.get("generatorVersion") != null && manifest.get("generatorVersion").isTextual(), "evaluation");
        ObjectNode identity = JSON.objectNode();
        identity.set("seed", manifest.get("seed"));
        identity.put("route", route);
        identity.put("inputHash", manifest.get("inputHash").textValue());
        identity.put("policyVersion", policyVersion);
        identity.set("policyHash", manifest.get("policyHash"));
        identity.set("generatorVersion", manifest.get("generatorVersion"));
        String digest = CanonicalJson.digest(identity);
        String environmentId = "comparison-" + digest.substring(0, 32);
        String runId = "comparison-run-" + digest.substring(0, 32);
        PolicyRead read = new PolicyRead(runId, manifest.get("startsAt").textValue(), policyVersion);
        JsonNode adapterRow = ComparisonExperiments.assumption(policy, "comparison.recordAdapter.v1", read);
        JsonNode adapter = adapterRow.get("value");
        check(adapter.path("schemaVersion").asInt() == 1 && "synthetic-mechanics-only".equals(adapter.path("kind").asText())
                && "retain-unknown-no-inference".equals(adapter.path("unknownFieldRule").asText())
                && "sequential-run-local-seven-digits".equals(adapter.path("orderReferences").asText())
                && "first-permitted-driver-contract-location; renewal-date".equals(adapter.path("collectionChoice").asText())
                && adapter.path("fixtureVersion").isTextual() && adapter.path("limitations").isArray(), "comparison.recordAdapter.v1");
        ComparisonExperiments.assumption(policy, "identity.demo.principals", read);
        ComparisonExperiments.assumption(policy, "clock.commands.v1", read);
        for (JsonNode employee : inputs.employees()) {
            PolicyResult allowance = policy.getAllowance(new PolicyContext(null, employee.get("companyId").textValue(),
                    employee.get("schemeId").textValue(), employee.get("gradeId").textValue()), read);
            if (!allowance.ok()) throw refuse(allowance.status(), "allowance");
            JsonNode row = allowance.value();
            check(policyVersion.equals(allowance.policyVersion()) && policyVersion.equals(row.path("policyVersion").asText())
                    && ComparisonValidation.strictEq(row.get("monthlyPoints"), employee.get("pointsAllowance"))
                    && ComparisonValidation.strictEq(row.get("unit"), employee.get("pointsUnit")), "coherent-allowance-variant");
        }
        List<ReplayStock.Row> rows = evaluation.rows;
        String schema = "cmp_" + digest.substring(0, 24) + "_" + HexFormat.of().formatHex(randomBytes());
        ReplayRun run = new ReplayRun(sources, schema, environmentId, runId, digest, inputs, policy, adapterRow, rows);
        try {
            run.create();
            run.seed(rows);
            return run;
        } catch (RuntimeException | Error e) {
            run.close();
            throw e;
        }
    }

    private static byte[] randomBytes() {
        byte[] bytes = new byte[3];
        ThreadLocalRandom.current().nextBytes(bytes);
        return bytes;
    }

    private void create() {
        try {
            DataSource plain = sources.apply(schema);
            Flyway.configure().dataSource(plain).schemas(schema).defaultSchema(schema).createSchemas(true)
                    .locations("classpath:db/migration").load().migrate();
            try (Connection c = plain.getConnection()) {
                update(c, "INSERT INTO environment_identity (environment_id, reset_allowed) VALUES (?, true)", environmentId);
                update(c, "INSERT INTO runs (environment_id, run_id, status) VALUES (?, ?, 'active')", environmentId, runId);
            }
        } catch (SQLException e) {
            throw database(e);
        }
    }

    private static ComparisonRunError database(Exception e) {
        if (Thread.currentThread().isInterrupted()) throw new ComparisonInterrupted();
        return refuse("unavailable", "scratch-database");
    }

    private static void update(Connection c, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    // ---- seeding: one set insert per table per chunk ----

    private void seed(List<ReplayStock.Row> rows) {
        String startsAt = inputs.manifest().get("startsAt").textValue();
        JsonNode modelLines = inputs.manifest().get("configurationSource").get("modelLines");
        try (Connection c = pool.getConnection()) {
            List<JsonNode> list = new ArrayList<>();
            inputs.employees().forEach(list::add);
            for (int from = 0; from < list.size(); from += CHUNK) {
                if (Thread.interrupted()) throw new ComparisonInterrupted();
                List<JsonNode> part = list.subList(from, Math.min(list.size(), from + CHUNK));
                String[] ids = new String[part.size()];
                String[] attributes = new String[part.size()];
                String[] slotAttributes = new String[part.size()];
                String[] records = new String[part.size()];
                String[] recordSets = new String[part.size()];
                for (int i = 0; i < part.size(); i++) {
                    JsonNode employee = part.get(i);
                    String id = employee.get("employeeId").textValue();
                    ids[i] = id;
                    ObjectNode a = JSON.objectNode();
                    a.put("name", id);
                    a.set("companyId", employee.get("companyId"));
                    a.set("schemeId", employee.get("schemeId"));
                    a.set("gradeId", employee.get("gradeId"));
                    a.put("entitlementSlotId", ReplayRecords.slotId(id));
                    attributes[i] = a.toString();
                    ObjectNode slot = JSON.objectNode();
                    slot.put("contractId", ReplayRecords.contractId(id));
                    slot.put("renewalId", ReplayRecords.renewalId(id));
                    slot.put("state", "entitled");
                    slotAttributes[i] = slot.toString();
                    ObjectNode record = ReplayRecords.manualRecord(employee, adapterRow, startsAt, modelLines);
                    recordSets[i] = record.get("recordSetId").textValue();
                    records[i] = record.toString();
                }
                insert(c, "INSERT INTO employees (environment_id, run_id, employee_id, attributes) "
                        + "SELECT ?, ?, t.id, t.a::jsonb FROM unnest(?::text[], ?::text[]) AS t(id, a)", ids, attributes);
                insert(c, "INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                        + "SELECT ?, ?, 'comparison-slot:' || t.id, t.id, 1, t.a::jsonb FROM unnest(?::text[], ?::text[]) AS t(id, a)",
                        ids, slotAttributes);
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO employee_account_records (environment_id, run_id, "
                        + "employee_id, record_set_id, record) SELECT ?, ?, t.id, t.s, t.r::jsonb "
                        + "FROM unnest(?::text[], ?::text[], ?::text[]) AS t(id, s, r)")) {
                    ps.setString(1, environmentId);
                    ps.setString(2, runId);
                    ps.setArray(3, c.createArrayOf("text", ids));
                    ps.setArray(4, c.createArrayOf("text", recordSets));
                    ps.setArray(5, c.createArrayOf("text", records));
                    ps.executeUpdate();
                }
            }
            for (int from = 0; from < rows.size(); from += CHUNK) {
                if (Thread.interrupted()) throw new ComparisonInterrupted();
                List<ReplayStock.Row> part = rows.subList(from, Math.min(rows.size(), from + CHUNK));
                String[] ids = new String[part.size()];
                String[] configurations = new String[part.size()];
                String[] attributes = new String[part.size()];
                for (int i = 0; i < part.size(); i++) {
                    ids[i] = part.get(i).orderUuid();
                    configurations[i] = part.get(i).configurationId();
                    attributes[i] = part.get(i).attributes().toString();
                }
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO stock_cars (environment_id, run_id, order_uuid, "
                        + "configuration_id, state, attributes) SELECT ?, ?, t.id, t.cfg, 'unreleased', t.a::jsonb "
                        + "FROM unnest(?::text[], ?::text[], ?::text[]) AS t(id, cfg, a)")) {
                    ps.setString(1, environmentId);
                    ps.setString(2, runId);
                    ps.setArray(3, c.createArrayOf("text", ids));
                    ps.setArray(4, c.createArrayOf("text", configurations));
                    ps.setArray(5, c.createArrayOf("text", attributes));
                    ps.executeUpdate();
                }
            }
        } catch (SQLException e) {
            throw database(e);
        }
    }

    private void insert(Connection c, String sql, String[] ids, String[] values) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setArray(3, c.createArrayOf("text", ids));
            ps.setArray(4, c.createArrayOf("text", values));
            ps.executeUpdate();
        }
    }

    // ---- run operations ----

    /** One transaction: the tranche's unreleased cars become released and their versions move. */
    void release(String releaseId, List<String> orderUuids) {
        try (Connection c = pool.getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement("UPDATE stock_cars SET state = 'released', version = version + 1, "
                    + "updated_at = now() WHERE environment_id = ? AND run_id = ? AND order_uuid = ANY(?) AND state = 'unreleased'")) {
                ps.setString(1, environmentId);
                ps.setString(2, runId);
                ps.setArray(3, c.createArrayOf("text", orderUuids.toArray()));
                ps.executeUpdate();
            }
            c.commit();
        } catch (SQLException e) {
            throw database(e);
        }
    }

    /** Node's tick: every due manual hold expires. */
    void expireDue() {
        claims.expireDue(system, 1_000_000);
        tickHook.run();
    }

    /** Offer id to its stored state. */
    Map<String, String> offerStates(List<String> offerIds) {
        Map<String, String> out = new HashMap<>();
        try (Connection c = pool.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT offer_id, state FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND offer_id = ANY(?)")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setArray(3, c.createArrayOf("text", offerIds.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), rs.getString(2));
            }
        } catch (SQLException e) {
            throw database(e);
        }
        return out;
    }

    /** Hold id to its deadline in epoch milliseconds. */
    Map<String, Long> holdDeadlines(List<String> holdIds) {
        Map<String, Long> out = new HashMap<>();
        try (Connection c = pool.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT hold_id, expires_at FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id = ANY(?)")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setArray(3, c.createArrayOf("text", holdIds.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), rs.getObject(2, java.time.OffsetDateTime.class).toInstant().toEpochMilli());
            }
        } catch (SQLException e) {
            throw database(e);
        }
        return out;
    }

    /** Offer notifications raised, and how many of them were delivered through the captured transport. */
    record Notifications(long raised, long captured) {}

    Notifications notifications() {
        try (Connection c = pool.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT (SELECT count(*) FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                        + "AND event_type LIKE 'notification.%'), (SELECT count(*) FROM notification_deliveries "
                        + "WHERE environment_id = ? AND run_id = ? AND state = 'sent' AND transport = 'captured')")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, environmentId);
            ps.setString(4, runId);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return new Notifications(rs.getLong(1), rs.getLong(2));
            }
        } catch (SQLException e) {
            throw database(e);
        }
    }

    /** Hold id to its stored state. */
    Map<String, String> holdStates(List<String> holdIds) {
        Map<String, String> out = new HashMap<>();
        try (Connection c = pool.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT hold_id, state FROM custody_holds WHERE environment_id = ? AND run_id = ? AND hold_id = ANY(?)")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setArray(3, c.createArrayOf("text", holdIds.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), rs.getString(2));
            }
        } catch (SQLException e) {
            throw database(e);
        }
        return out;
    }

    /** Stock row and the employee holding each car now; unknown cars are absent. */
    List<CarState> carStates(List<String> orderUuids) {
        List<CarState> out = new ArrayList<>();
        try (Connection c = pool.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT s.order_uuid, s.version, s.state, (SELECT h.employee_id FROM custody_holds h "
                        + "WHERE h.environment_id = s.environment_id AND h.run_id = s.run_id AND h.order_uuid = s.order_uuid "
                        + "AND h.state IN ('active', 'claim-pending', 'release-pending', 'selection-pending') LIMIT 1) "
                        + "FROM stock_cars s WHERE s.environment_id = ? AND s.run_id = ? AND s.order_uuid = ANY(?)")) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setArray(3, c.createArrayOf("text", orderUuids.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(new CarState(rs.getString(1), rs.getLong(2), rs.getString(3), rs.getString(4)));
            }
        } catch (SQLException e) {
            throw database(e);
        }
        return out;
    }

    /** The cars now allocated, and the count of expired holds per car (the persisted side of the outcome check). */
    record Persisted(java.util.Set<String> allocated, Map<String, Integer> expired) {}

    Persisted persisted() {
        java.util.Set<String> allocated = new java.util.HashSet<>();
        Map<String, Integer> expired = new HashMap<>();
        try (Connection c = pool.getConnection()) {
            try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid FROM stock_cars WHERE environment_id = ? "
                    + "AND run_id = ? AND state = 'allocated'")) {
                ps.setString(1, environmentId);
                ps.setString(2, runId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) allocated.add(rs.getString(1));
                }
            }
            try (PreparedStatement ps = c.prepareStatement("SELECT order_uuid, count(*) FROM custody_holds WHERE environment_id = ? "
                    + "AND run_id = ? AND state = 'expired' GROUP BY order_uuid")) {
                ps.setString(1, environmentId);
                ps.setString(2, runId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) expired.put(rs.getString(1), rs.getInt(2));
                }
            }
        } catch (SQLException e) {
            throw database(e);
        }
        return new Persisted(allocated, expired);
    }

    @Override
    public void close() {
        if (closed) return;
        closed = true;
        boolean interrupted = Thread.interrupted();
        pool.close();
        try (Connection c = sources.apply(schema).getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS \"" + schema + "\" CASCADE");
        } catch (SQLException e) {
            // surfaced by the caller's schema check; the owned name stays in the exception for cleanup
            throw new IllegalStateException("The comparison scratch schema " + schema + " could not be dropped", e);
        } finally {
            if (interrupted) Thread.currentThread().interrupt();
        }
    }
}
