package gcsp.api.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.auth.Role;
import io.quarkus.runtime.LaunchMode;
import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.Base64;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import org.eclipse.microprofile.config.Config;
import org.jboss.logging.Logger;
import org.jose4j.http.Get;
import org.jose4j.jwa.AlgorithmConstraints;
import org.jose4j.jwk.HttpsJwks;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.consumer.ErrorCodes;
import org.jose4j.jwt.consumer.InvalidJwtException;
import org.jose4j.jwt.consumer.JwtConsumer;
import org.jose4j.jwt.consumer.JwtConsumerBuilder;
import org.jose4j.keys.resolvers.HttpsJwksVerificationKeyResolver;
import org.jose4j.lang.UnresolvableKeyException;

/**
 * Validates a bearer access JWT against the issuer's JWKS and maps issuer subject to a
 * deployment-supplied account. Nothing but the JWKS key set is cached; every call revalidates.
 */
public final class OidcIdentity implements IdentityPort {

    private static final Logger LOG = Logger.getLogger(OidcIdentity.class);
    private static final String[] ALGORITHMS = {"RS256", "RS384", "RS512", "PS256", "PS384", "PS512",
            "ES256", "ES384", "ES512"};
    private static final Set<String> ALGORITHM_SET = Set.of(ALGORITHMS);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int JWKS_TIMEOUT_MS = 2000;

    record Account(String subject, Set<Role> roles, String employeeId) {}

    private final String authorizedParty;
    private final List<String> requiredScopes;
    private final String roleClaim;
    private final Map<String, Account> accounts;
    private final String environmentId;
    private final String runId;
    private final String policyVersion;
    private final JwtConsumer consumer;

    private OidcIdentity(Function<String, Optional<String>> cfg, LaunchMode mode) {
        String issuer = required(cfg, "gcsp.oidc.issuer");
        String jwksUri = required(cfg, "gcsp.oidc.jwks-uri");
        String audience = required(cfg, "gcsp.oidc.audience");
        checkJwksUri(jwksUri, mode);
        this.authorizedParty = cfg.apply("gcsp.oidc.authorized-party").map(String::trim).orElse(null);
        this.requiredScopes = cfg.apply("gcsp.oidc.required-scopes")
                .map(v -> List.of(v.trim().split("[\\s,]+"))).orElse(List.<String>of()).stream()
                .filter(s -> !s.isEmpty()).toList();
        this.roleClaim = cfg.apply("gcsp.oidc.role-claim").map(String::trim).filter(s -> !s.isEmpty())
                .orElse("realm_access.roles");
        this.accounts = parseAccounts(required(cfg, "gcsp.oidc.accounts"));
        this.environmentId = required(cfg, "gcsp.environment.id");
        this.runId = required(cfg, "gcsp.environment.run-id");
        this.policyVersion = required(cfg, "gcsp.environment.policy-version");

        Get get = new Get();
        get.setConnectTimeout(JWKS_TIMEOUT_MS);
        get.setReadTimeout(JWKS_TIMEOUT_MS);
        HttpsJwks jwks = new HttpsJwks(jwksUri);
        jwks.setSimpleHttpGet(get);
        this.consumer = new JwtConsumerBuilder()
                .setVerificationKeyResolver(new HttpsJwksVerificationKeyResolver(jwks))
                .setJwsAlgorithmConstraints(AlgorithmConstraints.ConstraintType.PERMIT, ALGORITHMS)
                .setRequireExpirationTime()
                .setRequireSubject()
                .setExpectedIssuer(true, issuer)
                .setExpectedAudience(true, audience)
                .setAllowedClockSkewInSeconds(30)
                .setMaxFutureValidityInMinutes(1440)
                .build();
    }

    /** Builds the port from MicroProfile config; throws IllegalStateException naming the bad key. */
    public static OidcIdentity fromConfig(Config config, LaunchMode mode) {
        return fromLookup(config == null ? k -> Optional.empty() : k -> config.getOptionalValue(k, String.class),
                mode);
    }

    /** Same as {@link #fromConfig} over any key lookup, so refusals are unit-testable without Quarkus. */
    public static OidcIdentity fromLookup(Function<String, Optional<String>> lookup, LaunchMode mode) {
        return new OidcIdentity(lookup, mode);
    }

    @Override
    public String mode() {
        return IdentitySelection.OIDC;
    }

    @Override
    public IdentityResult resolve(String bearerToken) {
        IdentityResult result = validate(bearerToken);
        if (!(result instanceof IdentityResult.Resolved)) {
            LOG.debugf("Token refused: %s", result);
        }
        return result;
    }

