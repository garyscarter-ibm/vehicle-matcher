package gcsp.api.supply;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Separate JVM, same PostgreSQL state: no test-runner object or generator cache crosses the restart. */
public final class GeneratedStockRestartProbe {
    public static void main(String[] args) throws Exception {
        var source = SupplyFixture.plain(System.getenv("GCSP_TEST_DATABASE_URL"));
        source.setCurrentSchema(args[0]);
        Path root = Path.of(args[1]);
        Path evidence = root.resolve("server/data/gcsp/vehicle-evidence");
        var policy = new PolicyService(new RetainedFilePolicySource(root.resolve("server/gcsp/policy/seed-v1.json"), List.of()));
        var inputs = new GeneratedStockInputs(evidence.resolve("generate".equals(args[2]) ? "demo-fleet.v1" : "absent"), evidence, root, policy);
        var preparation = new GeneratedStockPreparation(source, SupplyFixture.ENV, inputs);
        var result = preparation.prepare(new RunContext(SupplyFixture.ENV, "run-1", "probe"), "gcsp-policy-v1", SupplyFixture.T0, null, null);
        if (!(result instanceof ClockResult.Ok ok)) throw new AssertionError(result);
        var provider = new GeneratedSupplyProvider(preparation, new DemoSupplyProvider(policy, (run, ids) -> Map.of()));
        var pulled = provider.pull(new PullRequest("run-1", Instant.parse("2028-01-01T00:00:00Z"), "tick", 4, 0,
                "gcsp-policy-v1", List.of(), List.of()));
        if (!(pulled instanceof ProviderResponse.Ok stock)) throw new AssertionError(pulled);
        var output = JsonNodeFactory.instance.objectNode().put("pid", ProcessHandle.current().pid())
                .put("generated", ok.value().path("generated").asBoolean())
                .put("reportDigest", Canonical.digest(ok.value().path("report")))
                .put("rowsDigest", Canonical.digest(preparation.rows("run-1")))
                .put("pullDigest", Canonical.digest(stock.value()));
        var expired = output.putArray("expired");
        provider.expired("run-1").forEach(expired::add);
        System.out.print(output);
    }
}
