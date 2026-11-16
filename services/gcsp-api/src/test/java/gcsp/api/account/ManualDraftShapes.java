package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/** Java mirrors of the Angular account client validators (account.client.ts choices, draft, discarded, failure, scoped). */
final class ManualDraftShapes {

    private static final List<String> CHOICE_FIELDS = List.of("mode", "oldContractId", "slotId", "schemeId", "driverId",
            "contractOptionId", "requestedCollectionDate", "collectionLocationId", "brand", "contact",
            "expectedReturnMileage", "specialRequirements");
    private static final List<String> STATUSES = List.of("unavailable", "forbidden", "invalid", "not-found", "conflict",
            "stale-version", "stale-run", "unsupported", "unauthenticated", "authentication-required", "pending", "uncertain",
            "refused");

    private ManualDraftShapes() {}

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank();
    }

    private static boolean revision(JsonNode n) {
        return n != null && n.isIntegralNumber() && n.longValue() >= 0;
    }

    private static boolean absentOrText(JsonNode n) {
        return n == null || text(n);
    }

    static boolean choices(JsonNode v) {
        if (v == null || !v.isObject()) return false;
        for (var it = v.fieldNames(); it.hasNext();) if (!CHOICE_FIELDS.contains(it.next())) return false;
        boolean replacement = "replacement".equals(v.path("mode").asText());
        if (!replacement && !"new".equals(v.path("mode").asText())) return false;
        if (!text(v.get("slotId")) || !text(v.get("schemeId"))) return false;
        if (replacement ? !text(v.get("oldContractId")) : v.get("oldContractId") == null || !v.get("oldContractId").isNull()) {
            return false;
        }
        for (String k : List.of("driverId", "contractOptionId", "requestedCollectionDate", "collectionLocationId", "brand")) {
            if (!absentOrText(v.get(k))) return false;
        }
        JsonNode contact = v.get("contact");
        if (contact != null && !(contact.isObject() && text(contact.get("phone")) && text(contact.get("email"))
                && contact.size() == 2)) return false;
        JsonNode mileage = v.get("expectedReturnMileage");
        if (mileage != null && !mileage.isNull() && !revision(mileage)) return false;
        JsonNode special = v.get("specialRequirements");
        return special == null || special.isTextual();
    }

    static boolean draft(JsonNode v) {
        if (v == null || !v.isObject() || !revision(v.get("draftVersion")) || v.get("draftVersion").longValue() <= 0
                || !text(v.get("contextVersion")) || !choices(v.get("choices"))) return false;
        JsonNode refresh = v.get("requiresRefresh");
        if (refresh != null && !refresh.isBoolean()) return false;
        JsonNode stage = v.get("draftStage");
        if (stage != null && !(stage.isTextual() && List.of("intent", "complete").contains(stage.textValue()))) return false;
        return v.get("view") == null || v.get("view").isNull() || v.get("view").isObject();
    }

    static boolean discarded(JsonNode v) {
        return v != null && v.isObject() && revision(v.get("draftVersion")) && v.get("draftVersion").longValue() > 0
                && v.has("discarded") && v.get("discarded").isBoolean() && v.get("discarded").booleanValue();
    }

    static boolean failure(JsonNode v) {
        if (v == null || !v.isObject() || !v.has("status") || !STATUSES.contains(v.get("status").asText())) return false;
        for (String k : List.of("code", "reason", "operationId", "resource", "resourceType", "action", "contractVersion")) {
            if (v.has(k) && !text(v.get(k))) return false;
        }
        if (v.has("retryable") && !v.get("retryable").isBoolean()) return false;
        return !v.has("view") || v.get("view").isNull() || v.get("view").isObject();
    }

    /** Every nested employeeId, environmentId and runId must equal the caller's. */
    static boolean scoped(JsonNode v, Map<String, String> scope) {
        if (v.isArray()) {
            for (JsonNode n : v) if (!scoped(n, scope)) return false;
            return true;
        }
        if (!v.isObject()) return true;
        for (var it = v.fields(); it.hasNext();) {
            var e = it.next();
            if (scope.containsKey(e.getKey())) {
                if (!e.getValue().isTextual() || !e.getValue().textValue().equals(scope.get(e.getKey()))) return false;
            } else if (!scoped(e.getValue(), scope)) {
                return false;
            }
        }
        return true;
    }

    static void assertOkDraft(JsonNode body, Map<String, String> scope) {
        assertEquals("ok", body.get("status").asText());
        assertTrue(draft(body.get("value")), body.toString());
        assertTrue(scoped(body, scope), body.toString());
    }

    static void assertOkDiscard(JsonNode body, Map<String, String> scope) {
        assertEquals("ok", body.get("status").asText());
        assertTrue(discarded(body.get("value")), body.toString());
        assertTrue(scoped(body, scope), body.toString());
    }

    static void assertFailure(JsonNode body, Map<String, String> scope) {
        assertTrue(failure(body), body.toString());
        assertTrue(scoped(body, scope), body.toString());
    }
}
