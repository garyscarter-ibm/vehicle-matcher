package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;

/** A replay that always throws ComparisonUnavailable, for the runner's refusal test. Not a bean. */
final class UnavailableComparisonReplay implements ComparisonReplay {

    @Override
    public JsonNode replay(Request request) {
        throw new ComparisonUnavailable();
    }
}
