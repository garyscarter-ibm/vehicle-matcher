package gcsp.api.policy;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Every case in policy-parity/cases.json was produced by the Node PolicyService over the same retained data. */
class PolicyParityTest {

    private static final Path CASES = Path.of("src/test/resources/policy-parity/cases.json");

    @TempDir
    Path dir;

    private static String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? null : value.textValue();
    }

    private static PolicyRead read(JsonNode node) {
        return node == null || node.isNull() ? null
                : new PolicyRead(text(node, "runId"), text(node, "asOf"), text(node, "policyVersion"));
    }

    private static PolicyContext context(JsonNode node) {
        return node == null || node.isNull() ? null : new PolicyContext(text(node, "runId"),
                text(node, "companyId"), text(node, "schemeId"), text(node, "gradeId"));
    }

    @Test
    void javaMatchesEveryNodeOutcome() throws IOException {
        JsonNode cases = Seeds.MAPPER.readTree(Files.readAllBytes(CASES));
        assertTrue(cases.size() > 600, "case count " + cases.size());
        Map<String, PolicyService> services = new HashMap<>();
        StringBuilder failures = new StringBuilder();
        int failed = 0;
        for (JsonNode c : cases) {
            JsonNode args = c.get("args");
            String variant = args.get("source").textValue();
            PolicyService service = services.get(variant);
            if (service == null) {
                service = new PolicyService(Seeds.source(variant, Files.createTempDirectory(dir, "v")));
                services.put(variant, service);
            }
            PolicyRead read = read(args.get("read"));
            JsonNode car = args.get("car");
            PolicyResult actual;
            switch (c.get("method").textValue()) {
                case "getActiveVersion" -> actual = service.getActiveVersion(read);
                case "getAssumption" -> actual = service.getAssumption(args.get("key").textValue(), read);
                case "getAllowance" -> actual = service.getAllowance(context(args.get("context")), read);
                case "getPointsCost" -> actual = service.getPointsCost(context(args.get("context")), car, read);
                case "getEligibility" -> actual = service.getEligibility(context(args.get("context")), car, read);
                default -> throw new IllegalStateException(c.get("method").textValue());
            }
            JsonNode expected = c.get("expected");
            String diff = JsonCompare.diff(expected, actual.body());
            if (diff == null && !expected.get("status").textValue().equals(actual.status())) {
                diff = "status accessor";
            }
            if (diff != null && failed++ < 15) {
                failures.append(c.get("name").textValue()).append(" -> ").append(diff).append('\n');
            }
        }
        assertEquals(0, failed, failures.toString());
    }

    @Test
    void retainedNodeProjectionFixtureMatches() throws IOException {
        JsonNode expected = Seeds.MAPPER.readTree(Files.readAllBytes(
                Path.of("../../server/test/fixtures/gcsp-policy-projection.json")));
        PolicyService service = new PolicyService(new RetainedFilePolicySource());
        PolicyRead read = new PolicyRead("policy-test-run", "2026-11-04T12:00:00.000Z", null);
        JsonNode mapping = service.getAssumption("eligibility.context.mapping", read).value().get("value");
        JsonNode scheme = mapping.get(0);
        PolicyContext context = new PolicyContext(read.runId(), scheme.get("companyId").textValue(),
                scheme.get("schemeId").textValue(), scheme.get("gradeIds").get(1).textValue());
        JsonNode car = Seeds.MAPPER.createObjectNode().put("eligibilityModelKey", "G20 Saloon|320i");
        var actual = Seeds.MAPPER.createObjectNode();
        actual.set("activeVersion", service.getActiveVersion(read).body());
        actual.set("eligibility", service.getEligibility(context, car, read).body());
        actual.set("allowance", service.getAllowance(context, read).body());
        actual.set("pointsCost", service.getPointsCost(context, car, read).body());
        actual.set("cartHold", service.getAssumption("hold.cart.durationSeconds", read).body());
        actual.set("orderReview", service.getAssumption("hold.cart.orderReview.durationSeconds", read).body());
        actual.set("buddyHold", service.getAssumption("hold.buddy.durationSeconds", read).body());
        assertNull(JsonCompare.diff(expected, actual));
    }
}
