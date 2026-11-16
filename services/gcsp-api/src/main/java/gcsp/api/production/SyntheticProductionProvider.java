package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.postgresql.util.PGobject;

/**
 * The simulated Production system: each operation id is stored once in its own tables over its own autocommit
 * connection (an external system never shares the caller's transaction). Scripted answers fold into one cumulative view.
 */
public final class SyntheticProductionProvider implements ProductionProviderPort {

    static final String PROVIDER = "synthetic-production";
    static final String VERSION = "demo-synthetic-production-v1";
    static final List<Choice> CHOICES = List.of(new Choice("3 Series Saloon", "320i"),
            new Choice("3 Series Touring", "320i"), new Choice("i5 Touring", "eDrive40"),
            new Choice("1 Series Sports Hatch", "120"));
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String INVALID = "invalid-production-operation";
    private static final String DOWN = "production-store-unavailable";

    /** The result of scripting a response: ok with its sequence number, or a plain refusal. */
    public record ScriptResult(boolean ok, String code, String reason, int seq) {
        static ScriptResult fail(String code, String reason) {
            return new ScriptResult(false, code, reason, 0);
        }
    }

    private record Order(String digest, JsonNode request, String reference, String outcome) {}

    private final DataSource dataSource;

    public SyntheticProductionProvider(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public String mode() {
        return "synthetic";
    }

    @Override
    public Description describe() {
        return new Description("synthetic", PROVIDER, VERSION, "available", CHOICES);
    }

    @Override
    public Answer submit(Operation op) {
        if (!valid(op)) return Answer.of(Status.UNSUPPORTED, op == null ? null : op.operationId(), INVALID, "The request is malformed.");
        boolean known = CHOICES.contains(new Choice(op.model(), op.derivative()));
        ObjectNode request = JSON.createObjectNode();
        request.put("model", op.model());
        request.put("derivative", op.derivative());
        request.put("quantity", op.quantity());
        request.put("requestedAt", Ids.ms(op.requestedAt()).toString());
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO production_synthetic_orders (environment_id, "
                    + "run_id, operation_id, input_digest, request, provider_reference, outcome) VALUES (?, ?, ?, ?, ?, ?, ?) "
                    + "ON CONFLICT DO NOTHING")) {
                ps.setString(1, op.environmentId());
                ps.setString(2, op.runId());
                ps.setString(3, op.operationId());
                ps.setString(4, op.inputDigest());
                ps.setObject(5, jsonb(request));
                ps.setString(6, reference(op.operationId()));
                ps.setString(7, known ? "requested" : "refused");
                ps.executeUpdate();
            }
            return stored(c, op);
        } catch (SQLException | IOException e) {
            return Answer.of(Status.UNAVAILABLE, op.operationId(), DOWN, "The Production system could not be reached.");
        }
    }

    @Override
    public Answer reconcile(Operation op) {
        if (!valid(op)) return Answer.of(Status.UNSUPPORTED, op == null ? null : op.operationId(), INVALID, "The request is malformed.");
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(true);
            return stored(c, op);
        } catch (SQLException | IOException e) {
            return Answer.of(Status.UNAVAILABLE, op.operationId(), DOWN, "The Production system could not be reached.");
        }
    }

    /** Appends one scripted answer (confirm, delay or refuse) for a stored order, validated against what it already holds. */
    public ScriptResult script(RunContext ctx, String operationId, String action, Integer quantity, Instant delayUntil,
            String reason, Instant now) {
        if (ctx == null || operationId == null || operationId.isBlank() || now == null) {
            return ScriptResult.fail(INVALID, "The request is malformed.");
        }
        if (!List.of("confirm", "delay", "refuse").contains(action)) {
            return ScriptResult.fail("unknown-action", "Choose confirm, delay or refuse.");
        }
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                ScriptResult r = scriptIn(c, ctx, operationId, action, quantity, delayUntil, reason, now);
                if (r.ok()) c.commit();
                else c.rollback();
                return r;
            } catch (SQLException e) {
                c.rollback();
                return ScriptResult.fail(DOWN, "The Production system could not be reached.");
            }
        } catch (SQLException e) {
            return ScriptResult.fail(DOWN, "The Production system could not be reached.");
        }
    }

    private ScriptResult scriptIn(Connection c, RunContext ctx, String operationId, String action, Integer quantity,
            Instant delayUntil, String reason, Instant now) throws SQLException {
        int ordered;
        try (PreparedStatement ps = c.prepareStatement("SELECT outcome, (request->>'quantity')::int FROM production_synthetic_orders "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? FOR UPDATE")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, operationId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return ScriptResult.fail("operation-not-found", "No such Production request.");
                if (!"requested".equals(rs.getString(1))) {
                    return ScriptResult.fail("request-refused", "Production has already refused this request.");
                }
                ordered = rs.getInt(2);
            }
        }
        int confirmed = 0;
        int seq = 0;
        boolean refused = false;
        for (JsonNode r : responses(c, ctx.environmentId(), ctx.runId(), operationId)) {
            seq++;
            if ("confirm".equals(r.path("action").asText())) confirmed += r.path("quantity").asInt();
            if ("refuse".equals(r.path("action").asText())) refused = true;
        }
        if (refused) return ScriptResult.fail("request-refused", "Production has already refused this request.");
        ObjectNode response = JSON.createObjectNode();
        response.put("action", action);
        seq++;
        switch (action) {
            case "confirm" -> {
                if (quantity == null || quantity < 1) return ScriptResult.fail("invalid-quantity", "Confirm at least one vehicle.");
                if (quantity > ordered - confirmed) {
                    return ScriptResult.fail("quantity-exceeds-request", "Confirm no more than the outstanding quantity.");
                }
                response.put("quantity", quantity);
                response.put("supplyId", "supply-" + Ids.hex32(ctx.runId(), operationId, Integer.toString(seq)));
                response.put("confirmedAt", Ids.ms(now).toString());
            }
            case "delay" -> {
                if (delayUntil == null || !delayUntil.isAfter(now)) {
                    return ScriptResult.fail("delay-not-in-future", "Choose a delay date after the current demo time.");
                }
                if (reason == null || reason.isBlank()) return ScriptResult.fail("delay-reason-required", "Give a reason for the delay.");
                if (confirmed >= ordered) return ScriptResult.fail("already-confirmed", "Production has already confirmed all of this request.");
                response.put("delayUntil", Ids.ms(delayUntil).toString());
                response.put("reason", reason.strip());
            }
            default -> {
                if (confirmed > 0) return ScriptResult.fail("refuse-after-confirmation", "Production cannot refuse a request it has confirmed.");
                response.put("reason", reason == null || reason.isBlank() ? "Production refused this request." : reason.strip());
            }
        }
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO production_synthetic_responses (environment_id, run_id, "
                + "operation_id, seq, response) VALUES (?, ?, ?, ?, ?)")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, operationId);
            ps.setInt(4, seq);
            ps.setObject(5, jsonb(response));
            ps.executeUpdate();
        }
        return new ScriptResult(true, null, null, seq);
    }

    private static Answer stored(Connection c, Operation op) throws SQLException, IOException {
        Order o = null;
        try (PreparedStatement ps = c.prepareStatement("SELECT input_digest, request::text, provider_reference, outcome "
                + "FROM production_synthetic_orders WHERE environment_id = ? AND run_id = ? AND operation_id = ?")) {
            ps.setString(1, op.environmentId());
            ps.setString(2, op.runId());
            ps.setString(3, op.operationId());
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) o = new Order(rs.getString(1), JSON.readTree(rs.getString(2)), rs.getString(3), rs.getString(4));
            }
        }
        if (o == null) return Answer.of(Status.NOT_FOUND, op.operationId(), null, null);
        if (!o.digest().equals(op.inputDigest())) {
            return Answer.of(Status.CONFLICT, op.operationId(), "idempotency-input-changed",
                    "The request was recorded with different input.");
        }
        if ("refused".equals(o.outcome())) {
            return new Answer(Status.REFUSED, op.operationId(), null, List.of(), null,
                    "Choose a supplied model and derivative.", "unknown-production-choice", VERSION, true);
        }
        return fold(o, op, responses(c, op.environmentId(), op.runId(), op.operationId()));
    }

    /** Scripted answers in order become the cumulative view; a confirmation clears a delay, a refusal ends it. */
    private static Answer fold(Order o, Operation op, List<JsonNode> responses) {
        List<Confirmation> confirmations = new ArrayList<>();
        Instant delayUntil = null;
        String reason = null;
        for (JsonNode r : responses) {
            switch (r.path("action").asText()) {
                case "confirm" -> {
                    confirmations.add(new Confirmation(r.path("supplyId").asText(), r.path("quantity").asInt(),
                            Ids.parse(r.path("confirmedAt").asText(null))));
                    delayUntil = null;
                    reason = null;
                }
                case "delay" -> {
                    delayUntil = Ids.parse(r.path("delayUntil").asText(null));
                    reason = r.path("reason").asText(null);
                }
                case "refuse" -> {
                    return new Answer(Status.REFUSED, op.operationId(), null, List.of(), null,
                            r.path("reason").asText(null), "production-refused", VERSION, true);
                }
                default -> { }
            }
        }
        Status status = delayUntil != null ? Status.DELAYED : confirmations.isEmpty() ? Status.REQUESTED : Status.CONFIRMED;
        return new Answer(status, op.operationId(), o.reference(), confirmations, delayUntil, reason, null, VERSION, true);
    }

    private static List<JsonNode> responses(Connection c, String env, String run, String operationId) throws SQLException {
        List<JsonNode> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT response::text FROM production_synthetic_responses "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? ORDER BY seq")) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setString(3, operationId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(JSON.readTree(rs.getString(1)));
            }
        } catch (IOException e) {
            throw new SQLException("Stored response is unreadable");
        }
        return out;
    }

    static String reference(String operationId) {
        return PROVIDER + ":" + operationId;
    }

    private static PGobject jsonb(JsonNode node) throws SQLException {
        PGobject o = new PGobject();
        o.setType("jsonb");
        o.setValue(node.toString());
        return o;
    }

    private static boolean valid(Operation op) {
        return op != null && op.operationId() != null && !op.operationId().isBlank() && op.environmentId() != null
                && op.runId() != null && op.model() != null && op.derivative() != null && op.quantity() >= 1
                && op.requestedAt() != null && op.inputDigest() != null && op.inputDigest().matches("[0-9a-f]{64}");
    }
}