    private IdentityResult validate(String token) {
        IdentityResult early = checkHeader(token);
        if (early != null) {
            return early;
        }
        JwtClaims claims;
        try {
            claims = consumer.processToClaims(token);
        } catch (InvalidJwtException e) {
            return map(e);
        } catch (RuntimeException e) {
            return new IdentityResult.Rejected("token-invalid");
        }
        try {
            return authorize(claims);
        } catch (org.jose4j.jwt.MalformedClaimException e) {
            return new IdentityResult.Rejected("token-invalid");
        }
    }

    private static IdentityResult checkHeader(String token) {
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3 || parts[0].isEmpty() || parts[1].isEmpty()) {
            return new IdentityResult.Rejected("token-malformed");
        }
        try {
            JsonNode header = JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
            JsonNode alg = header == null ? null : header.get("alg");
            if (alg == null || !alg.isTextual()) {
                return new IdentityResult.Rejected("token-malformed");
            }
            if (!ALGORITHM_SET.contains(alg.asText())) {
                return new IdentityResult.Rejected("token-algorithm-unsupported");
            }
        } catch (IllegalArgumentException | IOException e) {
            return new IdentityResult.Rejected("token-malformed");
        }
        return null;
    }

    private static IdentityResult map(InvalidJwtException e) {
        if (causedBy(e, IOException.class)) {
            return new IdentityResult.Unavailable("identity-keys-unavailable", true);
        }
        if (e.hasErrorCode(ErrorCodes.SIGNATURE_INVALID) || e.hasErrorCode(ErrorCodes.SIGNATURE_MISSING)
                || causedBy(e, UnresolvableKeyException.class)) {
            return new IdentityResult.Rejected("token-signature-invalid");
        }
        if (e.hasErrorCode(ErrorCodes.ISSUER_INVALID) || e.hasErrorCode(ErrorCodes.ISSUER_MISSING)) {
            return new IdentityResult.Rejected("token-issuer-invalid");
        }
        if (e.hasErrorCode(ErrorCodes.AUDIENCE_INVALID) || e.hasErrorCode(ErrorCodes.AUDIENCE_MISSING)) {
            return new IdentityResult.Rejected("token-audience-invalid");
        }
        if (e.hasExpired()) {
            return new IdentityResult.Rejected("token-expired");
        }
        if (e.hasErrorCode(ErrorCodes.NOT_YET_VALID)) {
            return new IdentityResult.Rejected("token-not-yet-valid");
        }
        if (e.hasErrorCode(ErrorCodes.EXPIRATION_MISSING) || e.hasErrorCode(ErrorCodes.EXPIRATION_TOO_FAR_IN_FUTURE)) {
            return new IdentityResult.Rejected("token-lifetime-invalid");
        }
        if (e.hasErrorCode(ErrorCodes.SUBJECT_MISSING)) {
            return new IdentityResult.Rejected("token-subject-missing");
        }
        return new IdentityResult.Rejected("token-invalid");
    }

    private static boolean causedBy(Throwable e, Class<? extends Throwable> type) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (type.isInstance(t)) {
                return true;
            }
        }
        return false;
    }

    private IdentityResult authorize(JwtClaims claims) throws org.jose4j.jwt.MalformedClaimException {
        if (authorizedParty != null && !authorizedParty.equals(claims.getClaimValue("azp"))) {
            return new IdentityResult.Rejected("token-client-invalid");
        }
        if (!requiredScopes.isEmpty()) {
            Object scope = claims.getClaimValue("scope");
            Set<String> granted = scope instanceof String s ? Set.of(s.trim().split("\\s+")) : Set.of();
            if (!granted.containsAll(requiredScopes)) {
                return new IdentityResult.Unmapped("scope-missing");
            }
        }
        Set<Role> claimed = claimedRoles(claims.getClaimsMap(), roleClaim);
        if (claimed.isEmpty()) {
            return new IdentityResult.Unmapped("role-missing");
        }
        String subject = claims.getSubject();
        Account account = accounts.get(subject);
        if (account == null) {
            return new IdentityResult.Unmapped("subject-not-mapped");
        }
        EnumSet<Role> effective = EnumSet.noneOf(Role.class);
        for (Role r : claimed) {
            if (account.roles().contains(r)) {
                effective.add(r);
            }
        }
        if (effective.isEmpty()) {
            return new IdentityResult.Unmapped("role-not-granted");
        }
        if (effective.contains(Role.PRESENTER) && effective.size() > 1) {
            return new IdentityResult.Unmapped("role-conflict");
        }
        List<String> roles = new ArrayList<>();
        List<String> capabilities = new ArrayList<>();
        for (Role r : effective) {
            roles.add(r.wire());
            capabilities.addAll(r.capabilities());
        }
        String employeeId = effective.contains(Role.EMPLOYEE) ? account.employeeId() : null;
        return new IdentityResult.Resolved(new Principal(subject, roles, environmentId, runId, employeeId,
                policyVersion, capabilities));
    }

    /** Known roles at the claim: an exact top-level name (e.g. a namespaced URL) wins, else a dot path. */
    public static Set<Role> claimedRoles(Map<String, Object> claims, String roleClaim) {
        Object node = claims.get(roleClaim);
        if (node == null) {
            node = claims;
            for (String key : roleClaim.split("\\.")) {
                if (!(node instanceof Map<?, ?> m)) {
                    return Set.of();
                }
                node = m.get(key);
            }
        }
        List<?> values = node instanceof String s ? List.of(s) : node instanceof List<?> l ? l : List.of();
        Set<Role> found = EnumSet.noneOf(Role.class);
        for (Object v : values) {
            if (v instanceof String s) {
                Role.fromWire(s).ifPresent(found::add);
            }
        }
        return found;
    }

    private static String required(Function<String, Optional<String>> cfg, String key) {
        return cfg.apply(key).map(String::trim).filter(s -> !s.isEmpty()).orElseThrow(
                () -> new IllegalStateException(key + " is required for gcsp.identity.provider=oidc"));
    }

    private static void checkJwksUri(String value, LaunchMode mode) {
        URI uri;
        try {
            uri = URI.create(value);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("gcsp.oidc.jwks-uri is not a valid URI");
        }
        String host = uri.getHost();
        boolean https = "https".equalsIgnoreCase(uri.getScheme()) && host != null;
        boolean testLoopback = mode == LaunchMode.TEST && "http".equalsIgnoreCase(uri.getScheme())
                && ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host));
        if (!https && !testLoopback) {
            throw new IllegalStateException("gcsp.oidc.jwks-uri must be an https URL");
        }
    }

    private static Role unknownRole(String at) {
        throw new IllegalStateException(at + " has an unknown role");
    }

    static Map<String, Account> parseAccounts(String json) {
        final String key = "gcsp.oidc.accounts";
        JsonNode root;
        try {
            root = JSON.readTree(json);
        } catch (IOException e) {
            throw new IllegalStateException(key + " is not valid JSON");
        }
        if (root == null || !root.isArray() || root.isEmpty()) {
            throw new IllegalStateException(key + " must be a non-empty JSON array");
        }
        Map<String, Account> out = new HashMap<>();
        int index = 0;
        for (JsonNode n : root) {
            String at = key + " entry " + index++;
            if (!n.isObject()) {
                throw new IllegalStateException(at + " must be an object");
            }
            JsonNode sub = n.get("subject");
            if (sub == null || !sub.isTextual() || sub.asText().isBlank()) {
                throw new IllegalStateException(at + " needs a non-blank subject");
            }
            JsonNode rolesNode = n.get("roles");
            if (rolesNode == null || !rolesNode.isArray() || rolesNode.isEmpty()) {
                throw new IllegalStateException(at + " needs a non-empty roles list");
            }
            Set<Role> roles = EnumSet.noneOf(Role.class);
            for (JsonNode r : rolesNode) {
                roles.add(r.isTextual() ? Role.fromWire(r.asText()).orElseThrow(
                        () -> new IllegalStateException(at + " has an unknown role"))
                        : unknownRole(at));
            }
            if (roles.contains(Role.PRESENTER) && roles.size() > 1) {
                throw new IllegalStateException(at + " combines presenter with another role");
            }
            JsonNode emp = n.get("employeeId");
            boolean hasEmp = emp != null && !emp.isNull();
            if (roles.contains(Role.EMPLOYEE) && (!hasEmp || !emp.isTextual() || emp.asText().isBlank())) {
                throw new IllegalStateException(at + " has the employee role without an employeeId");
            }
            if (!roles.contains(Role.EMPLOYEE) && hasEmp) {
                throw new IllegalStateException(at + " has an employeeId without the employee role");
            }
            String subject = sub.asText();
            if (out.put(subject, new Account(subject, roles, hasEmp ? emp.asText() : null)) != null) {
                throw new IllegalStateException(key + " has a duplicate subject");
            }
        }
        return out;
    }
}
