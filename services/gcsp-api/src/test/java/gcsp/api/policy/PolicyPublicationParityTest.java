package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** publish-cases.json was produced by the Node validateChangeSet and preparePublication; Java must agree on all. */
class PolicyPublicationParityTest {

    private static final Path CASES = Path.of("src/test/resources/policy-parity/publish-cases.json");
    private static final Path FIXTURE = Path.of("../../server/test/fixtures/gcsp-policy-version-outcomes.json");

    private static JsonNode cases() throws IOException {
        return Seeds.MAPPER.readTree(Files.readAllBytes(CASES));
    }

    @Test
    void validateChangeSetMatchesNodeOnEveryCase() throws IOException {
        JsonNode validate = cases().get("validate");
        assertTrue(validate.size() >= 30, "case count " + validate.size());
        int refusals = 0;
        for (JsonNode c : validate) {
            PolicyResult actual = PolicyPublication.validateChangeSet(c.get("input"));
            JsonNode expected = c.get("expected");
            if (expected.isNull()) {
                assertNull(actual, c.get("name").textValue());
            } else {
                refusals++;
                assertNotNull(actual, c.get("name").textValue());
                assertNull(JsonCompare.diff(expected, actual.body()), c.get("name").textValue());
                assertEquals("invalid", actual.status());
            }
        }
        assertTrue(refusals >= 25, "refusal cases " + refusals);
    }

    @Test
    void preparePublicationMatchesNodeOutcomesAndSuccessors() throws IOException {
        JsonNode root = cases();
        String defaultNow = root.get("now").textValue();
        String publisher = root.get("publisher").textValue();
        JsonNode prepare = root.get("prepare");
        assertTrue(prepare.size() >= 45, "case count " + prepare.size());
        Set<String> statuses = new HashSet<>();
        for (JsonNode c : prepare) {
            String name = c.get("name").textValue();
            List<ObjectNode> seeds = new ArrayList<>(List.of(Seeds.seed()));
            for (JsonNode step : c.get("prior")) {
                PolicyPublication.Published done = PolicyPublication.preparePublication(seeds, step.get("input"), publisher,
                        step.has("now") ? step.get("now").textValue() : defaultNow);
                assertNotNull(done.seed(), name + " prior step");
                seeds.add(done.seed());
            }
            PolicyPublication.Published actual = PolicyPublication.preparePublication(seeds, c.get("input"), publisher,
                    c.get("now").textValue());
            JsonNode expected = c.get("outcome");
            assertNull(JsonCompare.diff(expected, actual.outcome().body()), name);
            assertEquals(expected.get("status").textValue(), actual.outcome().status(), name);
            statuses.add(expected.get("status").textValue());
            JsonNode successor = c.get("successor");
            if (successor == null) {
                assertNull(actual.seed(), name);
            } else {
                assertSuccessor(name, successor, actual, publisher);
            }
        }
        assertEquals(Set.of("ok", "invalid", "stale-version"), statuses);
    }

    private static void assertSuccessor(String name, JsonNode expected, PolicyPublication.Published actual, String publisher) {
        ObjectNode seed = actual.seed();
        assertNotNull(seed, name);
        assertEquals(expected.get("policyVersion").textValue(), seed.get("policyVersion").textValue(), name);
        assertEquals(expected.get("effectiveFrom").textValue(), seed.get("effectiveFrom").textValue(), name);
        assertEquals(expected.get("source").textValue(), seed.get("source").textValue(), name);
        assertEquals(expected.get("hasEffectiveTo").booleanValue(), seed.has("effectiveTo"), name);
        assertEquals(expected.get("sourceVersion").textValue(), actual.sourceVersion(), name);
        assertEquals(expected.get("publishedAt").textValue(), actual.publishedAt(), name);
        assertEquals(publisher, expected.get("publisher").textValue(), name);
        Set<String> touched = new HashSet<>();
        for (JsonNode patched : expected.get("patched")) {
            String table = patched.get("table").textValue();
            String key = patched.get("key").textValue();
            touched.add(table + "\u0000" + key);
            JsonNode row = null;
            for (JsonNode candidate : seed.get(table)) {
                if (key.equals(candidate.get("key").textValue())) {
                    row = candidate;
                }
            }
            assertNull(JsonCompare.diff(patched.get("row"), row), name + " " + key);
        }
        for (String table : PolicyPublication.TABLES) {
            assertEquals(expected.get("rowCounts").get(table).intValue(), seed.get(table).size(), name + " " + table);
            ArrayNode others = Seeds.MAPPER.createArrayNode();
            for (JsonNode row : seed.get(table)) {
                if (!touched.contains(table + "\u0000" + row.get("key").textValue())) {
                    others.add(row);
                }
            }
            // The digests are Node's canonical SHA-256, so Node-written documents verify in Java and the reverse.
            assertEquals(expected.get("otherRowsDigest").get(table).textValue(), PolicyDigest.of(others), name + " " + table);
        }
        assertEquals(expected.get("successorDigest").textValue(), PolicyDigest.of(seed), name);
    }

    @Test
    void forbiddenAndStaleBodiesEqualTheNodeFixture() throws IOException {
        JsonNode fixture = Seeds.MAPPER.readTree(Files.readAllBytes(FIXTURE));
        ObjectNode forbidden = PolicyBodies.forbidden(null).body();
        assertNull(JsonCompare.diff(fixture.get("forbidden"), forbidden));
        // The Java refusal adds only a code, so a caller can tell a role refusal from an environment mismatch.
        ObjectNode withCode = PolicyBodies.forbidden("role-required").body();
        assertEquals("role-required", withCode.remove("code").textValue());
        assertNull(JsonCompare.diff(fixture.get("forbidden"), withCode));
        ObjectNode stale = PolicyBodies.stale("old", "gcsp-policy-v1").body();
        assertNull(JsonCompare.diff(fixture.get("stale"), stale));
        assertNull(JsonCompare.diff(fixture.get("invalid"), PolicyBodies.invalid("changeSet",
                "Supply commandId, expectedActiveVersion, new policyVersion, ISO effectiveFrom and 1 to 100 changes.").body()));
    }

    @Test
    void theFileSourceRefusesPublicationLikeNode() {
        PolicyService service = new PolicyService(new RetainedFilePolicySource());
        PolicyResult result = service.publishPolicyVersion(null, null);
        assertEquals("invalid", result.status());
        assertEquals("unsupported-operation", result.code());
        assertEquals("The file policy provider is read-only.", result.body().get("reasons").get(0).get("reason").textValue());
        assertEquals(false, result.body().get("accepted").booleanValue());
    }
}
