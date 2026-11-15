package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.RepositoryAccountRecords;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.Principal;
import gcsp.api.ordering.OrderingResult;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingTerms;
import gcsp.api.ordering.SyntheticOrderingProvider;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** One seeded active Buddy offer over a real schema, with the decision service wired to a fixed clock and policy. */
final class DecisionEnv implements AutoCloseable {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String POLICY = "gcsp-policy-v1";
    static final String EMPLOYEE = "E-1001";
    static final Instant NOW = Instant.parse("2026-11-14T09:00:00Z");
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final Path REASONS = Path.of("../../server/gcsp/policy/reviewed/offer-decline-reasons-v1.json");

    final OffersPg pg;
    final String offerId;
    final Instant[] now = {NOW};
    String mode = "local-synthetic";
    OfferDecisions decisions;
    OrderingService ordering;

    private DecisionEnv(OffersPg pg, String offerId) {
        this.pg = pg;
        this.offerId = offerId;
    }

    static DecisionEnv open(boolean withReasons) throws SQLException {
        OffersPg pg = OffersPg.create();
        String offer = pg.seed("run-1", EMPLOYEE, "active", "active", NOW.plusSeconds(3600), NOW.minusSeconds(600));
        // The real allocator leaves the car released (the hold is the occupancy) and pins the offer to a real policy.
        pg.update("UPDATE stock_cars SET state = 'released'");
        pg.update("UPDATE buddy_offers SET policy_version = ?", POLICY);
        DecisionEnv env = new DecisionEnv(pg, offer);
        env.seedAccept();
        env.decisions = env.service(policy(withReasons));
        return env;
    }

    OfferDecisions service(PolicyService policy) {
        PostgresOfferRecords records = new PostgresOfferRecords(() -> true, this::source);
        OfferAccess access = new OfferAccess(records, ctx -> now[0]);
        RemoteBuddy buddy = new LocalSyntheticBuddy() {
            @Override
            public String mode() {
                return mode;
            }
        };
        ordering = new OrderingService(source(), new OrderingTerms(policy, ctx -> now[0]), new SyntheticOrderingProvider(source()));
        return new OfferDecisions(() -> true, this::source, access, policy, ctx -> now[0], () -> buddy,
                () -> Optional.of(ordering), () -> new RepositoryAccountRecords(source()));
    }

