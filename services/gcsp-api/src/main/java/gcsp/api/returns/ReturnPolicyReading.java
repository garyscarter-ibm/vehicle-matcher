package gcsp.api.returns;

/** The return policy at one instant and version: the whole set, or unavailable. Never a default. */
public sealed interface ReturnPolicyReading {

    String UNAVAILABLE = "return-policy-unavailable";

    record Ok(ReturnPolicy policy) implements ReturnPolicyReading {}

    record Unavailable(String code, boolean retryable, String reason) implements ReturnPolicyReading {}

    static Unavailable unavailable() {
        return new Unavailable(UNAVAILABLE, true,
                "Return rules are unavailable. Ask the scheme team to check the scheme setup.");
    }
}
