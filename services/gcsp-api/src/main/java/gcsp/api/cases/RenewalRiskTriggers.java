package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.cases.CasePolicy.Copy;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The reads and rules of the renewal-risk clock tick: which triggers an employee's renewal has now. */
final class RenewalRiskTriggers {

    static final String DEADLINE_REASON = "The renewal deadline is close and no selection has been acknowledged.";
    private static final String ORDERING = "ordering.";

    /** An outbox event of a configured type; type has the ordering prefix removed. */
    record Event(String eventId, String type, JsonNode payload) {}

    /** An entitlement slot's owner and the renewal it belongs to (null when the slot names none). */
    record Slot(String employeeId, String renewalId) {}

    private RenewalRiskTriggers() {}

    static List<String> employees(Connection c, String env, String run) throws SQLException {
        List<String> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT employee_id FROM employees WHERE environment_id = ? "
                + "AND run_id = ? ORDER BY employee_id")) {
            ps.setString(1, env);
            ps.setString(2, run);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(rs.getString(1));
            }
        }
        return out;
    }

    /** Every outbox event of the lifecycle and selection types (selection also as the ordering-prefixed type). */
    static List<Event> events(Connection c, String env, String run, CasePolicy rule) throws SQLException {
        Set<String> types = new LinkedHashSet<>(rule.lifecycleEventTypes());
        for (String t : rule.selectionEventTypes()) {
            types.add(t);
            types.add(ORDERING + t);
        }
        List<Event> out = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT event_id, event_type, payload::text FROM outbox_events "
                + "WHERE environment_id = ? AND run_id = ? AND event_type = ANY(?) ORDER BY created_at, event_id")) {
            ps.setString(1, env);
            ps.setString(2, run);
            ps.setArray(3, c.createArrayOf("text", types.toArray()));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String type = rs.getString(2);
                    out.add(new Event(rs.getString(1), type.startsWith(ORDERING) ? type.substring(ORDERING.length()) : type,
                            CaseJson.M.readTree(rs.getString(3))));
                }
            }
        } catch (IOException e) {
            throw new SQLException("Stored event JSON is unreadable");
        }
        return out;
    }

    static Map<String, Slot> slots(Connection c, String env, String run) throws SQLException {
        Map<String, Slot> out = new HashMap<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT slot_id, employee_id, attributes->>'renewalId' "
                + "FROM entitlement_slots WHERE environment_id = ? AND run_id = ?")) {
            ps.setString(1, env);
            ps.setString(2, run);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.put(rs.getString(1), new Slot(rs.getString(2), rs.getString(3)));
            }
        }
        return out;
    }

    /** The deadline and lifecycle triggers of one employee's current renewal, and the count of unsupported events. */
    record Found(List<ObjectNode> triggers, int unsupported) {}

    static Found find(CasePolicy rule, String employeeId, CaseAccountPort.Lookup renewal, Instant now, List<Event> events,
            Map<String, Slot> slots) {
        String renewalId = renewal.renewalId();
        List<ObjectNode> triggers = new ArrayList<>();
        LocalDate end = CaseJson.date(renewal.contractEndDate());
        if (rule.deadlineEnabled() && end != null) {
            Instant deadline = end.atTime(23, 59, 59, 999_000_000).toInstant(java.time.ZoneOffset.UTC);
            boolean acknowledged = events.stream().anyMatch(e -> rule.selectionEventTypes().contains(e.type())
                    && belongs(e, employeeId, renewalId, now, slots));
            if (!acknowledged && deadline.toEpochMilli() - now.toEpochMilli() <= rule.withinDays() * ChronoUnit.DAYS.getDuration().toMillis()) {
                triggers.add(CaseJson.obj().put("type", "renewal-deadline").put("sourceId", "deadline:" + renewalId)
                        .put("reason", DEADLINE_REASON));
            }
        }
        int unsupported = 0;
        if (rule.lifecycleEnabled()) {
            for (Event e : events) {
                if (!rule.lifecycleEventTypes().contains(e.type()) || !valid(e, employeeId, now)) continue;
                String eventRenewal = renewalOf(e, employeeId, slots);
                if (renewalId.equals(eventRenewal)) {
                    Copy copy = rule.exceptionCopy().get(e.type());
                    ObjectNode t = CaseJson.obj().put("type", "lifecycle-exception").put("eventType", e.type())
                            .put("sourceId", "outbox:" + e.eventId()).put("orderUuid", e.payload().get("orderUuid").textValue());
                    if (copy != null) t.put("label", copy.label());
                    t.put("reason", copy != null ? copy.reason() : "A configured lifecycle exception needs scheme-team review.");
                    triggers.add(t);
                } else if (eventRenewal != null && ownSlotOf(e, employeeId, eventRenewal, slots)) {
                    unsupported++;
                }
            }
        }
        return new Found(triggers, unsupported);
    }

    private static boolean valid(Event e, String employeeId, Instant now) {
        JsonNode p = e.payload();
        Instant at = CaseJson.instant(p.get("occurredAt"));
        return employeeId.equals(p.path("employeeId").asText(null)) && CaseJson.text(p.get("orderUuid"), 128) && at != null
                && !at.isAfter(now);
    }

    private static boolean belongs(Event e, String employeeId, String renewalId, Instant now, Map<String, Slot> slots) {
        return valid(e, employeeId, now) && renewalId.equals(renewalOf(e, employeeId, slots));
    }

    /** The payload's renewal, else the renewal of the employee's slot the payload names; null when neither. */
    private static String renewalOf(Event e, String employeeId, Map<String, Slot> slots) {
        JsonNode renewal = e.payload().get("renewalId");
        if (renewal != null && renewal.isTextual()) return renewal.textValue();
        Slot slot = slots.get(e.payload().path("entitlementSlotId").asText(null));
        return slot != null && employeeId.equals(slot.employeeId()) ? slot.renewalId() : null;
    }

    /** True when the event's slot (or, with none named, any slot) of this employee carries that renewal. */
    private static boolean ownSlotOf(Event e, String employeeId, String renewal, Map<String, Slot> slots) {
        String named = e.payload().path("entitlementSlotId").asText(null);
        for (Map.Entry<String, Slot> s : slots.entrySet()) {
            if (employeeId.equals(s.getValue().employeeId()) && renewal.equals(s.getValue().renewalId())
                    && (named == null || named.equals(s.getKey()))) return true;
        }
        return false;
    }
}