    /** The employee's membership, account record, a pinned brief and a numbered car: what a clean accept needs. */
    private void seedAccept() throws SQLException {
        pg.update("UPDATE employees SET attributes = ?::jsonb", "{\"companyId\":\"demo-bmw-fs-uk\",\"schemeId\":"
                + "\"choices-fs-uk\",\"gradeId\":\"G1-6\",\"name\":\"Paula\"}");
        pg.update("UPDATE stock_cars SET attributes = ?::jsonb", "{\"orderNumber\":\"1234567\"}");
        setAccount(record(false));
        pg.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, 'run-1', ?, 3)",
                OffersPg.ENV, EMPLOYEE);
        insertBrief(3, ESSENTIALS);
    }

    static final String ESSENTIALS = "{\"seats\":{\"value\":5,\"operator\":\"gte\",\"unit\":\"count\",\"state\":\"confirmed\"},"
            + "\"body\":{\"value\":[\"b\",\"a\"],\"operator\":\"includes\",\"unit\":null,\"state\":\"confirmed\"}}";

    void insertBrief(int version, String essentials) throws SQLException {
        pg.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, "
                + "content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) VALUES "
                + "(?, 'run-1', ?, ?, ?, 'confirmed', ?::jsonb, '{}'::jsonb, repeat('a', 64), ?, 'p', now(), ?)",
                OffersPg.ENV, EMPLOYEE, version, version - 1,
                "{\"schemaVersion\":1,\"preferences\":{},\"essentials\":" + essentials + "}", POLICY, "b" + version);
    }

    /** The account aggregate: contact and employee driver, plus a current contract on the slot when replacing. */
    static String record(boolean replacement) {
        String slot = "slot-";
        String contract = replacement ? "{\"status\":\"current\",\"slotId\":\"SLOT\",\"returnedDate\":null,"
                + "\"model\":\"BMW 320i\",\"contractEndDate\":\"2026-12-01\",\"currentOdometer\":{\"value\":5200,"
                + "\"unit\":\"mi\"}}" : "";
        return "{\"account\":{\"contact\":{\"phone\":\"01632 960000\",\"email\":\"paula@example.test\"}},"
                + "\"contracts\":[" + contract + "],\"drivers\":[{\"kind\":\"employee\",\"employeeId\":\"" + EMPLOYEE
                + "\",\"driverId\":\"d1\",\"name\":\"Paula\",\"eligible\":{\"status\":\"known\",\"value\":true},"
                + "\"licence\":{\"displayNumber\":\"PAULA123\",\"categories\":[\"car\"],\"validFrom\":\"2010-01-01\","
                + "\"validUntil\":\"2030-01-01\"}}]}";
    }

    void setAccount(String record) throws SQLException {
        pg.update("DELETE FROM employee_account_records");
        pg.update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record) "
                + "VALUES (?, 'run-1', ?, 'rs-1', ?::jsonb)", OffersPg.ENV, EMPLOYEE,
                record.replace("SLOT", slotId()));
    }

    String slotId() throws SQLException {
        return text("SELECT slot_id FROM custody_holds");
    }

    String termsDigest() throws SQLException {
        OrderingResult r = ordering.terms(new OrderingScope(OffersPg.ENV, "run-1", EMPLOYEE, slotId(), POLICY));
        return ((OrderingResult.Ok) r).value().get("termsDigest").textValue();
    }

    ObjectNode accept(String commandId, long offerVersion, long holdVersion, Long mileage) throws SQLException {
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", commandId);
        b.put("decision", "accept");
        b.put("expectedOfferVersion", offerVersion);
        b.put("expectedHoldVersion", holdVersion);
        b.put("termsDigest", termsDigest());
        ObjectNode d = b.putObject("declarations");
        d.put("terms", true).put("driver", true);
        if (mileage != null) {
            d.put("return", true);
            b.put("expectedReturnMileage", mileage);
        }
        return b;
    }

    OfferOutcome acceptOk() throws SQLException {
        return decide(accept("cmd-1", 1, 1, null));
    }

    javax.sql.DataSource source() {
        try {
            return pg.pool();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    static PolicyService policy(boolean withReasons) {
        try {
            ObjectNode seed = (ObjectNode) JSON.readTree(Files.readAllBytes(SEED));
            if (withReasons) {
                JsonNode def = JSON.readTree(Files.readAllBytes(REASONS)).get("definitions").get(0);
                ObjectNode row = JSON.createObjectNode();
                row.put("key", OfferDecisions.REASONS_KEY);
                row.set("value", def.get("value").deepCopy());
                row.put("unit", "reason-registry");
                row.put("status", "assumed");
                row.put("basis", "Test copy of the reviewed registry.");
                row.put("source", "DecisionEnv");
                row.put("sourceDate", "2026-11-14");
                row.set("policyVersion", seed.get("policyVersion"));
                row.set("effectiveFrom", seed.get("effectiveFrom"));
                ((ArrayNode) seed.get("assumptions")).add(row);
            }
            List<JsonNode> versions = List.of(seed);
            return new PolicyService(run -> versions);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static Principal employee(String employeeId) {
        return new Principal("sub-" + employeeId, List.of("employee"), OffersPg.ENV, "run-1", employeeId, POLICY,
                List.of("account:read"));
    }

    Principal owner() {
        return employee(EMPLOYEE);
    }

    static ObjectNode decline(String commandId, String reasonCode, long offerVersion, long holdVersion) {
        ObjectNode b = JSON.createObjectNode();
        b.put("commandId", commandId);
        b.put("decision", "decline");
        b.put("reasonCode", reasonCode);
        b.put("expectedOfferVersion", offerVersion);
        b.put("expectedHoldVersion", holdVersion);
        return b;
    }

    OfferOutcome decide(ObjectNode body) {
        return decisions.decide(owner(), offerId, body);
    }

    OfferOutcome decideOk() {
        return decide(decline("cmd-1", "size", 1, 1));
    }

    long count(String sql, Object... params) throws SQLException {
        try (Connection c = pg.pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    String text(String sql) throws SQLException {
        try (Connection c = pg.pool().getConnection(); PreparedStatement ps = c.prepareStatement(sql);
                ResultSet rs = ps.executeQuery()) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    /** Rows written by a decision: decisions, outbox events and receipts. */
    long written() throws SQLException {
        return count("SELECT (SELECT count(*) FROM offer_decisions) + (SELECT count(*) FROM outbox_events) "
                + "+ (SELECT count(*) FROM command_receipts)");
    }

    @Override
    public void close() throws SQLException {
        pg.close();
    }
}
