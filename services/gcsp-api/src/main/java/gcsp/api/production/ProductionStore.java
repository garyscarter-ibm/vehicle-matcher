package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.production.ProductionProviderPort.Answer;
import gcsp.api.production.ProductionProviderPort.Confirmation;
import gcsp.api.production.ProductionProviderPort.Status;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Request-row reads and the one place a provider Answer is applied to a request (shared with the reconcile pass). */
final class ProductionStore {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final List<String> OPEN = List.of("intent", "uncertain", "requested", "partly-confirmed", "delayed");

    private ProductionStore() {}

    record Submission(String submissionId, String planId, String inputDigest, Instant requestedAt) {}

    record RequestRow(String requestId, String submissionId, String lineId, String model, String derivative,
            int quantity, String state, String providerReference, String refusalCode, String refusalReason,
            Instant delayUntil, String delayReason, int confirmedQuantity, int attempts, JsonNode lastOutcome,
            String inputDigest, Instant requestedAt, long version) {}

    /** How an Answer landed: applied (row changed), unchanged (already held), or unknown (not a usable answer). */
    enum Applied { APPLIED, UNCHANGED, UNKNOWN }

    static Optional<Submission> submission(Connection c, RunContext ctx, String submissionId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT plan_id, input_digest, requested_at FROM production_submissions "
                + "WHERE environment_id = ? AND run_id = ? AND submission_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, submissionId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(new Submission(submissionId, rs.getString(1), rs.getString(2),
                        rs.getObject(3, OffsetDateTime.class).toInstant())) : Optional.empty();
            }
        }
    }

    static List<RequestRow> requests(Connection c, RunContext ctx, String submissionId) throws SQLException {
        List<RequestRow> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT request_id, submission_id, line_id, model, derivative, quantity, "
                + "state, provider_reference, refusal_code, refusal_reason, delay_until, delay_reason, confirmed_quantity, "
                + "attempts, last_outcome::text, input_digest, requested_at, version FROM production_requests "
                + "WHERE environment_id = ? AND run_id = ? AND submission_id = ? ORDER BY line_id")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, submissionId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(map(rs));
            }
        }
        return out;
    }

    private static RequestRow map(ResultSet rs) throws SQLException {
        OffsetDateTime delay = rs.getObject(11, OffsetDateTime.class);
        String last = rs.getString(15);
        try {
            return new RequestRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
                    rs.getInt(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10),
                    delay == null ? null : delay.toInstant(), rs.getString(12), rs.getInt(13), rs.getInt(14),
                    last == null ? null : JSON.readTree(last), rs.getString(16),
                    rs.getObject(17, OffsetDateTime.class).toInstant(), rs.getLong(18));
        } catch (IOException e) {
            throw new SQLException("Stored request is unreadable");
        }
    }

    /** The provider-facing form of a request row; the operation id is the request id. */
    static ProductionProviderPort.Operation operation(RunContext ctx, RequestRow r) {
        return new ProductionProviderPort.Operation(ctx.environmentId(), ctx.runId(), r.requestId(), r.model(),
                r.derivative(), r.quantity(), r.requestedAt(), r.inputDigest());
    }

    /** Whether the row still awaits a final provider answer (the open-state index). */
    static boolean open(String state) {
        return OPEN.contains(state);
    }

    static JsonNode answerJson(Answer a) {
        ObjectNode o = F.objectNode();
        o.put("status", a.status().name());
        o.put("operationId", a.operationId());
        o.put("providerReference", a.providerReference());
        o.put("delayUntil", a.delayUntil() == null ? null : Ids.ms(a.delayUntil()).toString());
        o.put("code", a.code());
        o.put("reason", a.reason());
        ArrayNode cs = o.putArray("confirmations");
        for (Confirmation c : a.confirmations() == null ? List.<Confirmation>of() : a.confirmations()) {
            ObjectNode n = cs.addObject();
            n.put("supplyId", c.supplyId());
            n.put("quantity", c.quantity());
            n.put("confirmedAt", c.confirmedAt() == null ? null : Ids.ms(c.confirmedAt()).toString());
        }
        return o;
    }

    /** Applies a cumulative provider Answer under a version CAS; an unusable one only records an attempt. */
    static Applied applyAnswer(Tx tx, RequestRow row, Answer a, String mode, Instant at, String... fromStates)
            throws SQLException {
        RunContext ctx = tx.context();
        Plan plan = plan(row, a);
        if (plan == null) {
            String keep = "intent".equals(row.state()) ? "uncertain" : row.state();
            ObjectNode last = F.objectNode();
            last.put("status", a == null || a.status() == null ? "UNKNOWN" : a.status().name());
            last.put("code", a == null || a.code() == null ? "no-usable-answer" : a.code());
            tx.cas("UPDATE production_requests SET state = ?, attempts = attempts + 1, last_outcome = ?, "
                    + "version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                    + "AND request_id = ? AND version = ? AND state IN (" + marks(fromStates.length) + ")",
                    concat(new Object[] {keep, last, ctx.environmentId(), ctx.runId(), row.requestId(), row.version()},
                            fromStates));
            return Applied.UNKNOWN;
        }
        if (plan.same(row)) return Applied.UNCHANGED;
        tx.cas("UPDATE production_requests SET state = ?, provider_mode = ?, provider_reference = ?, source_version = ?, "
                + "refusal_code = ?, refusal_reason = ?, delay_until = ?, delay_reason = ?, confirmed_quantity = ?, "
                + "last_outcome = NULL, version = version + 1, updated_at = now() WHERE environment_id = ? AND run_id = ? "
                + "AND request_id = ? AND version = ? AND state IN (" + marks(fromStates.length) + ")",
                concat(new Object[] {plan.state, mode, plan.reference, a.sourceVersion(), plan.code, plan.reason,
                    plan.delayUntil, plan.delayReason, plan.total, ctx.environmentId(), ctx.runId(), row.requestId(),
                    row.version()}, fromStates));
        Set<String> have = supplyIds(tx, ctx, row.requestId());
        for (Confirmation c : plan.confirmations) {
            if (have.contains(c.supplyId())) continue;
            tx.write("INSERT INTO production_confirmations (environment_id, run_id, supply_id, request_id, quantity, "
                    + "confirmed_at, source_version, provider_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    ctx.environmentId(), ctx.runId(), c.supplyId(), row.requestId(), c.quantity(), c.confirmedAt(),
                    a.sourceVersion() == null ? "unknown" : a.sourceVersion(), plan.reference);
        }
        ObjectNode details = F.objectNode();
        details.put("confirmedQuantity", plan.total);
        details.put("code", plan.code);
        details.put("reason", plan.reason != null ? plan.reason : plan.delayReason);
        details.put("delayUntil", plan.delayUntil == null ? null : Ids.ms(plan.delayUntil).toString());
        tx.write("INSERT INTO production_responses (environment_id, run_id, request_id, seq, state, at, provider_reference, "
                + "details) SELECT ?, ?, ?, coalesce(max(seq), 0) + 1, ?, ?, ?, ? FROM production_responses "
                + "WHERE environment_id = ? AND run_id = ? AND request_id = ?", ctx.environmentId(), ctx.runId(),
                row.requestId(), plan.state, at, plan.reference, details, ctx.environmentId(), ctx.runId(), row.requestId());
        return Applied.APPLIED;
    }

    /** The row an answer would produce, or null when the answer is unusable. */
    private record Plan(String state, String reference, String code, String reason, Instant delayUntil,
            String delayReason, int total, List<Confirmation> confirmations) {

        boolean same(RequestRow r) {
            return state.equals(r.state()) && total == r.confirmedQuantity()
                    && java.util.Objects.equals(delayUntil == null ? null : Ids.ms(delayUntil), r.delayUntil() == null ? null : Ids.ms(r.delayUntil()))
                    && java.util.Objects.equals(code, r.refusalCode());
        }
    }

    private static Plan plan(RequestRow row, Answer a) {
        if (a == null || a.status() == null || a.operationId() == null || !a.operationId().equals(row.requestId())) return null;
        boolean hasRef = a.providerReference() != null && !a.providerReference().isBlank();
        Status s = a.status();
        if (s == Status.REFUSED || s == Status.UNSUPPORTED) {
            if (row.confirmedQuantity() > 0) return null;
            String code = a.code() == null || a.code().isBlank() ? (s == Status.REFUSED ? "production-refused" : "production-unsupported") : a.code();
            String reason = a.reason() == null || a.reason().isBlank()
                    ? (s == Status.REFUSED ? "Production refused this request." : "Production could not take this request.") : a.reason();
            return new Plan(s == Status.REFUSED ? "refused" : "unsupported", null, code, reason, null, null, 0, List.of());
        }
        if (s != Status.REQUESTED && s != Status.CONFIRMED && s != Status.DELAYED || !hasRef) return null;
        List<Confirmation> cs = a.confirmations() == null ? List.of() : a.confirmations();
        Set<String> seen = new HashSet<>();
        int total = 0;
        for (Confirmation c : cs) {
            if (c == null || c.supplyId() == null || c.supplyId().isBlank() || c.quantity() < 1 || c.confirmedAt() == null
                    || !seen.add(c.supplyId())) return null;
            total += c.quantity();
            if (total > row.quantity()) return null;
        }
        if (total < row.confirmedQuantity()) return null;
        if (s == Status.REQUESTED) {
            return total == 0 && row.confirmedQuantity() == 0
                    ? new Plan("requested", a.providerReference(), null, null, null, null, 0, List.of()) : null;
        }
        if (s == Status.CONFIRMED && total == 0) return null;
        if (total == row.quantity()) return new Plan("confirmed", a.providerReference(), null, null, null, null, total, cs);
        if (s == Status.DELAYED) {
            if (a.delayUntil() == null) return null;
            return new Plan("delayed", a.providerReference(), null, null, a.delayUntil(), a.reason(), total, cs);
        }
        return new Plan("partly-confirmed", a.providerReference(), null, null, null, null, total, cs);
    }

    private static Set<String> supplyIds(Tx tx, RunContext ctx, String requestId) throws SQLException {
        Set<String> out = new HashSet<>();
        try (PreparedStatement ps = tx.connection().prepareStatement("SELECT supply_id FROM production_confirmations "
                + "WHERE environment_id = ? AND run_id = ? AND request_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, requestId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(rs.getString(1));
            }
        }
        return out;
    }

    private static String marks(int n) {
        return String.join(", ", java.util.Collections.nCopies(n, "?"));
    }

    private static Object[] concat(Object[] head, String[] tail) {
        Object[] all = java.util.Arrays.copyOf(head, head.length + tail.length);
        System.arraycopy(tail, 0, all, head.length, tail.length);
        return all;
    }
}
