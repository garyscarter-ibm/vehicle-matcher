package gcsp.api.recommendation;

/** Thrown where the Node recommendation code throws a TypeError; callers turn it into "unavailable". */
public final class RecommendationFault extends RuntimeException {

    public RecommendationFault(String message) {
        super(message);
    }
}
