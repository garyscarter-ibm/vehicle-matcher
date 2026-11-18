package gcsp.api.cases;

import static gcsp.api.cases.CaseJson.instant;
import static gcsp.api.cases.CaseJson.object;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** The preference-relaxation remedy: options and the employee's confirmation, from read-only SQL on the caller's connection. */
final class CaseRelaxation {

    /** A confirmed brief version; change is the single post-decline audit record when this version was one. */
    record Brief(long version, ObjectNode content, String confirmedBy, Instant confirmedAt, ObjectNode change) {
        JsonNode preferences() {
            return content.path("preferences");
        }
    }

    record Decline(String decisionId, String employeeId, String decision, JsonNode versions) {}

    private CaseRelaxation() {}

    /** Every confirmed brief of the employee, oldest first: one read on the briefs primary key prefix. */
    static List<Brief> briefs(Connection c, String env, String run, String employeeId) throws SQLException {
        List<Brief> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT brief_version, content::text, confirmed_by, confirmed_at, "
                + "post_decline_change::text FROM briefs WHERE environment_id = ? AND run_id = ? AND employee_id = ? "
                + "ORDER BY brief_version")) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Brief(rs.getLong(1), obj(rs.getString(2)), rs.getString(3),
                            rs.getObject(4, OffsetDateTime.class).toInstant(), obj(rs.getString(5))));
                }
            }
        }
        return out;
    }

    /** The current brief is the newest confirmed version. */
    static Brief current(List<Brief> briefs) {
        return briefs.isEmpty() ? null : briefs.get(briefs.size() - 1);
    }

    static Brief version(List<Brief> briefs, long version) {
        for (Brief b : briefs) if (b.version() == version) return b;
        return null;
    }

    /** The recorded decision with this id (unique per run), or null. */
    static Decline decision(Connection c, String env, String run, String decisionId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT decision_id, employee_id, decision, versions::text "
                + "FROM offer_decisions WHERE environment_id = ? AND run_id = ? AND decision_id = ?")) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setString(3, decisionId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Decline(rs.getString(1), rs.getString(2), rs.getString(3), obj(rs.getString(4))) : null;
            }
        }
    }

    /** Relaxations Greg may propose, null if the registry is unavailable. Bound: 1 declines read (offer_decisions_employee), 1 briefs read. */
    static ArrayNode options(Connection c, CasePolicyPort policy, String env, String run, String employeeId,
            String policyVersion) throws SQLException {
        ArrayNode items = CaseJson.arr();
        List<Brief> briefs = briefs(c, env, run, employeeId);
        Brief current = current(briefs);
        String decisionId = current == null ? null : newestUnusedDecline(c, env, run, employeeId, briefs);
        if (decisionId == null) return items;
        Optional<JsonNode> registry = policy.assumption(policyVersion, "employee.recommendation.v1");
        Optional<JsonNode> minimum = policy.assumption(policyVersion, "brief.slider.minimum");
        Optional<JsonNode> maximum = policy.assumption(policyVersion, "brief.slider.maximum");
        if (registry.isEmpty() || minimum.isEmpty() || maximum.isEmpty()) return null;
        JsonNode preferences = registry.get().path("value").path("preferences");
        JsonNode lo = minimum.get().path("value");
        JsonNode hi = maximum.get().path("value");
        if (!object(preferences) || !lo.isNumber() || lo.doubleValue() != 0 || !hi.isNumber() || hi.doubleValue() != 100) return null;
        for (var it = current.preferences().fields(); it.hasNext();) {
            var entry = it.next();
            JsonNode definition = preferences.get(entry.getKey());
            String type = definition == null ? "" : definition.path("type").asText("");
            if (!type.equals("enum") && !type.equals("slider")) return null;
            boolean isEnum = type.equals("enum");
            if (isEnum && !definition.path("values").isArray()) return null;
            JsonNode before = entry.getValue().path("value");
            ArrayNode alternatives = CaseJson.arr();
            if (isEnum) {
                for (JsonNode v : definition.get("values")) if (!held(before, v)) alternatives.add(v);
                if (alternatives.isEmpty()) continue;
            }
            ObjectNode item = items.addObject();
            item.put("type", "preference-relaxation").put("decisionId", decisionId).put("expectedBriefVersion", current.version());
            item.put("path", "preferences." + entry.getKey() + ".value");
            item.set("before", before.isMissingNode() ? CaseJson.M.nullNode() : before.deepCopy());
            item.put("valueType", type);
            if (isEnum) item.set("values", alternatives);
            else {
                item.set("minimum", lo.deepCopy());
                item.set("maximum", hi.deepCopy());
            }
            item.set("unit", definition.hasNonNull("unit") ? definition.get("unit").deepCopy() : CaseJson.M.nullNode());
        }
        return items;
    }

    /** True when the employee's current value (a scalar or a list) already holds this option. */
    private static boolean held(JsonNode current, JsonNode option) {
        if (current.isArray()) {
            for (JsonNode v : current) if (same(v, option)) return true;
            return false;
        }
        return same(current, option);
    }

    /** The newest decline on a confirmed brief version that no confirmed brief has already used, or null. */
    private static String newestUnusedDecline(Connection c, String env, String run, String employeeId, List<Brief> briefs)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT decision_id, offer_id, versions::text FROM offer_decisions "
                + "WHERE environment_id = ? AND run_id = ? AND employee_id = ? AND decision = 'decline' "
                + "ORDER BY created_at DESC, decision_id")) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String id = rs.getString(1);
                    JsonNode versions = obj(rs.getString(3));
                    JsonNode v = versions == null ? null : versions.has("brief") ? versions.get("brief") : versions.get("briefVersion");
                    if (rs.getString(2) == null || rs.getString(2).isBlank() || !CaseJson.integer(v)
                            || version(briefs, v.longValue()) == null || used(briefs, id)) continue;
                    return id;
                }
            }
        }
        return null;
    }

    private static boolean used(List<Brief> briefs, String decisionId) {
        for (Brief b : briefs) if (b.change() != null && decisionId.equals(b.change().path("decisionId").asText(null))) return true;
        return false;
    }

    /** Whether the employee confirmed exactly this change as the next brief version; principalId is null on Greg's side. */
    static boolean confirmed(List<Brief> briefs, JsonNode remedy, String principalId) {
        long expected = remedy.path("expectedBriefVersion").asLong();
        Brief before = version(briefs, expected);
        Brief current = current(briefs);
        ObjectNode change = current == null ? null : current.change();
        if (before == null || change == null) return false;
        String by = change.path("confirmedBy").asText("");
        Instant at = instant(change.get("confirmedAt"));
        return remedy.path("decisionId").asText("").equals(change.path("decisionId").asText(null))
                && change.path("fromBriefVersion").asLong(-1) == expected
                && remedy.path("path").asText("").equals(change.path("path").asText(null))
                && same(change.get("after"), remedy.get("value"))
                && !by.isBlank() && by.equals(current.confirmedBy()) && (principalId == null || by.equals(principalId))
                && at != null && at.equals(current.confirmedAt().truncatedTo(ChronoUnit.MILLIS))
                && same(current.content().get("essentials"), before.content().get("essentials"))
                && current.version() == before.version() + 1;
    }

    /** The stored remedy of a confirmed relaxation: the confirmation details come from the brief's audit record. */
    static ObjectNode stored(JsonNode remedy, List<Brief> briefs, boolean confirmed) {
        ObjectNode out = CaseJson.obj();
        for (String k : List.of("type", "decisionId", "expectedBriefVersion", "path", "value")) out.set(k, remedy.get(k).deepCopy());
        out.put("confirmationState", confirmed ? "employee-confirmed" : "employee-confirmation-required");
        if (confirmed) {
            Brief current = current(briefs);
            out.put("confirmedBy", current.change().path("confirmedBy").asText());
            out.put("confirmedAt", current.change().path("confirmedAt").asText());
            out.put("briefVersion", current.version());
        }
        return out;
    }

    /** The employee's view of a case whose remedy is a preference relaxation. */
    static ObjectNode projection(List<Brief> briefs, JsonNode remedy, String principalId) {
        Brief current = current(briefs);
        String key = remedy.path("path").asText("").split("\\.", -1).length > 1 ? remedy.get("path").asText().split("\\.", -1)[1] : "";
        JsonNode value = current == null ? null : current.preferences().path(key).get("value");
        ObjectNode n = CaseJson.obj();
        if (current == null) n.putNull("currentBriefVersion");
        else n.put("currentBriefVersion", current.version());
        n.set("before", value == null ? CaseJson.M.nullNode() : value.deepCopy());
        n.put("applicable", current != null && current.version() == remedy.path("expectedBriefVersion").asLong(-1));
        n.put("confirmed", confirmed(briefs, remedy, principalId));
        return n;
    }

    static boolean isRelaxation(JsonNode remedy) {
        return remedy != null && "preference-relaxation".equals(remedy.path("type").asText(null));
    }

    private static boolean same(JsonNode a, JsonNode b) {
        return Canonical.json(a).equals(Canonical.json(b));
    }

    private static ObjectNode obj(String json) throws SQLException {
        if (json == null) return null;
        try {
            return CaseJson.M.readTree(json) instanceof ObjectNode o ? o : null;
        } catch (IOException e) {
            throw new SQLException("Stored brief or decision JSON is unreadable");
        }
    }
}
