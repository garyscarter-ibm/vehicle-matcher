package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;

/** Document and readiness policy from the shared assumptions port; any gap is unavailable, never a default. */
public final class DocumentPolicy {

    public static final List<String> KEYS = List.of("lifecycle.documents.v1", "lifecycle.documents.scenario.v1",
            "lifecycle.documents.exceptions.v1");
    private static final List<String> OWNERS = List.of("employee", "scheme-team", "retailer");
    private static final List<String> KINDS = List.of("document", "readiness");
    private static final Pattern ITEM_ID = Pattern.compile("[a-z0-9][a-z0-9-]*");
    private static final long MAX_SAFE = 9_007_199_254_740_991L;

    private DocumentPolicy() {}

    public record ItemDef(String itemId, String kind, String label, String owner, String action, long dueSeconds,
            Long progressSeconds, String basis, List<String> schemeIds) {}

    public record ExceptionTypes(String overdue, String failed) {}

    public record Config(String openingStage, String openingState, List<ItemDef> items, List<String> failItemIds,
            String failureReason, ExceptionTypes exceptionTypes, List<JsonNode> assumptions) {}

    public sealed interface Load {

        record Loaded(Config config) implements Load {}

        record Unavailable() implements Load {
            public static final String CODE = "document-policy-unavailable";
            public static final String REASON = "Document and readiness policy is unavailable. "
                    + "Ask the scheme team to check the scheme setup.";
        }
    }

    /** Loads the three pinned rows, or Unavailable when any row, shape or cross-reference fails. */
    public static Load load(DocumentPolicyPort port, String policyVersion) {
        List<DocumentPolicyPort.Assumption> rows = new ArrayList<>();
        for (String key : KEYS) {
            Optional<DocumentPolicyPort.Assumption> row = port.assumption(key, policyVersion);
            if (row.isEmpty() || !current(row.get(), policyVersion)) return new Load.Unavailable();
            rows.add(row.get());
        }
        JsonNode itemsRow = rows.get(0).value();
        if (!isObject(itemsRow)) return new Load.Unavailable();
        JsonNode rawItems = itemsRow.get("items");
        String openingStage = str(itemsRow.get("openingStage"));
        if (!text(openingStage, 128) || !"approved".equals(str(itemsRow.get("openingState"))) || !isArray(rawItems)
                || rawItems.isEmpty()) {
            return new Load.Unavailable();
        }
        List<ItemDef> items = new ArrayList<>();
        for (JsonNode raw : rawItems) {
            ItemDef item = parseItem(raw);
            if (item == null) return new Load.Unavailable();
            items.add(item);
        }
        if (new HashSet<>(items.stream().map(ItemDef::itemId).toList()).size() != items.size()) {
            return new Load.Unavailable();
        }
        JsonNode scenarioRow = rows.get(1).value();
        if (!isObject(scenarioRow)) return new Load.Unavailable();
        List<String> failItemIds = strings(scenarioRow.get("failItemIds"), 128);
        String failureReason = str(scenarioRow.get("failureReason"));
        if (failItemIds == null || !text(failureReason, 240)
                || !failItemIds.stream().allMatch((id) -> nonEmployeeItem(items, id))) {
            return new Load.Unavailable();
        }
        JsonNode exceptionsRow = rows.get(2).value();
        if (!isObject(exceptionsRow)) return new Load.Unavailable();
        String overdue = str(exceptionsRow.get("overdue"));
        String failed = str(exceptionsRow.get("failed"));
        if (!text(overdue, 128) || !text(failed, 128) || overdue.equals(failed)) return new Load.Unavailable();
        List<JsonNode> assumptions = new ArrayList<>();
        for (DocumentPolicyPort.Assumption row : rows) assumptions.add(assumptionRow(row));
        return new Load.Loaded(new Config(openingStage, "approved", List.copyOf(items), List.copyOf(failItemIds),
                failureReason, new ExceptionTypes(overdue, failed), List.copyOf(assumptions)));
    }

    /** The items that apply to one scheme, in policy order. */
    public static List<ItemDef> applicable(Config config, String schemeId) {
        return config.items().stream().filter((item) -> schemeId != null && item.schemeIds().contains(schemeId))
                .toList();
    }

