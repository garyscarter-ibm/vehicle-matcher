package gcsp.api.allocation;

import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** No recommendation engine is bound: allocation refuses rather than inventing eligibility. */
@DefaultBean
@ApplicationScoped
public class UnconfiguredCandidates implements EligibleCandidates {

    @Override
    public Result evaluate(Request request) {
        return new Unavailable("recommendation-unavailable");
    }
}
