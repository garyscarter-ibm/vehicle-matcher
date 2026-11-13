package gcsp.api.identity;

/** Outcome of resolving a bearer token; each variant maps to one typed HTTP refusal. */
public sealed interface IdentityResult {

    record Resolved(Principal principal) implements IdentityResult {}

    /** Signature, issuer, audience or lifetime failed (HTTP 401). */
    record Rejected(String code) implements IdentityResult {}

    /** Valid token whose issuer/subject has no trusted mapping (HTTP 403). */
    record Unmapped(String code) implements IdentityResult {}

    /** No usable identity provider or key source (HTTP 503). */
    record Unavailable(String code, boolean retryable) implements IdentityResult {}
}
