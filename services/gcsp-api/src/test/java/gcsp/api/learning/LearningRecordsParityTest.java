package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Every case in learning-parity/records-cases.json was produced by Node's observed projection and validator
 * (learning-records-parity.mjs). Records, projection versions, validator outcomes and failure codes match exactly.
 */
class LearningRecordsParityTest {

    private static final Path CASES = Path.of("src/test/resources/learning-parity/records-cases.json");
    private static final Path FIXTURE = Path.of("../../server/test/fixtures/gcsp-learning-record.json");

    private final JsonNode file = LearningFixtures.read(CASES);

    /** Cases store values as JSON-pointer set ([path, value]) or delete ([path]) operations on a named base. */
    private static JsonNode apply(JsonNode base, JsonNode ops) {
        JsonNode root = base.deepCopy();
        for (JsonNode op : ops) {
            String path = op.get(0).textValue();
            if (path.isEmpty()) return op.get(1).deepCopy();
            String[] parts = path.substring(1).split("/");
            JsonNode at = root;
            for (int i = 0; i < parts.length - 1; i++) at = at.isArray() ? at.get(Integer.parseInt(parts[i])) : at.get(parts[i]);
            String last = parts[parts.length - 1];
            if (op.size() == 1) {
                ((ObjectNode) at).remove(last);
            } else if (at.isArray()) {
                int index = Integer.parseInt(last);
                ArrayNode array = (ArrayNode) at;
                if (index == array.size()) array.add(op.get(1).deepCopy());
                else array.set(index, op.get(1).deepCopy());
            } else {
                ((ObjectNode) at).set(last, op.get(1).deepCopy());
            }
        }
        return root;
    }