    private static boolean current(DocumentPolicyPort.Assumption row, String policyVersion) {
        return Objects.equals(row.policyVersion(), policyVersion) && text(row.basis(), 2000) && text(row.unit(), 256)
                && ("assumed".equals(row.status()) || "verified".equals(row.status()));
    }

    private static boolean nonEmployeeItem(List<ItemDef> items, String id) {
        return items.stream().anyMatch((item) -> item.itemId().equals(id) && !"employee".equals(item.owner()));
    }

    /** One validated item, or null; the owner decides whether progress or an action is required. */
    private static ItemDef parseItem(JsonNode node) {
        if (!isObject(node)) return null;
        String itemId = str(node.get("itemId"));
        String kind = str(node.get("kind"));
        String label = str(node.get("label"));
        String owner = str(node.get("owner"));
        String basis = str(node.get("basis"));
        Long dueSeconds = safeInteger(node.get("dueSeconds"));
        List<String> schemeIds = strings(node.get("schemeIds"), 128);
        if (!text(itemId, 64) || !ITEM_ID.matcher(itemId).matches() || !oneOf(kind, KINDS) || !text(label, 120)
                || !oneOf(owner, OWNERS) || dueSeconds == null || dueSeconds < 0 || !text(basis, 600)
                || schemeIds == null || schemeIds.isEmpty() || new HashSet<>(schemeIds).size() != schemeIds.size()) {
            return null;
        }
        if ("employee".equals(owner)) {
            String action = str(node.get("action"));
            if (!text(action, 120) || node.has("progressSeconds")) return null;
            return new ItemDef(itemId, kind, label, owner, action, dueSeconds, null, basis, List.copyOf(schemeIds));
        }
        Long progressSeconds = safeInteger(node.get("progressSeconds"));
        if (progressSeconds == null || progressSeconds < 0 || progressSeconds > dueSeconds || node.has("action")) {
            return null;
        }
        return new ItemDef(itemId, kind, label, owner, null, dueSeconds, progressSeconds, basis,
                List.copyOf(schemeIds));
    }

    /** The array's strings within max, or null when the node is not an array or holds a non-text element. */
    private static List<String> strings(JsonNode node, int max) {
        if (!isArray(node)) return null;
        List<String> values = new ArrayList<>();
        for (JsonNode element : node) {
            String value = str(element);
            if (!text(value, max)) return null;
            values.add(value);
        }
        return values;
    }

    private static ObjectNode assumptionRow(DocumentPolicyPort.Assumption row) {
        ObjectNode node = JsonNodeFactory.instance.objectNode();
        put(node, "key", row.key());
        put(node, "status", row.status());
        put(node, "unit", row.unit());
        put(node, "basis", row.basis());
        put(node, "source", row.source());
        put(node, "sourceDate", row.sourceDate());
        put(node, "policyVersion", row.policyVersion());
        return node;
    }

    private static void put(ObjectNode node, String name, String value) {
        if (value != null) node.put(name, value);
    }

    /** The node's text, or null when it is absent or not a JSON string. */
    static String str(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    static boolean isObject(JsonNode node) {
        return node != null && node.isObject();
    }

    static boolean isArray(JsonNode node) {
        return node != null && node.isArray();
    }

    /** The JSON number when JavaScript's Number.isSafeInteger would accept it, else null. */
    static Long safeInteger(JsonNode node) {
        if (node == null || !node.isNumber()) return null;
        if (node.isIntegralNumber()) {
            if (!node.canConvertToLong()) return null;
            long whole = node.longValue();
            return whole >= -MAX_SAFE && whole <= MAX_SAFE ? whole : null;
        }
        double real = node.doubleValue();
        return Double.isFinite(real) && real == Math.floor(real) && Math.abs(real) <= MAX_SAFE ? (long) real : null;
    }

    /** The policy.js text check: a string, not blank by JavaScript trim(), and within max UTF-16 units. */
    private static boolean text(String value, int max) {
        return value != null && !value.chars().allMatch(DocumentPolicy::jsSpace) && value.length() <= max;
    }

    /** The code units that JavaScript trim() removes, so blank here means blank there. */
    private static boolean jsSpace(int c) {
        return c == ' ' || (c >= '\t' && c <= '\r') || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A)
                || c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
    }

    private static boolean oneOf(String value, List<String> options) {
        return value != null && options.contains(value);
    }
}
