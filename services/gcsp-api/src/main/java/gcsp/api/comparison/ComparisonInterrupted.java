package gcsp.api.comparison;

/** The running thread was interrupted between steps (job limit or shutdown); the caller decides which. */
public final class ComparisonInterrupted extends RuntimeException {

    public ComparisonInterrupted() {
        super("The comparison was interrupted.", null, false, false);
    }
}
