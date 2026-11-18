package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Port of the per-brief cohort loop of server/gcsp/predict/plan/forecast.js, up to the already-selected check. */
public final class DemandCohort {

    /** One outcome per current brief, in brief order; a Failure is always the last step. */
    public sealed interface Step permits Failure, Excluded, Member {
    }

    public record Failure(String code) implements Step {
    }

    public record Excluded(String employeeId, String reason) implements Step {
    }

    public record Member(ObjectNode employee, JsonNode slot, JsonNode brief, String renewalAt) implements Step {
    }

    private static final Pattern NUMBER = Pattern.compile("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?");

    private DemandCohort() {
    }

    /**
     * Throws IllegalArgumentException where Node throws a TypeError: a non-array table or a null row, read lazily
     * as Node reaches it, plus renewalInstant's cases.
     */
    public static List<Step> steps(JsonNode rows, String horizonEnd) {
        if (!Js.object(rows)) {
            throw new IllegalArgumentException("rows");
        }
        Long horizon = JsTime.parse(horizonEnd);
        List<Step> out = new ArrayList<>();
        for (JsonNode brief : currentBriefs(table(rows, "briefs"))) {
            JsonNode briefEmployeeId = Js.get(brief, "employeeId");
            JsonNode row = find(table(rows, "employees"), "employeeId", briefEmployeeId);
            JsonNode rowSlotId = Js.get(row, "entitlementSlotId");
            JsonNode linked = Js.text(rowSlotId) ? find(table(rows, "entitlement_slots"), "entitlementSlotId", rowSlotId) : null;
            ObjectNode employee = null;
            if (Js.object(row)) {
                employee = ((ObjectNode) row).deepCopy();
                JsonNode own = row.get("renewalId");
                if ((own == null || own.isNull()) && same(Js.get(linked, "employeeId"), Js.get(row, "employeeId"))) {
                    JsonNode fromSlot = Js.get(linked, "renewalId");
                    if (fromSlot == null) {
                        employee.remove("renewalId");
                    } else {
                        employee.set("renewalId", fromSlot.deepCopy());
                    }
                }
            }
            if (employee == null || !Js.text(employee.get("renewalId")) || !Js.text(employee.get("entitlementSlotId"))) {
                out.add(new Failure("planning-forecast-entitlement-missing"));
                return out;
            }
            JsonNode employeeId = employee.get("employeeId");
            JsonNode renewalId = employee.get("renewalId");
            JsonNode slot = find(table(rows, "entitlement_slots"), "entitlementSlotId", employee.get("entitlementSlotId"));
            JsonNode briefRenewal = Js.get(brief, "renewalId");
            JsonNode briefSlot = Js.get(brief, "entitlementSlotId");
            if (slot == null || !same(Js.get(slot, "employeeId"), employeeId) || !same(Js.get(slot, "renewalId"), renewalId)
                    || briefRenewal != null && !briefRenewal.isNull() && !same(briefRenewal, renewalId)
                    || briefSlot != null && !same(briefSlot, Js.get(slot, "entitlementSlotId"))) {
                out.add(new Failure("planning-forecast-entitlement-mismatch"));
                return out;
            }
            String renewalAt = PlanningRenewal.renewalInstant(employee);
            if (renewalAt == null) {
                out.add(new Failure("planning-renewal-unconfirmed"));
                return out;
            }
            String id = employeeId == null ? "" : employeeId.asText();
            Long renewal = JsTime.parse(renewalAt);
            if (horizon != null && renewal != null && renewal > horizon) {
                out.add(new Excluded(id, "outside-horizon"));
            } else if (selected(rows, employee, slot)) {
                out.add(new Excluded(id, "already-selected"));
            } else {
                out.add(new Member(employee, slot.deepCopy(), brief.deepCopy(), renewalAt));
            }
        }
        return out;
    }

    /** Confirmed briefs, the strictly greater briefVersion per employeeId winning, sorted as Node's compare. */
    private static List<JsonNode> currentBriefs(List<JsonNode> briefs) {
        Map<String, JsonNode> byEmployee = new LinkedHashMap<>();
        for (JsonNode b : briefs) {
            nonNull(b);
            if (!is(Js.get(b, "status"), "confirmed")) {
                continue;
            }
            String key = key(Js.get(b, "employeeId"));
            JsonNode held = byEmployee.get(key);
            if (held == null || less(Js.get(held, "briefVersion"), Js.get(b, "briefVersion"))) {
                byEmployee.put(key, b);
            }
        }
        List<JsonNode> sorted = new ArrayList<>();
        for (JsonNode b : byEmployee.values()) {
            int at = sorted.size();
            while (at > 0 && compare(Js.get(sorted.get(at - 1), "employeeId"), Js.get(b, "employeeId")) > 0) {
                at--;
            }
            sorted.add(at, b);
        }
        return sorted;
    }

