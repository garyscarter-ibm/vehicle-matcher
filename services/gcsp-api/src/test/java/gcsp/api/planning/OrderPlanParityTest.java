package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Every case in order-plan-parity/cases.json.gz was produced by the Node planner and policy readers. */
class OrderPlanParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Path CASES = Path.of("src/test/resources/order-plan-parity/cases.json.gz");
    private static final Path SEED = Path.of("../../server/gcsp/policy/seed-v1.json");

    @TempDir
    Path dir;

    private static JsonNode cases() throws IOException {
        try (InputStream in = new GZIPInputStream(Files.newInputStream(CASES))) {
            return MAPPER.readTree(in);
        }
    }

    @Test
    void javaMatchesEveryNodePlan() throws IOException {
        JsonNode cases = cases();
        assertTrue(cases.size() > 150, "case count " + cases.size());
        OrderPlanSolver solver = new OrderPlanSolver();
        StringBuilder failures = new StringBuilder();
        int failed = 0;
        int plans = 0;
        long started = System.nanoTime();
        for (JsonNode c : cases) {
            if (!c.get("kind").textValue().equals("plan")) {
                continue;
            }
            plans++;
            JsonNode actual = solver.plan(c.get("input"));
            String diff = JsonCompare.diff(c.get("expected"), actual);
            if (diff != null && failed++ < 15) {
                failures.append(c.get("id").textValue()).append(" -> ").append(diff).append('\n');
            }
        }
        long millis = (System.nanoTime() - started) / 1_000_000;
        assertEquals(0, failed, failures.toString());
        assertTrue(plans > 140, "plan count " + plans);
        assertTrue(millis < 10_000, "whole replay took " + millis + " ms");
    }

    @Test
    void javaMatchesNodePolicyAndCatalogueOutcomes() throws IOException {
        StringBuilder failures = new StringBuilder();
        int failed = 0;
        int count = 0;
        for (JsonNode c : cases()) {
            if (!c.get("kind").textValue().equals("policy")) {
                continue;
            }
            count++;
            PolicyService service = new PolicyService(source(c.get("ops"), c.get("id").textValue().replace('/', '_')));
            JsonNode readNode = c.get("read");
            PolicyRead read = new PolicyRead(text(readNode, "runId"), text(readNode, "asOf"), text(readNode, "policyVersion"));
            JsonNode expected = c.get("expected");
            ObjectNode actual = MAPPER.createObjectNode();
            actual.set("rules", new PlanningPolicy(service).readRules(read));
            ObjectNode catalog = new PlanningCatalog(service).readCatalog(c.get("contextRunId").textValue(), read);
            actual.set("catalog", expected.get("catalog").has("digest") && "ok".equals(catalog.get("status").textValue())
                    ? MAPPER.createObjectNode().put("status", "ok").put("digest", PlanDigest.of(catalog)) : catalog);
            List<String> editable = new PlanningPolicy(service).editableKeys(read);
            ArrayNode keys = MAPPER.createArrayNode();
            if (editable != null) {
                editable.forEach(keys::add);
                actual.set("editable", keys);
            } else {
                actual.putNull("editable");
            }
            String diff = JsonCompare.diff(expected, actual);
            if (diff != null && failed++ < 15) {
                failures.append(c.get("id").textValue()).append(" -> ").append(diff).append('\n');
            }
        }
        assertEquals(0, failed, failures.toString());
        assertTrue(count >= 15, "policy case count " + count);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.textValue();
    }

    /** The retained seed with the named edits, as the generator applied them for Node. */
    private RetainedFilePolicySource source(JsonNode ops, String name) throws IOException {
        ObjectNode seed = (ObjectNode) MAPPER.readTree(Files.readAllBytes(SEED));
        ArrayNode assumptions = (ArrayNode) seed.get("assumptions");
        for (JsonNode op : ops) {
            switch (op.get("op").textValue()) {
                case "remove" -> {
                    ArrayNode kept = MAPPER.createArrayNode();
                    for (JsonNode a : assumptions) {
                        if (!a.get("key").textValue().startsWith(op.get("prefix").textValue())) {
                            kept.add(a);
                        }
                    }
                    assumptions = kept;
                    seed.set("assumptions", kept);
                }
                case "set" -> row(assumptions, op.get("key").textValue()).set("value", op.get("value"));
                case "patch" -> {
                    JsonNode target = row(assumptions, op.get("key").textValue()).get("value");
                    JsonNode path = op.get("path");
                    for (int i = 0; i < path.size() - 1; i++) {
                        target = path.get(i).isInt() ? target.get(path.get(i).intValue()) : target.get(path.get(i).textValue());
                    }
                    JsonNode last = path.get(path.size() - 1);
                    if (last.isInt()) {
                        ((ArrayNode) target).set(last.intValue(), op.get("value"));
                    } else {
                        ((ObjectNode) target).set(last.textValue(), op.get("value"));
                    }
                }
                default -> throw new IllegalStateException(op.toString());
            }
        }
        Path file = dir.resolve(name + ".json");
        Files.writeString(file, seed.toString());
        return new RetainedFilePolicySource(file, List.of());
    }

    private static ObjectNode row(ArrayNode assumptions, String key) {
        for (JsonNode a : assumptions) {
            if (a.get("key").textValue().equals(key)) {
                return (ObjectNode) a;
            }
        }
        throw new IllegalStateException(key);
    }

    @Test
    void identicalInputGivesIdenticalPlanAndNullFractionWithoutEntitlements() throws IOException {
        JsonNode c = null;
        for (JsonNode x : cases()) {
            if (x.get("id").textValue().equals("feasible/no-entitlements")) {
                c = x;
            }
        }
        OrderPlanSolver solver = new OrderPlanSolver();
        JsonNode first = solver.plan(c.get("input"));
        assertNull(JsonCompare.diff(first, solver.plan(c.get("input"))));
        assertTrue(first.get("expectedAcceptableCoverage").get("fraction").isNull());
    }
}
