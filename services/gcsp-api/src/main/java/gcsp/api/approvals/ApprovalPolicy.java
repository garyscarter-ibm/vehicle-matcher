package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The four lifecycle policy entries read at one pinned version and validated (port of Node loadLifecyclePolicy). */
public final class ApprovalPolicy {

    public static final String SELECTION_STAGE = "selection received";
    public static final String STAGE_LIST_KEY = "ordering.approvalStages.v1";
    public static final String TICKS_KEY = "lifecycle.approval.ticks.v1";
    public static final String DECLINE_KEY = "lifecycle.approval.declineScenario.v1";
    public static final String OWNERSHIP_KEY = "lifecycle.approval.ownership.v1";
    public static final List<String> KEYS = List.of(STAGE_LIST_KEY, TICKS_KEY, DECLINE_KEY, OWNERSHIP_KEY);
    public static final String UNAVAILABLE = "lifecycle-policy-unavailable";
    public static final String INVALID = "lifecycle-policy-invalid";
    public static final String REASON = "Order approval rules are unavailable. Ask the scheme team to check the scheme setup.";

    private static final List<List<String>> ALLOWED = List.of(
            List.of("sales-manager approval", "sent to ordering"),
            List.of("HR approval", "sales-manager approval", "sent to ordering"));
    private static final List<String> OWNERS = List.of("HR", "sales manager", "ordering", "scheme team");

    private ApprovalPolicy() {}

    public record Step(String owner, String nextStep) {}

    public record Decline(boolean enabled, String stage, String reasonCode, String reason, String eventType) {}

    public record Policy(String policyVersion, List<String> stageList, List<String> approvals,
            Map<String, Integer> ticks, Decline decline, Map<String, Step> stageOwners,
            Map<String, Step> outcomeOwners, List<JsonNode> provenance) {}

    public sealed interface Loaded {}

    public record Ok(Policy policy) implements Loaded {}

    /** Affects only orders pinned to this version or snapshot (code lifecycle-policy-unavailable or -invalid). */
    public record OrderScoped(String code) implements Loaded {}

    /** The shared source failed, so every order refuses with it (for example policy-source-unavailable). */
    public record PolicyWide(String code) implements Loaded {}

    /** Reads every rule at the pinned version; the order's own snapshot of approval stages governs it when given. */
    public static Loaded load(ApprovalPolicyPort port, String policyVersion, List<String> snapshot) {
        if (port == null) return new PolicyWide(UNAVAILABLE);
        ApprovalPolicyPort.Read read;
        try {
            read = port.entries(policyVersion, KEYS);
        } catch (RuntimeException e) {
            return new PolicyWide("policy-source-unavailable");
        }
        if (read == null) return new PolicyWide("policy-source-unavailable");
        if (read instanceof ApprovalPolicyPort.Unavailable u) return new PolicyWide(u.code());
        if (read instanceof ApprovalPolicyPort.VersionNotFound) return new OrderScoped(UNAVAILABLE);
        Map<String, JsonNode> entries = ((ApprovalPolicyPort.Found) read).entries();
        List<JsonNode> rows = new ArrayList<>();
        for (String key : KEYS) {
            JsonNode row = entries.get(key);
            if (row == null) return new OrderScoped(UNAVAILABLE);
            rows.add(row);
        }
        for (JsonNode row : rows) {
            if (!policyVersion.equals(row.path("policyVersion").asText(null)) || !text(row.get("basis"), 2000)
                    || !text(row.get("unit"), 200) || !List.of("assumed", "verified").contains(row.path("status").asText(null))) {
                return new OrderScoped(UNAVAILABLE);
            }
        }
        return validate(policyVersion, snapshot, rows);
    }

    private static Loaded validate(String policyVersion, List<String> snapshot, List<JsonNode> rows) {
        JsonNode stages = rows.get(0).get("value");
        JsonNode ticks = rows.get(1).get("value");
        JsonNode decline = rows.get(2).get("value");
        JsonNode ownership = rows.get(3).get("value");
        List<String> canonical = allowed(stages);
        List<String> approvals = canonical == null ? null : snapshot == null ? canonical : allowed(snapshot);
        if (approvals == null) return new OrderScoped(INVALID);
        List<String> stageList = new ArrayList<>();
        stageList.add(SELECTION_STAGE);
        stageList.addAll(approvals);
        Map<String, Integer> tickMap = new LinkedHashMap<>();
        for (String s : approvals) {
            JsonNode n = ticks == null || !ticks.isObject() ? null : ticks.get(s);
            if (n == null || !n.isNumber() || n.asDouble() != Math.rint(n.asDouble()) || n.asDouble() < 1
                    || n.asDouble() > 50) {
                return new OrderScoped(INVALID);
            }
            tickMap.put(s, n.asInt());
        }
        if (decline == null || !decline.isObject() || !decline.path("enabled").isBoolean() || !text(decline.get("stage"), 200)
                || !text(decline.get("reasonCode"), 64) || !text(decline.get("reason"), 200)
                || !text(decline.get("eventType"), 64)
                || (decline.get("enabled").asBoolean() && !approvals.contains(decline.get("stage").asText()))) {
            return new OrderScoped(INVALID);
        }
        if (ownership == null || !ownership.path("stages").isObject() || !ownership.path("outcomes").isObject()) {
            return new OrderScoped(INVALID);
        }
        Map<String, Step> stageOwners = new LinkedHashMap<>();
        for (String s : stageList) {
            Step step = step(ownership.get("stages").get(s));
            if (step == null) return new OrderScoped(INVALID);
            stageOwners.put(s, step);
        }
        Map<String, Step> outcomeOwners = new LinkedHashMap<>();
        for (String o : List.of("declined", "sent-to-ordering")) {
            Step step = step(ownership.get("outcomes").get(o));
            if (step == null) return new OrderScoped(INVALID);
            outcomeOwners.put(o, step);
        }
        List<JsonNode> provenance = new ArrayList<>();
        for (JsonNode row : rows) {
            ObjectNode p = JsonNodeFactory.instance.objectNode();
            p.put("key", row.path("key").asText(null));
            p.put("status", row.path("status").asText());
            p.put("source", row.path("source").asText(null));
            p.put("sourceDate", row.path("sourceDate").asText(null));
            provenance.add(p);
        }
        Decline d = new Decline(decline.get("enabled").asBoolean(), decline.get("stage").asText(),
                decline.get("reasonCode").asText(), decline.get("reason").asText(), decline.get("eventType").asText());
        return new Ok(new Policy(policyVersion, List.copyOf(stageList), List.copyOf(approvals), tickMap, d,
                stageOwners, outcomeOwners, provenance));
    }

    private static List<String> allowed(JsonNode list) {
        if (list == null || !list.isArray()) return null;
        List<String> values = new ArrayList<>();
        for (JsonNode n : list) values.add(n.isTextual() ? n.asText() : null);
        return allowed(values);
    }

    private static List<String> allowed(List<String> list) {
        for (List<String> a : ALLOWED) if (a.equals(list)) return a;
        return null;
    }

    private static Step step(JsonNode v) {
        if (v == null || !v.isObject() || !OWNERS.contains(v.path("owner").asText(null)) || !text(v.get("nextStep"), 200)) {
            return null;
        }
        return new Step(v.get("owner").asText(), v.get("nextStep").asText());
    }

    static boolean text(JsonNode v, int max) {
        if (v == null || !v.isTextual()) return false;
        String s = v.asText();
        return !s.isBlank() && s.length() <= max && !s.contains("\u2014");
    }
}
