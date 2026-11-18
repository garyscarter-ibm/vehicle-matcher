package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.demand.FitSummary;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** preview-cases.json comes from the Node preview (preview-parity.mjs); Java validation, draft names and fit bands must agree. */
class GregPolicyPreviewParityTest {

    private static final Path CASES = Path.of("src/test/resources/policy-parity/preview-cases.json");

    private static JsonNode cases() throws IOException {
        return Seeds.MAPPER.readTree(Files.readAllBytes(CASES));
    }

    /** The seed with neutral preference weights, as the Node publish fixture adopts them. */
    private static ObjectNode seed() {
        ObjectNode seed = Seeds.seed();
        ObjectNode value = (ObjectNode) Seeds.assumption(seed, GregPolicyProjection.RECOMMENDATION).get("value");
        ObjectNode weights = value.putObject("preferenceWeights");
        value.get("preferences").fieldNames().forEachRemaining(name -> weights.put(name, 1));
        return seed;
    }

    @Test
    void everyRefusalMatchesTheNodePreviewBody() throws IOException {
        JsonNode refusals = cases().get("refusals");
        long now = PolicyTime.parse(cases().get("now").textValue()).getAsLong();
        assertTrue(refusals.size() >= 20, "case count " + refusals.size());
        int stale = 0;
        for (JsonNode c : refusals) {
            String name = c.get("name").textValue();
            GregPolicyProjection.Prepared prepared = GregPolicyPreview.prepare(seed(), now, (ObjectNode) c.get("input"));
            assertNotNull(prepared.error(), name);
            ObjectNode actual = prepared.error().body().deepCopy();
            actual.remove("policyVersion");
            assertNull(JsonCompare.diff(c.get("expected"), actual), name);
            assertEquals(c.get("expected").get("status").textValue(), prepared.error().status(), name);
            if ("stale-version".equals(prepared.error().status())) {
                stale++;
            }
        }
        assertEquals(1, stale);
    }

    @Test
    void everySuccessHasTheNodeDifferencesAndDraftVersion() throws IOException {
        JsonNode successes = cases().get("successes");
        long now = PolicyTime.parse(cases().get("now").textValue()).getAsLong();
        assertTrue(successes.size() >= 8, "case count " + successes.size());
        for (JsonNode c : successes) {
            String name = c.get("name").textValue();
            ObjectNode seed = seed();
            GregPolicyProjection.Prepared prepared = GregPolicyPreview.prepare(seed, now, (ObjectNode) c.get("input"));
            assertNull(prepared.error(), name);
            JsonNode expected = c.get("expected");
            assertNull(JsonCompare.diff(expected.get("differences"), prepared.differences()), name);
            assertEquals(expected.get("activeVersion").textValue(), seed.get("policyVersion").textValue(), name);
            ObjectNode draft = GregPolicyPreview.draft(seed, prepared);
            assertEquals(expected.get("draftVersion").textValue(), draft.get("policyVersion").textValue(), name);
            for (JsonNode row : draft.get("pricePlans")) {
                assertEquals(draft.get("policyVersion").textValue(), row.get("policyVersion").textValue(), name);
            }
        }
    }

    @Test
    void fitCountsBandsAndMeanMatchNode() throws IOException {
        JsonNode fit = cases().get("fit");
        assertTrue(fit.size() >= 10, "case count " + fit.size());
        for (JsonNode c : fit) {
            List<Double> scores = new ArrayList<>();
            c.get("scores").forEach(s -> scores.add(s.doubleValue()));
            ObjectNode actual = FitSummary.render(c.get("eligible").intValue(), scores, c.get("threshold").intValue());
            assertNull(JsonCompare.diff(c.get("expected"), actual), c.get("name").textValue());
        }
    }
}
