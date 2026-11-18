package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;
import static gcsp.api.comparison.ComparisonRunnerSupport.golden;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HashSet;
import java.util.Set;
import java.util.function.BooleanSupplier;
import java.util.function.Function;
import javax.sql.DataSource;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The current route replayed through Java claims against the records Node produced for the same seeds. */
class RouteReplayCurrentTest {

    private static final String NOW = "2026-11-08T12:00:00.000Z";

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

    private static ComparisonExperiments.Prepared prepared() throws IOException {
        for (JsonNode run : golden().get("runs")) {
            if ("process-only".equals(run.get("name").textValue())) return ComparisonExperiments.prepare(run.get("experiment"), POLICY, NOW);
        }
        throw new IllegalStateException("no process-only run");
    }

    private static ComparisonReplay.Request request(ComparisonExperiments.Prepared prepared, String seed, PolicyService policy) {
        ComparisonExperiments.Arm arm = prepared.plan().arms().get(0);
        JsonNode node = prepared.plan().seeds().get(0).isTextual() && seed.equals(prepared.plan().seeds().get(0).textValue())
                ? prepared.plan().seeds().get(0) : prepared.plan().seeds().get(1);
        ComparisonInputs inputs = ComparisonInputs.generate(node, prepared.snapshot(), arm.overlay());
        return new ComparisonReplay.Request(arm, "current", node, inputs, prepared.snapshot(), policy, 1, "parity");
    }

    private static JsonNode recorded(JsonNode golden, String seed) {
        for (JsonNode run : golden.get("runs")) {
            if (!"process-only".equals(run.get("name").textValue())) continue;
            for (JsonNode entry : run.get("records")) {
                if (!seed.equals(entry.get("seed").textValue()) || !"current".equals(entry.get("route").textValue())) continue;
                JsonNode pooled = golden.get("recordPool").get(entry.get("record").intValue());
                ObjectNode record = pooled.deepCopy();
                ArrayNode assumptions = record.putArray("assumptions");
                for (JsonNode index : pooled.get("assumptions")) assumptions.add(golden.get("assumptionPool").get(index.intValue()));
                return record;
            }
        }
        throw new IllegalStateException("no recorded current route for " + seed);
    }

    /** The first employee, car or total that differs, so a failure names a field rather than a digest. */
    private static void same(JsonNode expected, JsonNode actual, String what) {
        for (String section : new String[] {"employees", "cars"}) {
            assertEquals(expected.get(section).size(), actual.get(section).size(), what + " " + section + " size");
            for (int i = 0; i < expected.get(section).size(); i++) {
                assertEquals(CanonicalJson.canonical(expected.get(section).get(i)), CanonicalJson.canonical(actual.get(section).get(i)),
                        what + " " + section + "[" + i + "]");
            }
        }
        assertEquals(CanonicalJson.canonical(expected.get("totals")), CanonicalJson.canonical(actual.get("totals")), what + " totals");
        assertEquals(CanonicalJson.digest(expected), CanonicalJson.digest(actual), what + " record");
    }

    @Test
    void currentRouteRecordsEqualNodesForBothSeedsAndLeaveNoScratchSchema() throws Exception {
        String url = url();
        JsonNode golden = golden();
        ComparisonExperiments.Prepared prepared = prepared();
        Set<String> before = scratchSchemas(url);
        RouteReplay replay = new RouteReplay(sources(url), null);
        for (String seed : new String[] {"parity-a", "parity-b"}) {
            JsonNode actual = replay.replay(request(prepared, seed, POLICY));
            same(recorded(golden, seed), actual, seed);
        }
        assertEquals(before, scratchSchemas(url), "no scratch schema is left after success");
    }

    @Test
    void aRefusalDropsItsSchema() throws Exception {
        String url = url();
        ComparisonExperiments.Prepared prepared = prepared();
        Set<String> before = scratchSchemas(url);
        // The route rules are read after the schema exists, so this refuses with a schema to drop.
        PolicyService skewed = new PolicyService(new gcsp.api.policy.RetainedFilePolicySource()) {
            @Override
            public PolicyResult getAssumption(String key, PolicyRead read) {
                PolicyResult result = super.getAssumption(key, read);
                if (!key.equals("comparison.manualRoute.v1") || !result.ok()) return result;
                ObjectNode body = result.body().deepCopy();
                ((ObjectNode) body.get("value").get("value")).put("candidateOrder", "something-else");
                return new PolicyResult(result.status(), result.policyVersion(), body);
            }
        };
        ComparisonRunError refused = assertThrows(ComparisonRunError.class,
                () -> new RouteReplay(sources(url), null).replay(request(prepared, "parity-a", skewed)));
        assertEquals("invalid-input", refused.code());
        assertEquals("comparison.manualRoute.v1", refused.boundary());
        assertEquals(before, scratchSchemas(url), "no scratch schema is left after a refusal");
    }

    @Test
    void anInterruptedReplayThrowsAndDropsItsSchema() throws Exception {
        String url = url();
        ComparisonExperiments.Prepared prepared = prepared();
        Set<String> before = scratchSchemas(url);
        boolean[] seenSchema = {false};
        // The first hold-duration read happens inside the run, so the interrupt lands while the schema exists.
        PolicyService interrupting = new PolicyService(new gcsp.api.policy.RetainedFilePolicySource()) {
            @Override
            public PolicyResult getAssumption(String key, PolicyRead read) {
                if (key.equals("hold.cart.durationSeconds")) {
                    try {
                        seenSchema[0] = scratchSchemas(url).size() > before.size();
                    } catch (SQLException e) {
                        throw new IllegalStateException(e);
                    }
                    Thread.currentThread().interrupt();
                }
                return super.getAssumption(key, read);
            }
        };
        try {
            assertThrows(ComparisonInterrupted.class,
                    () -> new RouteReplay(sources(url), null).replay(request(prepared, "parity-a", interrupting)));
        } finally {
            Thread.interrupted();
        }
        assertTrue(seenSchema[0], "the interrupt was raised while the scratch schema existed");
        assertEquals(before, scratchSchemas(url), "no scratch schema is left after an interrupt");
    }
}
