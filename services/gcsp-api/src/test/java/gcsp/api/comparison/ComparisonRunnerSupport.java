package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/** Shared loading for the slice 3 parity tests: the golden file, the Node fixtures and one bundled PolicyService. */
final class ComparisonRunnerSupport {

    static final ObjectMapper MAPPER = new ObjectMapper();
    static final Path FIXTURES = Path.of("../../server/test/fixtures");
    static final PolicyService POLICY = new PolicyService(new RetainedFilePolicySource());

    private ComparisonRunnerSupport() {}

    static JsonNode golden() throws IOException {
        try (InputStream in = ComparisonRunnerSupport.class.getClassLoader().getResourceAsStream("comparison-parity/runner.json")) {
            return MAPPER.readTree(in);
        }
    }

    static JsonNode fixture(String name) throws IOException {
        return MAPPER.readTree(Files.readAllBytes(FIXTURES.resolve(name)));
    }

    static JsonNode retainedProcess() throws IOException {
        try (InputStream in = ComparisonRunnerSupport.class.getClassLoader().getResourceAsStream(RetainedComparisonResults.DEFAULT_RESOURCE)) {
            return MAPPER.readTree(in).get("result");
        }
    }

    static ObjectNode copy(JsonNode node) {
        return (ObjectNode) node.deepCopy();
    }

    static void sameJson(JsonNode expected, JsonNode actual, String what) {
        org.junit.jupiter.api.Assertions.assertEquals(CanonicalJson.digest(expected), CanonicalJson.digest(actual), what);
    }
}
