package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonRunnerSupport.POLICY;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** Measurement only: replays one full-size process-only seed through both routes and writes the records. */
class RouteReplayFullSizeTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String NOW = "2026-11-08T12:00:00.000Z";

    @Test
    void replaysOneSeedBothRoutes() throws Exception {
        String url = System.getenv("GCSP_TEST_DATABASE_URL");
        String seed = System.getenv("GCSP_COMPARISON_FULL_SEED");
        String out = System.getenv("GCSP_COMPARISON_FULL_OUT");
        Assumptions.assumeTrue(url != null && !url.isBlank() && seed != null && !seed.isBlank() && out != null && !out.isBlank(),
                "GCSP_TEST_DATABASE_URL, GCSP_COMPARISON_FULL_SEED and GCSP_COMPARISON_FULL_OUT are not all set");
        Path dir = Files.createDirectories(Path.of(out));
        JsonNode experiment = JSON.readTree("{\"experimentId\":\"process-only\",\"seeds\":[" + JSON.writeValueAsString(seed) + "]}");
        ComparisonExperiments.Prepared prepared = ComparisonExperiments.prepare(experiment, POLICY, NOW);
        JsonNode node = prepared.plan().seeds().get(0);
        ComparisonExperiments.Arm arm = prepared.plan().arms().get(0);
        ComparisonInputs inputs = ComparisonInputs.generate(node, prepared.snapshot(), arm.overlay());
        RouteReplay replay = new RouteReplay(schema -> {
            PGSimpleDataSource ds = new PGSimpleDataSource();
            ds.setUrl(url);
            if (schema != null) ds.setCurrentSchema(schema);
            return ds;
        }, null);
        for (String route : new String[] {"current", "buddy"}) {
            long began = System.nanoTime();
            JsonNode record = replay.replay(new ComparisonReplay.Request(arm, route, node, inputs, prepared.snapshot(), POLICY, 1,
                    "full-size"));
            long ms = (System.nanoTime() - began) / 1_000_000;
            JSON.writeValue(dir.resolve(seed + "-" + route + ".json").toFile(), record);
            System.out.println("FULLSIZE " + route + " wall=" + ms + "ms employees=" + inputs.employees().size());
        }
        System.out.println("FULLSIZE evaluateMs=" + RouteReplay.evaluateNanos / 1_000_000);
        System.out.println("FULLSIZE buddy allocations=" + BuddyRoute.allocations.get() + " attemptedContenders=" + BuddyRoute.contenders.get()
                + " allocateMs=" + BuddyRoute.allocateNanos.get() / 1_000_000);
    }
}
