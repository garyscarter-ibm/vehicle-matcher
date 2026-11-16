package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** Default replay: honestly unavailable, never a fake record. Any other ComparisonReplay bean replaces it. */
@DefaultBean
@ApplicationScoped
public class UnavailableComparisonReplay implements ComparisonReplay {

    @Override
    public JsonNode replay(Request request) {
        throw new ComparisonUnavailable();
    }
}
