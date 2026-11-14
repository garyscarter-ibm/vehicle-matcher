package gcsp.api.claims;

/** Thrown inside a claim transaction to roll it back and answer with this result (the runner rethrows it). */
final class Refusal extends RuntimeException {

    private final transient ClaimResult result;

    Refusal(ClaimResult result) {
        super(result.code(), null, false, false);
        this.result = result;
    }

    ClaimResult result() {
        return result;
    }
}
