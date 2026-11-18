package gcsp.api.activity;

import static gcsp.api.activity.ActivityChecks.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.brief.Engagement;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyClock;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Reads one employee's activity from stored rows in a single read-only snapshot; it writes nothing. */
@ApplicationScoped
public class ActivityService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> OPERATIONS = Set.of("confirmed", "paused", "resumed", "changed-after-decline", "engaged",
            "disengaged", "preferences-updated");
    /** Node's closed set, plus the two terminal Java states: a superseded or released offer is no longer open. */
    private static final Set<String> CLOSED = Set.of("accepted", "rejected", "declined", "expired", "superseded", "released");
    private static final int CHECK_LIMIT = 200;

    @Inject
    Persistence persistence;

    @Inject
    RunClockHolder clocks;

    @Inject
    Instance<AgroalDataSource> sources;

    public ActivityResult read(Principal p) {
        if (!persistence.active() || blank(p.environmentId()) || blank(p.runId()) || blank(p.employeeId())) {
            return ActivityResult.unavailable("activity-not-configured");
        }
        ClockReading now;
        try {
            Optional<ClockReading> reading = clocks.clock().now(p.environmentId(), p.runId());
            if (reading.isEmpty()) return ActivityResult.unavailable("clock-unavailable");
            now = reading.get();
        } catch (RuntimeException e) {
            return ActivityResult.unavailable("clock-unavailable");
        }
        try (Connection c = sources.get().getConnection()) {
            c.setAutoCommit(false);
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            try {
                return project(c, p, now);
            } finally {
                c.rollback();
                c.setReadOnly(false);
                c.setAutoCommit(true);
                c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            }
        } catch (SQLException | RuntimeException e) {
            return ActivityResult.unavailable("source-invalid");
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private record Brief(long version, Long previous, String operation, JsonNode buddy, String policyVersion,
            String confirmedAt) {}

    private ActivityResult project(Connection c, Principal p, ClockReading now) throws SQLException {
        String env = p.environmentId(), run = p.runId(), emp = p.employeeId();
        String asOf = PolicyClock.iso(now.now());
        List<Brief> history = new ArrayList<>();
        query(c, "SELECT brief_version, previous_brief_version, operation, buddy::text, policy_version, confirmed_at "
                + "FROM briefs WHERE environment_id = ? AND run_id = ? AND employee_id = ? ORDER BY brief_version", rs -> {
                    long version = rs.getLong(1);
                    long prev = rs.getLong(2);
                    Long previous = rs.wasNull() ? null : prev;
                    history.add(new Brief(version, previous, rs.getString(3), json(rs.getString(4)),
                            rs.getString(5), PolicyClock.iso(rs.getTimestamp(6).toInstant())));
                }, env, run, emp);
        Brief brief = history.isEmpty() ? null : history.get(history.size() - 1);
        ObjectNode permission = null;
        if (brief != null) {
            permission = permission(brief);
            if (permission == null || history.stream().anyMatch(b -> b.confirmedAt().compareTo(asOf) > 0)) return ActivityResult.unavailable("brief-invalid");
        }

        List<ObjectNode> offers = new ArrayList<>();
        boolean[] bad = {false};
        query(c, "SELECT offer_id, state, version, brief_version, hold_id, order_uuid, policy_version, quote_id, expires_at, "
                + "created_at FROM buddy_offers WHERE environment_id = ? AND run_id = ? AND employee_id = ?", rs -> {
                    ObjectNode o = offer(rs);
                    if (o == null) bad[0] = true; else offers.add(o);
                }, env, run, emp);
        if (bad[0]) return ActivityResult.unavailable("offer-invalid");
        offers.sort(Comparator.comparing((ObjectNode o) -> o.path("offerRef").path("offerId").textValue()));
        ObjectNode current = offers.stream().max(Comparator.comparing((ObjectNode o) -> o.path("createdAt").asText(""))
                .thenComparing(o -> o.path("offerRef").path("offerId").textValue())).map(ObjectNode::deepCopy).orElse(null);
        if (current != null) current.put("href", "/gcsp/offer?offerId=" + encode(current.path("offerRef").path("offerId").textValue())
                + "&runId=" + encode(run));

        // Only the latest 200 completed allocations for this employee are read.
        List<ObjectNode> checks = new ArrayList<>();
        query(c, "SELECT a.evaluated_at, a.clock_version, e.excluded_code, e.evaluation::text, "
                + "EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.outcome->'assignments', '[]'::jsonb)) x(v) "
                + "WHERE x.v->>'employeeId' = ?) FROM allocation_runs a JOIN allocation_evaluations e "
                + "ON e.environment_id = a.environment_id AND e.run_id = a.run_id AND e.allocation_id = a.allocation_id "
                + "AND e.employee_id = ? WHERE a.environment_id = ? AND a.run_id = ? AND a.state = 'completed' "
                + "AND a.evaluated_at <= ? ORDER BY a.evaluated_at DESC, a.allocation_id DESC LIMIT " + CHECK_LIMIT, rs -> {
                    ObjectNode check = ActivityChecks.check(PolicyClock.iso(rs.getTimestamp(1).toInstant()), rs.getLong(2),
                            rs.getBoolean(5), rs.getString(3), json(rs.getString(4)));
                    if (check != null) checks.add(check);
                }, emp, emp, env, run, Timestamp.from(now.now()));

        ArrayNode changes = JSON.createArrayNode();
        int[] receipts = {0};
        query(c, "SELECT event_id, payload::text FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_type = 'brief-changed' AND payload->>'employeeId' = ? ORDER BY event_id", rs -> {
                    receipts[0]++;
                    ObjectNode change = change(rs.getString(1), json(rs.getString(2)), history, emp, asOf);
                    if (change != null) changes.add(change);
                }, env, run, emp);
        List<JsonNode> sorted = new ArrayList<>();
        changes.forEach(sorted::add);
        sorted.sort(Comparator.comparingLong(n -> n.path("briefVersion").longValue()));
        ArrayNode stateChanges = JSON.createArrayNode().addAll(sorted);
        int rejected = receipts[0] - stateChanges.size();

        ObjectNode out = JSON.createObjectNode();
        out.put("runId", run).put("employeeId", emp).put("asOf", asOf).put("clockVersion", Long.toString(now.clockVersion()));
        if (brief == null) out.putNull("briefVersion"); else out.put("briefVersion", brief.version());
        out.set("permission", permission == null ? JSON.nullNode() : permission);
        out.put("state", brief == null ? "no-brief" : permission.path("paused").booleanValue() ? "paused"
                : current != null ? CLOSED.contains(current.path("state").textValue()) ? "offer-closed" : "offer"
                : checks.isEmpty() ? "never-searched" : "searching");
        out.set("lastSuccessfulCheck", checks.isEmpty() ? JSON.nullNode() : checks.get(0));
        ObjectNode evidence = out.putObject("searchEvidence");
        if (checks.isEmpty()) evidence.put("status", "not-recorded").put("reason", "no-search-check-yet");
        else evidence.put("status", "recorded").put("checks", checks.size());
        out.put("sourceStatus", sourceStatus(c, env, run));
        out.set("currentOffer", current == null ? JSON.nullNode() : current);
        out.set("offers", JSON.createArrayNode().addAll(offers));
        out.set("stateChanges", stateChanges);
        out.putObject("stateChangesEvidence").put("status", rejected > 0 ? "incomplete" : stateChanges.isEmpty() ? "not-recorded"
                : "recorded").put("rejectedReceipts", rejected);
        return ActivityResult.ok(out);
    }

    /** Null when the stored brief cannot be shown, as Node's brief-invalid. */
    private static ObjectNode permission(Brief b) {
        JsonNode buddy = b.buddy();
        JsonNode version = buddy.get("permissionVersion");
        if (!text(b.policyVersion()) || version == null || !version.isIntegralNumber()
                || version.longValue() < 1 || version.longValue() > b.version()) return null;
        for (String key : List.of("searchConsent", "holdConsent", "paused")) if (!buddy.path(key).isBoolean()) return null;
        boolean engaged = Engagement.engaged(buddy);
        ObjectNode out = JSON.createObjectNode();
        out.put("searchConsent", buddy.get("searchConsent").booleanValue()).put("holdConsent", buddy.get("holdConsent").booleanValue())
                .put("paused", buddy.get("paused").booleanValue()).put("permissionVersion", version.longValue())
                .put("canSearch", engaged).put("canHold", engaged);
        return out;
    }

    private static ObjectNode offer(ResultSet rs) throws SQLException {
        String id = rs.getString(1), state = rs.getString(2);
        long brief = rs.getLong(4);
        if (!text(id) || !text(state) || rs.getLong(3) < 1) return null;
        ObjectNode o = JSON.createObjectNode();
        o.putObject("offerRef").put("offerId", id);
        o.put("state", state).put("version", rs.getLong(3)).put("briefVersion", brief);
        o.put("createdAt", PolicyClock.iso(rs.getTimestamp(10).toInstant()));
        String[] keys = {"holdId", "orderUuid", "policyVersion", "quoteId"};
        int[] cols = {5, 6, 7, 8};
        for (int i = 0; i < keys.length; i++) {
            String v = rs.getString(cols[i]);
            if (!text(v)) return null;
            o.put(keys[i], v);
        }
        o.put("expiresAt", PolicyClock.iso(rs.getTimestamp(9).toInstant()));
        return o;
    }

    /** One brief-changed event as a state change; null (counted as rejected) when it disagrees with the brief row. */
    private static ObjectNode change(String eventId, JsonNode e, List<Brief> history, String employeeId, String asOf) {
        JsonNode versionNode = e.get("briefVersion");
        if (versionNode == null || !versionNode.isIntegralNumber() || !employeeId.equals(e.path("employeeId").asText(null))) return null;
        long version = versionNode.longValue();
        Brief brief = history.stream().filter(b -> b.version() == version).findFirst().orElse(null);
        String op = e.path("operation").asText(null);
        if (brief == null || brief.confirmedAt().compareTo(asOf) > 0 || op == null || !OPERATIONS.contains(op) || !eventId.equals("brief:" + employeeId + ":" + version)) return null;
        JsonNode previous = e.get("previousBriefVersion");
        boolean previousMatches = brief.previous() == null ? previous != null && previous.isNull()
                : previous != null && previous.isIntegralNumber() && previous.longValue() == brief.previous();
        JsonNode buddy = brief.buddy();
        JsonNode paused = buddy.get("paused");
        boolean consistent = op.equals(brief.operation()) && switch (op) {
            case "paused" -> paused != null && paused.isBoolean() && paused.booleanValue();
            case "resumed" -> paused != null && paused.isBoolean() && !paused.booleanValue();
            case "engaged" -> Engagement.engaged(buddy);
            case "disengaged" -> buddy.path("searchConsent").isBoolean() && !buddy.get("searchConsent").booleanValue();
            default -> true;
        };
        if (!previousMatches || !consistent) return null;
        ObjectNode out = JSON.createObjectNode();
        out.put("eventId", eventId).put("eventType", "brief-changed").put("operation", op).put("briefVersion", version);
        if (brief.previous() == null) out.putNull("previousBriefVersion"); else out.put("previousBriefVersion", brief.previous());
        out.put("occurredAt", brief.confirmedAt());
        return out;
    }

    private static String sourceStatus(Connection c, String env, String run) throws SQLException {
        String[] tick = new String[4];
        query(c, "SELECT k.last_tick_id, t.state, t.handler_order::text, t.outcomes::text FROM run_clocks k LEFT JOIN clock_ticks t "
                + "ON t.environment_id = k.environment_id AND t.run_id = k.run_id AND t.tick_id = k.last_tick_id "
                + "WHERE k.environment_id = ? AND k.run_id = ?", rs -> {
                    for (int i = 0; i < 4; i++) tick[i] = rs.getString(i + 1);
                }, env, run);
        return ActivityChecks.sourceStatus(tick[0] != null, tick[1], tick[2] == null ? null : json(tick[2]),
                tick[3] == null ? null : json(tick[3]));
    }

    /** encodeURIComponent: the characters it leaves alone are A-Z a-z 0-9 - _ . ! ~ * ' ( ). */
    static String encode(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20").replace("%21", "!").replace("%7E", "~")
                .replace("%27", "'").replace("%28", "(").replace("%29", ")");
    }

    private static JsonNode json(String text) {
        try {
            return JSON.readTree(text);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("stored JSON is unreadable", e);
        }
    }

    @FunctionalInterface
    private interface RowReader {
        void read(ResultSet rs) throws SQLException;
    }

    private static void query(Connection c, String sql, RowReader reader, Object... params) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) reader.read(rs);
            }
        }
    }
}
