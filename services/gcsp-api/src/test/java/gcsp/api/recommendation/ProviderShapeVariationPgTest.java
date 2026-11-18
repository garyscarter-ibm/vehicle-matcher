package gcsp.api.recommendation;

import static gcsp.api.recommendation.ProviderShapeVariationSupport.driverFlag;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Provider components plus native release persistence and real recommendation computation; no CDI startup claim. */
class ProviderShapeVariationPgTest {

    @TempDir Path dir;

    @Test
    void sameBriefChangesComputedEligibilityWhenHrDriverEligibilityChanges() throws Exception {
        ObjectNode allowed = ProviderShapeVariationSupport.hrExport();
        ObjectNode denied = allowed.deepCopy();
        driverFlag(denied).put("value", false);
        ObjectNode restored = denied.deepCopy();
        driverFlag(restored).set("value", driverFlag(allowed).get("value"));
        assertEquals(allowed, restored, "the HR exports differ only at the driver's eligible.value");
        assertEquals(driverFlag(allowed).get("provenance"), driverFlag(denied).get("provenance"));
        Path allowedFile = ProviderShapeVariationSupport.write(dir, "allowed-hr", allowed);
        Path deniedFile = ProviderShapeVariationSupport.write(dir, "denied-hr", denied);
        ObjectNode brief = ProviderShapeVariationSupport.brief();
        PolicyService policy = SourceFixture.policy();
        try (var db = ProviderShapeVariationSupport.Db.create()) {
            db.release(dir, "hr-shape", ProviderShapeVariationSupport.plan(), policy);
            JsonNode before = value(ProviderShapeVariationSupport.compose(allowedFile, db, policy).recommend(brief));
            JsonNode after = value(ProviderShapeVariationSupport.compose(deniedFile, db, policy).recommend(brief));
            assertEquals(2, before.get("eligibleCount").asInt());
            assertEquals(2, before.get("recommendations").size());
            assertEquals(0, after.get("eligibleCount").asInt());
            assertTrue(after.get("recommendations").isEmpty());
            assertEquals("no-viable-stock", after.get("state").asText());
            assertEquals(orderIds(before.get("decisions")), orderIds(after.get("decisions")));
            assertEquals(before.get("versions"), after.get("versions"), "a changed digest alone cannot satisfy this proof");
            for (JsonNode decision : after.get("decisions")) {
                JsonNode original = decision(before, decision.get("orderUuid").asText());
                assertEquals("eligible", original.get("gateStatus").asText());
                assertEquals("ineligible", decision.get("gateStatus").asText());
                assertTrue(decision.get("blockers").findValuesAsText("code").contains("driver-ineligible"));
                assertEquals(driverFlag(denied), decision.get("employeeFacts").get("driverEligible"));
                assertEquals(brief, original.get("brief"));
                assertEquals(brief, decision.get("brief"));
            }
        }
    }

    @Test
    void sameBriefChangesComputedRecommendationsWhenTrancheStockFactsChange() throws Exception {
        ObjectNode base = ProviderShapeVariationSupport.plan();
        ObjectNode changed = base.deepCopy();
        JsonNode sourceRows = ProviderShapeVariationSupport.stockRows();
        ObjectNode changedFact = modelKey(changed);
        changedFact.set("value", sourceRows.get(1).get("facts").get("facts").get("eligibilityModelKey").get("value"));
        ObjectNode restored = changed.deepCopy();
        modelKey(restored).set("value", modelKey(base).get("value"));
        assertEquals(base, restored, "the tranche plans differ only at one stock model-key fact value");
        Path hr = ProviderShapeVariationSupport.write(dir, "stock-hr", ProviderShapeVariationSupport.hrExport());
        ObjectNode brief = ProviderShapeVariationSupport.brief();
        JsonNode before = value(ProviderShapeVariationSupport.evaluate(dir, "base-stock", hr, base, brief));
        JsonNode after = value(ProviderShapeVariationSupport.evaluate(dir, "changed-stock", hr, changed, brief));
        String first = sourceRows.get(0).get("orderUuid").asText();
        String other = sourceRows.get(2).get("orderUuid").asText();
        assertEquals(2, before.get("eligibleCount").asInt());
        assertTrue(orderIds(before.get("recommendations")).containsAll(List.of(first, other)));
        assertEquals(1, after.get("eligibleCount").asInt());
        assertEquals(List.of(other), orderIds(after.get("recommendations")));
        assertEquals(orderIds(before.get("decisions")), orderIds(after.get("decisions")));
        assertEquals("eligible", decision(before, first).get("gateStatus").asText());
        JsonNode excluded = decision(after, first);
        assertEquals("ineligible", excluded.get("gateStatus").asText());
        assertTrue(excluded.get("blockers").findValuesAsText("code").contains("policy-exclude"));
        assertEquals("eligible", decision(after, other).get("gateStatus").asText());
        assertEquals(before.get("versions").get("policy"), after.get("versions").get("policy"));
        assertEquals(before.get("versions").get("facts"), after.get("versions").get("facts"));
        assertEquals(brief, excluded.get("brief"));
        assertEquals(brief, decision(before, first).get("brief"));
    }

    @Test
    void unreadableHrExportDoesNotReuseEarlierComputedCandidates() throws Exception {
        Path hr = ProviderShapeVariationSupport.write(dir, "failing-hr", ProviderShapeVariationSupport.hrExport());
        ObjectNode brief = ProviderShapeVariationSupport.brief();
        PolicyService policy = SourceFixture.policy();
        try (var db = ProviderShapeVariationSupport.Db.create()) {
            db.release(dir, "hr-failure", ProviderShapeVariationSupport.plan(), policy);
            var composed = ProviderShapeVariationSupport.compose(hr, db, policy);
            assertEquals(2, value(composed.recommend(brief)).get("eligibleCount").asInt());
            Files.writeString(hr, "{not valid JSON");
            assertEquals("unavailable", composed.source().resolve(composed.context()).get("status").asText());
            JsonNode unavailable = composed.recommend(brief);
            assertEquals("unavailable", unavailable.get("status").asText());
            assertEquals("employee-source-unavailable", unavailable.get("code").asText());
            assertTrue(unavailable.get("retryable").asBoolean());
            assertFalse(unavailable.has("value"), "earlier candidates must not survive an unreadable export");
        }
    }

    private static ObjectNode modelKey(ObjectNode plan) {
        return (ObjectNode) plan.get("windows").get(0).get("stock").get(0).get("facts").get("facts").get("eligibilityModelKey");
    }

    private static JsonNode value(JsonNode result) {
        assertEquals("ok", result.path("status").asText(), () -> result.toString());
        return result.get("value");
    }

    private static JsonNode decision(JsonNode result, String orderUuid) {
        for (JsonNode decision : result.get("decisions")) {
            if (orderUuid.equals(decision.get("orderUuid").asText())) return decision;
        }
        throw new AssertionError("Missing decision for " + orderUuid);
    }

    private static List<String> orderIds(JsonNode decisions) {
        List<String> ids = new ArrayList<>();
        decisions.forEach(decision -> ids.add(decision.get("orderUuid").asText()));
        return ids;
    }
}
