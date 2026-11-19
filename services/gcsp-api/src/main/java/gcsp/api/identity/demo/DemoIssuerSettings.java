package gcsp.api.identity.demo;

import gcsp.api.auth.Role;
import gcsp.api.identity.IdentitySelection;
import gcsp.api.identity.OidcIdentity;
import gcsp.api.scenario.ScenarioProvider;
import io.quarkus.runtime.LaunchMode;
import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Validated settings of the built-in demo sign-in issuer. Switched off unless gcsp.demo-idp.enabled=true, and then
 * only in the one composition it is safe in: oidc identity, demo scenario data, a database, and its own address.
 */
public record DemoIssuerSettings(String issuer, String jwksUri, String audience, String clientId, String scope,
        String roleClaim, Set<String> redirectUris, Set<String> postLogoutRedirectUris, Duration accessTokenLifetime,
        Duration refreshTokenLifetime, boolean refreshTokens) {

    public static final String ISSUER_PATH = "/demo-idp";
    static final String ENABLED = "gcsp.demo-idp.enabled";
    private static final Duration MAX_ACCESS_LIFETIME = Duration.ofHours(24);

    /** An absolute URL under the issuer, such as endpoint("/token"). */
    public String endpoint(String suffix) {
        return issuer + suffix;
    }

    /** Empty when the switch is off or blank; otherwise the validated settings, or IllegalStateException naming the problem. */
    public static Optional<DemoIssuerSettings> fromLookup(Function<String, Optional<String>> lookup, LaunchMode mode,
            boolean persistenceActive, Supplier<List<DemoPerson>> people) {
        String enabled = get(lookup, ENABLED);
        if (enabled.isEmpty() || enabled.equalsIgnoreCase("false")) {
            return Optional.empty();
        }
        if (!enabled.equalsIgnoreCase("true")) {
            throw new IllegalStateException(ENABLED + " must be true or false");
        }
        if (!IdentitySelection.OIDC.equals(get(lookup, "gcsp.identity.provider"))) {
            throw new IllegalStateException(ENABLED + "=true needs gcsp.identity.provider=oidc");
        }
        if (!ScenarioProvider.DEMO.equals(get(lookup, "gcsp.scenario.provider"))) {
            throw new IllegalStateException(ENABLED + "=true needs gcsp.scenario.provider=demo (fictional data only)");
        }
        if (!persistenceActive) {
            throw new IllegalStateException(ENABLED + "=true needs the database configured (the signing key is stored there)");
        }
        String issuer = required(lookup, "gcsp.oidc.issuer");
        URI issuerUri = checkUrl("gcsp.oidc.issuer", issuer, mode);
        if (!ISSUER_PATH.equals(issuerUri.getRawPath()) || issuerUri.getRawQuery() != null) {
            throw new IllegalStateException("gcsp.oidc.issuer must end with exactly " + ISSUER_PATH
                    + " when " + ENABLED + "=true");
        }
        String jwksUri = required(lookup, "gcsp.oidc.jwks-uri");
        if (!jwksUri.equals(issuer + "/jwks")) {
            throw new IllegalStateException("gcsp.oidc.jwks-uri must be " + issuer + "/jwks when " + ENABLED + "=true");
        }
        String clientId = required(lookup, "gcsp.oidc.authorized-party");
        String audience = required(lookup, "gcsp.oidc.audience");
        Set<String> redirects = uriList(lookup, "gcsp.demo-idp.redirect-uris", mode);
        Set<String> logoutRedirects = uriList(lookup, "gcsp.demo-idp.post-logout-redirect-uris", mode);
        Duration access = duration(lookup, "gcsp.demo-idp.access-token-lifetime");
        if (access.compareTo(MAX_ACCESS_LIFETIME) > 0) {
            throw new IllegalStateException("gcsp.demo-idp.access-token-lifetime must be at most 24h");
        }
        Duration refresh = duration(lookup, "gcsp.demo-idp.refresh-token-lifetime");
        String roleClaim = Optional.of(get(lookup, "gcsp.oidc.role-claim")).filter(s -> !s.isEmpty())
                .orElse("realm_access.roles");
        checkPeople(lookup, people.get());
        String refreshSwitch = get(lookup, "gcsp.demo-idp.refresh-tokens");
        if (!refreshSwitch.isEmpty() && !refreshSwitch.equalsIgnoreCase("true") && !refreshSwitch.equalsIgnoreCase("false")) {
            throw new IllegalStateException("gcsp.demo-idp.refresh-tokens must be true or false");
        }
        boolean refreshTokens = !refreshSwitch.equalsIgnoreCase("false");
        return Optional.of(new DemoIssuerSettings(issuer, jwksUri, audience, clientId, scope(lookup), roleClaim,
                redirects, logoutRedirects, access, refresh, refreshTokens));
    }

    /** openid and profile plus every scope the API requires, so granted tokens always satisfy the validator. */
    private static String scope(Function<String, Optional<String>> lookup) {
        Set<String> scopes = new LinkedHashSet<>(List.of("openid", "profile"));
        for (String s : get(lookup, "gcsp.oidc.required-scopes").split("[\\s,]+")) {
            if (!s.isEmpty()) scopes.add(s);
        }
        return String.join(" ", scopes);
    }

    private static void checkPeople(Function<String, Optional<String>> lookup, List<DemoPerson> people) {
        Map<String, OidcIdentity.Account> accounts = OidcIdentity.parseAccounts(required(lookup, "gcsp.oidc.accounts"));
        for (DemoPerson person : people) {
            String at = "gcsp.oidc.accounts entry for demo person " + person.principalId();
            OidcIdentity.Account account = accounts.get(person.principalId());
            if (account == null) {
                throw new IllegalStateException("gcsp.oidc.accounts has no entry with subject " + person.principalId()
                        + " (every demo person needs one)");
            }
            Set<Role> roles = EnumSet.noneOf(Role.class);
            for (String r : person.roles()) {
                roles.add(Role.fromWire(r).orElseThrow(() -> new IllegalStateException(
                        "demo person " + person.principalId() + " has an unknown role")));
            }
            if (!roles.equals(account.roles())) {
                throw new IllegalStateException(at + " must have the roles " + person.roles());
            }
            if (roles.contains(Role.EMPLOYEE) && !person.employeeId().equals(account.employeeId())) {
                throw new IllegalStateException(at + " must have employeeId " + person.employeeId());
            }
        }
    }

    private static Set<String> uriList(Function<String, Optional<String>> lookup, String key, LaunchMode mode) {
        List<String> items = new ArrayList<>();
        for (String s : get(lookup, key).split("[\\s,]+")) {
            if (!s.isEmpty()) items.add(s);
        }
        if (items.isEmpty()) {
            throw new IllegalStateException(key + " is required when " + ENABLED + "=true");
        }
        for (String item : items) {
            checkUrl(key, item, mode);
        }
        return Set.copyOf(items);
    }

    /** An absolute https URL with a host and no fragment; http only on loopback in automated tests. */
    private static URI checkUrl(String key, String value, LaunchMode mode) {
        URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException e) {
            throw new IllegalStateException(key + " has an invalid URL: " + value);
        }
        String host = uri.getHost();
        boolean https = "https".equalsIgnoreCase(uri.getScheme()) && host != null;
        boolean testLoopback = mode == LaunchMode.TEST && "http".equalsIgnoreCase(uri.getScheme())
                && ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host));
        if (!https && !testLoopback) {
            throw new IllegalStateException(key + " must be an absolute https URL: " + value);
        }
        if (uri.getRawFragment() != null) {
            throw new IllegalStateException(key + " must not have a fragment: " + value);
        }
        return uri;
    }

    private static Duration duration(Function<String, Optional<String>> lookup, String key) {
        String v = get(lookup, key);
        Duration d;
        try {
            d = v.matches("\\d+(ms|s|m|h|d)") ? simple(v) : Duration.parse(v);
        } catch (DateTimeParseException | ArithmeticException e) {
            throw new IllegalStateException(key + " is not a duration such as 10m or 12h");
        }
        if (d.isZero() || d.isNegative()) {
            throw new IllegalStateException(key + " must be positive");
        }
        return d;
    }

    private static Duration simple(String v) {
        int n = v.length() - (v.endsWith("ms") ? 2 : 1);
        long amount = Long.parseLong(v.substring(0, n));
        return switch (v.substring(n)) {
            case "ms" -> Duration.ofMillis(amount);
            case "s" -> Duration.ofSeconds(amount);
            case "m" -> Duration.ofMinutes(amount);
            case "h" -> Duration.ofHours(amount);
            default -> Duration.ofDays(amount);
        };
    }

    private static String get(Function<String, Optional<String>> lookup, String key) {
        return lookup.apply(key).map(String::trim).orElse("");
    }

    private static String required(Function<String, Optional<String>> lookup, String key) {
        String v = get(lookup, key);
        if (v.isEmpty()) {
            throw new IllegalStateException(key + " is required when " + ENABLED + "=true");
        }
        return v;
    }
}
