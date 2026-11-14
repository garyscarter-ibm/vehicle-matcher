package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.LocalSyntheticBuddy;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.identity.Principal;
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
        return new OfferDecisions(() -> true, this::source, access, policy, ctx -> now[0], () -> buddy);
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