    private static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        if (array != null && !array.isNull()) array.forEach(n -> out.add(n.textValue()));
        return out;
    }

    private static Object clockVersion(JsonNode clock) {
        JsonNode v = clock.get("clockVersion");
        return v.isTextual() ? v.textValue() : (Object) v.longValue();
    }

    private void project(JsonNode c, Map<String, Integer> failures) {
        String name = c.get("name").textValue();
        JsonNode rows = apply(file.get("rowBases").get(c.get("rowBase").textValue()), c.get("rowOps"));
        JsonNode clock = c.get("clock");
        List<String> codes = strings(c.get("declineReasons").get("reasons").findValues("code").stream().collect(
                JsonNodeFactory.instance::arrayNode, ArrayNode::add, ArrayNode::addAll));
        JsonNode expected = c.get("expected");
        String runId = clock.get("runId").textValue();
        if ("failed".equals(expected.get("status").textValue())) {
            LearningSourceException e = assertThrows(LearningSourceException.class,
                    () -> ObservedLearningProjection.project(rows, runId, clock.get("now").textValue(), clockVersion(clock), codes), name);
            assertEquals(expected.get("error").textValue(), e.code(), name);
            failures.merge(e.code(), 1, Integer::sum);
            return;
        }
        ArrayNode actual = ObservedLearningProjection.project(rows, runId, clock.get("now").textValue(), clockVersion(clock), codes);
        ArrayNode records = JsonNodeFactory.instance.arrayNode();
        for (JsonNode ops : expected.get("records")) records.add(apply(file.get("baseRecord"), ops));
        assertEquals(records, actual, name);
        assertEquals(CanonicalJson.canonical(records), CanonicalJson.canonical(actual), name);
        for (JsonNode record : actual) assertTrue(LearningRecords.validate(record, codes).isOk(), name);
        assertEquals(expected.get("projectionVersion").textValue(),
                ObservedLearningProjection.projectionVersion(rows, clock, c.get("declineReasons")), name);
        for (int i = 1; i < actual.size(); i++) assertTrue(actual.get(i - 1).get("recordId").textValue().compareTo(actual.get(i).get("recordId").textValue()) <= 0, name);
    }

    private void validate(JsonNode c) {
        String name = c.get("name").textValue();
        JsonNode record = apply(file.get("bases").get(c.get("base").textValue()), c.get("ops"));
        for (JsonNode run : c.get("runs")) {
            List<String> codes = run.get("declineReasonCodes").isNull() ? null : strings(run.get("declineReasonCodes"));
            JsonNode expected = run.get("expected");
            LearningRecords.Validation actual = LearningRecords.validate(record, codes);
            String label = name + " codes=" + codes;
            assertEquals(expected.get("status").textValue(), actual.status(), label);
            if (actual.isOk()) {
                assertEquals(record, actual.value(), label);
            } else {
                assertEquals(expected.get("code").textValue(), actual.code(), label);
                assertEquals(expected.get("reasons"), actual.reasons(), label);
            }
        }
    }

    @Test
    void everyNodeCaseReplays() {
        Map<String, Integer> kinds = new HashMap<>();
        Map<String, Integer> failures = new HashMap<>();
        for (JsonNode c : file.get("cases")) {
            String kind = c.get("kind").textValue();
            kinds.merge(kind, 1, Integer::sum);
            if (kind.equals("validate")) validate(c);
            else project(c, failures);
        }
        assertEquals(file.get("counts").get("project").intValue(), kinds.get("project"));
        assertEquals(file.get("counts").get("failure").intValue(), kinds.get("failure"));
        assertEquals(file.get("counts").get("random").intValue(), kinds.get("random"));
        assertEquals(file.get("counts").get("validate").intValue(), kinds.get("validate"));
        // Every thrown Node failure the contract names is exercised, with the exact count the generator saw.
        for (String code : List.of("orphan-decision", "owner-mismatch", "reference-mismatch", "brief-version-mismatch", "missing-confirmed-brief",
                "entitlement-reference-mismatch", "slot-owner-mismatch", "contradictory-outcomes", "contradictory-pending", "event-before-offer",
                "invalid-event-time", "contradictory-event-time", "invalid-record", "missing-employee", "ambiguous-hold")) {
            assertNotNull(failures.get(code), code);
            assertEquals(file.get("failures").get(code).intValue(), failures.get(code), code);
        }
    }

    @Test
    void retainedFixtureValidatesWithoutNode() {
        JsonNode sample = LearningFixtures.read(FIXTURE);
        assertTrue(LearningRecords.validate(sample, null).isOk());
        assertEquals("observed", sample.get("provenance").get("kind").textValue());
        assertEquals("unknown", sample.get("outcomes").get("satisfaction").get("state").textValue());
        assertEquals(sample, file.get("bases").get("retained"));
    }

    @Test
    void syntheticLimitsStayExplicit() {
        ObjectNode record = (ObjectNode) LearningFixtures.read(FIXTURE).deepCopy();
        ObjectNode synthetic = record.putObject("provenance");
        synthetic.put("kind", "synthetic").put("generatorVersion", "test-only").put("seed", 1);
        assertTrue(LearningRecords.validate(record, null).isOk());
        synthetic.remove("seed");
        assertFalse(LearningRecords.validate(record, null).isOk());
        synthetic.put("seed", 1).remove("generatorVersion");
        assertFalse(LearningRecords.validate(record, null).isOk());
    }

    @Test
    void projectBriefIntentKeepsOnlyAllowlistedFields() {
        JsonNode brief = LearningFixtures.read(FIXTURE).get("brief");
        ObjectNode withExtras = (ObjectNode) brief.deepCopy();
        ((ObjectNode) withExtras.get("preferences").get("body")).put("source", "PRIVATE");
        withExtras.putObject("currentCarRating").put("value", 4);
        ObjectNode intent = LearningRecords.projectBriefIntent(withExtras);
        assertEquals(brief.get("preferences"), intent.get("preferences"));
        assertEquals(brief.get("essentials"), intent.get("essentials"));
        assertEquals(2, intent.size());
    }
}
