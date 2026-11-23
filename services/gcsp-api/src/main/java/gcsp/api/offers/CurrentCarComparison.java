package gcsp.api.offers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** Quote-time recorded current-car evidence and its explicit public allowlist. No provider or mutable read lives here. */
public final class CurrentCarComparison {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final List<String> FIELDS = List.of("configuration", "body", "fuel", "seats", "boot", "mpg", "zeroTo62", "points");
    private static final List<String> SOURCE = List.of("mode", "sourceRef", "sourceVersion", "schemaVersion", "effectiveFrom", "observedAt");
    private static final Set<String> MODES = Set.of("synthetic", "dated-snapshot", "authorised-live");
    private static final Pattern INSTANT = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})");
    private static final Pattern PUBLIC_INSTANT = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z");
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f]");
    private static final long MAX_REVISION = 9_007_199_254_740_991L;

    /** Independently sourced quote/hold ownership, never taken from the comparison pin itself. */
    public record Owner(String environmentId, String runId, String employeeId, String slotId) {}

    /** The claim's expected employee/slot revisions and actual quote clock. */
    public record Scope(Owner owner, long employeeVersion, long slotVersion, Instant quotedAt) {}

    private CurrentCarComparison() {}

    /** A bounded snapshot of one coherent scoped employee/slot/account-record read in the claim transaction. */
    public static ObjectNode snapshot(Scope scope, JsonNode rows) {
        ObjectNode binding = F.objectNode();
        binding.putNull("contractId").putNull("source");
        binding.putNull("employeeVersion").putNull("slotVersion").putNull("recordSetId").putNull("recordVersion");
        ObjectNode pin = F.objectNode().put("schemaVersion", "1").put("comparisonAvailable", false);
        pin.set("binding", binding);
        ObjectNode display = pin.putObject("display").put("state", "unavailable").putNull("model").putNull("source");
        display.set("unknowns", F.arrayNode().addAll(FIELDS.stream().map(F::textNode).toList()));
        if (scope == null || !validOwner(scope.owner()) || scope.quotedAt() == null || rows == null || !rows.isObject()) return pin;
        Owner owner = scope.owner();
        binding.put("environmentId", owner.environmentId()).put("runId", owner.runId()).put("employeeId", owner.employeeId()).put("slotId", owner.slotId());
        JsonNode employee = rows.path("employee"), slot = rows.path("slot"), account = rows.path("accountRecord");
        if (revision(employee.path("version"))) binding.set("employeeVersion", employee.get("version").deepCopy());
        if (revision(slot.path("version"))) binding.set("slotVersion", slot.get("version").deepCopy());
        JsonNode attributes = employee.path("attributes");
        if (!matches(employee, owner) || !matches(slot, owner) || !matches(account, owner)
                || !owner.slotId().equals(slot.path("slotId").asText(null))
                || !owner.slotId().equals(attributes.path("entitlementSlotId").asText(null))
                || !text(attributes.path("companyId")) || !text(attributes.path("schemeId"))
                || !revision(employee.path("version")) || employee.path("version").longValue() != scope.employeeVersion()
                || !revision(slot.path("version")) || slot.path("version").longValue() != scope.slotVersion()
                || !revision(account.path("version")) || !text(account.path("recordSetId"))) return pin;
        JsonNode record = account.path("record");
        String contractId = slot.path("attributes").path("contractId").asText(null);
        if (!text(contractId) || !account.path("recordSetId").equals(record.path("recordSetId"))
                || !record.path("contracts").isArray() || !source(record.path("source"), scope.quotedAt())) return pin;
        JsonNode contract = null;
        for (JsonNode row : record.path("contracts")) {
            if (!contractId.equals(row.path("contractId").asText(null))) continue;
            if (contract != null) return pin;
            contract = row;
        }
        if (contract == null || !owner.employeeId().equals(contract.path("employeeId").asText(null))
                || !owner.slotId().equals(contract.path("slotId").asText(null))
                || !attributes.path("schemeId").equals(contract.path("schemeId"))
                || !"current".equals(contract.path("status").asText()) || !text(contract.path("model"))
                || !source(contract.path("source"), scope.quotedAt())) return pin;
        binding.put("contractId", contractId).set("source", select(contract.path("source"), SOURCE));
        binding.set("companyId", attributes.get("companyId").deepCopy());
        binding.set("schemeId", attributes.get("schemeId").deepCopy());
        binding.set("recordSetId", account.get("recordSetId").deepCopy());
        binding.set("recordVersion", account.get("version").deepCopy());
        ObjectNode facts = F.objectNode();
        for (String key : FIELDS) {
            JsonNode value = contract.path("vehicle").path(key);
            if (!value(key, value)) continue;
            ObjectNode fact = facts.putObject(key); fact.set("value", value.deepCopy());
            String unit = switch (key) { case "seats" -> "count"; case "boot" -> "L"; case "mpg" -> "mpg-imperial";
                case "zeroTo62" -> "s"; case "points" -> "points-per-month"; default -> null; };
            if (unit == null) fact.putNull("unit"); else fact.put("unit", unit);
        }
        pin.put("comparisonAvailable", !facts.isEmpty());
        display.put("state", facts.size() == FIELDS.size() ? "available" : "partial");
        display.set("model", contract.get("model").deepCopy());
        display.set("source", select(contract.path("source"), List.of("mode", "sourceVersion", "observedAt")));
        if (!facts.isEmpty()) display.set("facts", facts);
        display.set("unknowns", unknowns(facts));
        return pin;
    }

    /** Project only persisted evidence; old, corrupt or differently owned pins truthfully remain unavailable. */
    public static ObjectNode project(JsonNode pin, Owner owner, Instant quotedAt) {
        ObjectNode unavailable = F.objectNode().put("status", "unavailable").put("reason", "pinned-current-car-comparison-unavailable")
                .put("comparisonAvailable", false).putNull("currentCar");
        unavailable.set("unknowns", unknowns(F.objectNode()));
        if (pin == null || !pin.isObject() || !"1".equals(pin.path("schemaVersion").asText())
                || !pin.path("comparisonAvailable").isBoolean() || !validOwner(owner) || !matches(pin.path("binding"), owner)
                || !owner.slotId().equals(pin.path("binding").path("slotId").asText(null)) || quotedAt == null) return unavailable;
        JsonNode display = pin.path("display"), source = display.path("source");
        Instant observed = instant(source.path("observedAt"));
        if (!List.of("available", "partial").contains(display.path("state").asText()) || !publicText(display.path("model"))
                || !MODES.contains(source.path("mode").asText()) || !publicText(source.path("sourceVersion"))
                || !source.path("observedAt").isTextual() || !PUBLIC_INSTANT.matcher(source.path("observedAt").textValue()).matches()
                || observed == null || observed.isAfter(quotedAt)) return unavailable;
        ObjectNode facts = F.objectNode();
        for (String key : FIELDS) {
            JsonNode row = display.path("facts").path(key), unit = row.path("unit");
            if (value(key, row.path("value")) && (!row.path("value").isTextual() || publicText(row.path("value")))
                    && (unit.isNull() || publicText(unit))) {
                ObjectNode fact = facts.putObject(key); fact.set("value", row.get("value").deepCopy()); fact.set("unit", unit.deepCopy());
            }
        }
        ObjectNode out = F.objectNode().put("status", facts.size() == FIELDS.size() ? "available" : "partial")
                .put("reason", facts.isEmpty() ? "current-car-facts-unavailable" : "current-car-facts-recorded")
                .put("comparisonAvailable", !facts.isEmpty());
        ObjectNode car = out.putObject("currentCar"); car.set("model", display.get("model").deepCopy());
        car.set("source", select(source, List.of("mode", "sourceVersion", "observedAt")));
        if (!facts.isEmpty()) car.set("facts", facts);
        out.set("unknowns", unknowns(facts));
        return out;
    }

    private static boolean matches(JsonNode row, Owner owner) {
        return owner.environmentId().equals(row.path("environmentId").asText(null))
                && owner.runId().equals(row.path("runId").asText(null)) && owner.employeeId().equals(row.path("employeeId").asText(null));
    }

    private static boolean validOwner(Owner owner) {
        return owner != null && text(owner.environmentId()) && text(owner.runId()) && text(owner.employeeId()) && text(owner.slotId());
    }

    private static boolean value(String field, JsonNode value) {
        return List.of("configuration", "body", "fuel").contains(field) ? text(value)
                : value.isNumber() && Double.isFinite(value.doubleValue()) && value.doubleValue() > 0;
    }

    private static boolean source(JsonNode source, Instant now) {
        if (!MODES.contains(source.path("mode").asText())) return false;
        for (String key : List.of("sourceRef", "sourceVersion", "schemaVersion")) if (!text(source.path(key))) return false;
        for (String key : List.of("effectiveFrom", "observedAt")) {
            Instant at = instant(source.path(key)); if (at == null || at.isAfter(now)) return false;
        }
        return true;
    }

    private static Instant instant(JsonNode value) {
        if (!value.isTextual() || !INSTANT.matcher(value.textValue()).matches()) return null;
        try { return OffsetDateTime.parse(value.textValue()).toInstant(); } catch (DateTimeParseException e) { return null; }
    }

    private static boolean revision(JsonNode n) { return n.isIntegralNumber() && n.canConvertToLong() && n.longValue() > 0 && n.longValue() <= MAX_REVISION; }
    private static boolean publicText(JsonNode n) { return text(n) && !CONTROL.matcher(n.textValue()).find(); }
    private static boolean text(JsonNode n) { return n.isTextual() && text(n.textValue()); }
    private static boolean text(String s) { return s != null && !s.isBlank() && s.length() <= 256; }

    private static ObjectNode select(JsonNode source, List<String> keys) {
        ObjectNode out = F.objectNode(); for (String key : keys) out.set(key, source.path(key).deepCopy()); return out;
    }

    private static com.fasterxml.jackson.databind.node.ArrayNode unknowns(JsonNode facts) {
        var out = F.arrayNode(); for (String key : FIELDS) if (!facts.has(key)) out.add(key); return out;
    }
}
