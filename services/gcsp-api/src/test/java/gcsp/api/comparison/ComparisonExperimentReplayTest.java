package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.MAPPER;
import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;
import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static gcsp.api.comparison.ComparisonRunnerSupport.sameJson;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.io.IOException;
import java.io.InputStream;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import javax.sql.DataSource;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The supported jobs run through the real Java RouteReplay equal Node's real replay at the small parity size. */
class ComparisonExperimentReplayTest {

    private static String url() {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "GCSP_TEST_DATABASE_URL is not set");
        return url;
    }

    private static Function<String, DataSource> sources(String url) {
        return schema -> {
            PGSimpleDataSource ds = new PGSimpleDataSource();
            ds.setUrl(url);
            if (schema != null) ds.setCurrentSchema(schema);
            return ds;
        };
    }

    private static Set<String> scratchSchemas(String url) throws SQLException {
        Set<String> found = new HashSet<>();
        try (Connection c = sources(url).apply(null).getConnection(); ResultSet rs = c.createStatement().executeQuery(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'cmp\\_%'")) {
            while (rs.next()) found.add(rs.getString(1));
        }
        return found;
    }

    private static JsonNode experiments() throws IOException {
        try (InputStream in = ComparisonExperimentReplayTest.class.getClassLoader().getResourceAsStream("comparison-parity/experiments.json")) {
            return MAPPER.readTree(in);
        }
    }

    private static void check(JsonNode run, String now, String url) throws Exception {
        String name = run.get("name").textValue();
        List<JsonNode> progress = new ArrayList<>();
        ObjectNode result = ComparisonRunner.run(run.get("experiment"), POLICY, new RouteReplay(sources(url), null), "parity",
                () -> now, step -> progress.add(step.toJson()));
        assertEquals(run.get("result").get("kind").textValue(), result.get("kind").textValue(), name + " kind");
        assertEquals(run.get("result").get("arms").intValue(), result.has("arms") ? result.get("arms").size() : 0, name + " arms");
        assertEquals(run.get("result").get("effects").intValue(), result.has("effects") ? result.get("effects").size() : 0, name + " effects");
        ArrayNode expected = JsonNodeFactory.instance.arrayNode().addAll((ArrayNode) run.get("progress"));
        ArrayNode actual = JsonNodeFactory.instance.arrayNode();
        progress.forEach(actual::add);
        sameJson(expected, actual, name + " progress");
        assertEquals(run.get("resultDigest").textValue(), CanonicalJson.digest(result), name + " result digest");
    }

    @Test
    void processOnlyAndEachWhatIfRunThroughTheRealReplayEqualNodesResults() throws Exception {
        String url = url();
        Set<String> before = scratchSchemas(url);
        String now = experiments().get("now").textValue();
        for (JsonNode run : golden().get("runs")) {
            if ("process-only".equals(run.get("name").textValue())) check(run, now, url);
        }
        for (JsonNode run : experiments().get("runs")) check(run, now, url);
        assertEquals(before, scratchSchemas(url), "no scratch schema is left after the runs");
    }
}
