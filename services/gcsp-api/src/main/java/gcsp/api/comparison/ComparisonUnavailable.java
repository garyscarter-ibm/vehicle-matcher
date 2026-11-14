package gcsp.api.comparison;

import java.util.List;

/** The route replay is not wired in this service yet; the reason and the missing bindings are fixed text. */
public final class ComparisonUnavailable extends RuntimeException {

    public static final String REASON = "The route replay is not available in this service yet.";
    public static final List<String> BINDINGS = List.of("allocation (FUCQ-464)", "recommendation (FUCQ-461)");

    public ComparisonUnavailable() {
        super(REASON, null, false, false);
    }

    public String reason() {
        return REASON;
    }

    public List<String> bindings() {
        return BINDINGS;
    }
}
