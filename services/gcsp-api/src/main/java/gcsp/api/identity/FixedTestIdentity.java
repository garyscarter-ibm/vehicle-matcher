package gcsp.api.identity;

import java.util.List;
import java.util.Objects;

/**
 * Test-only port: one configured token maps to one configured principal, and a second token
 * is a valid-but-unmapped subject. {@link IdentitySelection} refuses it outside test launch mode.
 */
public final class FixedTestIdentity implements IdentityPort {

    private final String token;
    private final String unmappedToken;
    private final Principal principal;

    public FixedTestIdentity(String token, String unmappedToken, Principal principal) {
        this.token = requireText(token, "gcsp.identity.fixed-test.token");
        this.unmappedToken = unmappedToken;
        this.principal = Objects.requireNonNull(principal);
    }

    @Override
    public String mode() {
        return IdentitySelection.FIXED_TEST;
    }

    @Override
    public IdentityResult resolve(String bearerToken) {
        if (token.equals(bearerToken)) {
            return new IdentityResult.Resolved(principal);
        }
        if (unmappedToken != null && unmappedToken.equals(bearerToken)) {
            return new IdentityResult.Unmapped("subject-not-mapped");
        }
        return new IdentityResult.Rejected("bearer-invalid");
    }

    static List<String> list(String csv) {
        return csv == null || csv.isBlank() ? List.of()
                : List.of(csv.split(",")).stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    private static String requireText(String value, String key) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(key + " is required for the fixed-test identity port");
        }
        return value;
    }
}