    /** rows.holds.some(...) with its nested rows.stock.some(...), evaluated in Node's short-circuit order. */
    private static boolean selected(JsonNode rows, JsonNode employee, JsonNode slot) {
        for (JsonNode h : table(rows, "holds")) {
            nonNull(h);
            if (same(Js.get(h, "employeeId"), employee.get("employeeId"))
                    && same(Js.get(h, "entitlementSlotId"), Js.get(slot, "entitlementSlotId"))
                    && same(Js.get(h, "renewalId"), employee.get("renewalId"))
                    && is(Js.get(h, "state"), "allocated")
                    && stockAllocated(rows, Js.get(h, "orderUuid"))) {
                return true;
            }
        }
        return false;
    }

    private static boolean stockAllocated(JsonNode rows, JsonNode orderUuid) {
        for (JsonNode s : table(rows, "stock")) {
            nonNull(s);
            JsonNode flag = Js.get(s, "allocated");
            if (same(Js.get(s, "orderUuid"), orderUuid)
                    && (is(Js.get(s, "state"), "allocated") || flag != null && flag.isBoolean() && flag.booleanValue())) {
                return true;
            }
        }
        return false;
    }

    private static List<JsonNode> table(JsonNode rows, String name) {
        JsonNode t = rows.get(name);
        if (!Js.array(t)) {
            throw new IllegalArgumentException(name);
        }
        return Js.items(t);
    }

    /** list.find(e => e[field] === want); a null element throws as in Node. */
    private static JsonNode find(List<JsonNode> list, String field, JsonNode want) {
        for (JsonNode e : list) {
            nonNull(e);
            if (same(Js.get(e, field), want)) {
                return e;
            }
        }
        return null;
    }

    private static void nonNull(JsonNode n) {
        if (n == null || n.isNull()) {
            throw new IllegalArgumentException("null row");
        }
    }

    private static boolean is(JsonNode n, String value) {
        return n != null && n.isTextual() && value.equals(n.textValue());
    }

    /** JS ===: absent equals absent, numbers by value, everything else JsonNode.equals. */
    private static boolean same(JsonNode a, JsonNode b) {
        if (a == null || b == null) {
            return a == b;
        }
        if (a.isNumber() && b.isNumber()) {
            return a.doubleValue() == b.doubleValue();
        }
        return a.equals(b);
    }

    /** Map key with SameValueZero identity for the scalar kinds. */
    private static String key(JsonNode n) {
        if (n == null) {
            return "u:";
        }
        if (n.isTextual()) {
            return "s:" + n.textValue();
        }
        if (n.isNumber()) {
            return "n:" + (n.doubleValue() == 0 ? 0.0 : n.doubleValue());
        }
        if (n.isBoolean()) {
            return "b:" + n.booleanValue();
        }
        return n.isNull() ? "null:" : "o:" + System.identityHashCode(n);
    }

    private static int compare(JsonNode a, JsonNode b) {
        return less(a, b) ? -1 : less(b, a) ? 1 : 0;
    }

    /** JS a < b: two strings by UTF-16 order, otherwise by ToNumber with NaN never less. */
    private static boolean less(JsonNode a, JsonNode b) {
        if (a != null && b != null && a.isTextual() && b.isTextual()) {
            return a.textValue().compareTo(b.textValue()) < 0;
        }
        return number(a) < number(b);
    }

    private static double number(JsonNode n) {
        if (n == null) {
            return Double.NaN;
        }
        if (n.isNumber()) {
            return n.doubleValue();
        }
        if (n.isNull()) {
            return 0;
        }
        if (n.isBoolean()) {
            return n.booleanValue() ? 1 : 0;
        }
        if (n.isTextual()) {
            String s = n.textValue().trim();
            return s.isEmpty() ? 0 : NUMBER.matcher(s).matches() ? Double.parseDouble(s) : Double.NaN;
        }
        return Double.NaN;
    }
}
