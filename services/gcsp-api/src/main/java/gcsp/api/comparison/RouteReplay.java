package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.refuse;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.policy.PolicyService;
import java.util.function.Function;
import javax.sql.DataSource;

/**
 * The route replay over the Java claims and recommendation services. Each replay runs in its own throwaway schema,
 * made by the supplied factory and dropped before the replay returns, refuses or is interrupted.
 */
public final class RouteReplay implements ComparisonReplay {

    private final Function<String, DataSource> sources;
    private final String policyRunId;
    private String cacheKey;
    private SeedEvaluation cached;

    /** sources yields a DataSource bound to the named schema; policyRunId is the run policy reads use (null: the scratch run). */
    public RouteReplay(Function<String, DataSource> sources, String policyRunId) {
        this.sources = sources;
        this.policyRunId = policyRunId;
    }

    @Override
    public JsonNode replay(Request request) {
        if (Thread.interrupted()) throw new ComparisonInterrupted();
        String route = request.route();
        if ("buddy".equals(route)) throw new ComparisonUnavailable();
        if (!"current".equals(route)) throw refuse("invalid-input", "route");
        PolicyService policy = ReplayPolicy.of(request.policy(), request.pointsMultiplier(), policyRunId);
        SeedEvaluation evaluation = evaluation(request, policy);
        try (ReplayRun run = ReplayRun.open(sources, request, policy, evaluation, route)) {
            ReplaySelection selection = new ReplaySelection(run, evaluation);
            return CurrentRoute.replay(run, evaluation, selection, request.codeRevision());
        }
    }

    // Only the latest seed's evaluation is kept, so memory stays bounded and a second route reuses it.
    private synchronized SeedEvaluation evaluation(Request request, PolicyService policy) {
        String key = request.inputs().manifest().get("inputHash").textValue() + ":" + request.pointsMultiplier();
        if (!key.equals(cacheKey)) {
            cached = null;
            cached = SeedEvaluation.evaluate(request.inputs(), policy);
            cacheKey = key;
        }
        return cached;
    }
}
