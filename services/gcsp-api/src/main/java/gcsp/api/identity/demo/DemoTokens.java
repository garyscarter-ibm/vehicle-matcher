package gcsp.api.identity.demo;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.NumericDate;
import org.jose4j.lang.JoseException;

/** Mints the demo issuer's RS256 access and id tokens, with the same claim shapes the local mock issuer used. */
public final class DemoTokens {

    static final Duration ID_TOKEN_LIFETIME = Duration.ofSeconds(300);

    private final DemoIssuerSettings settings;
    private final DemoSigningKeys keys;
    private final Clock clock;

    public DemoTokens(DemoIssuerSettings settings, DemoSigningKeys keys, Clock clock) {
        this.settings = settings;
        this.keys = keys;
        this.clock = clock;
    }

    /** The access token for the API: aud is the API audience, azp the browser client, roles at the configured claim. */
    public String accessToken(String subject, List<String> roles) {
        Instant now = clock.instant();
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(settings.issuer());
        claims.setClaim("aud", List.of(settings.audience()));
        claims.setClaim("azp", settings.clientId());
        claims.setClaim("scope", settings.scope());
        claims.setSubject(subject);
        putRoles(claims, settings.roleClaim(), roles);
        stamp(claims, now, settings.accessTokenLifetime());
        claims.setJwtId(UUID.randomUUID().toString());
        return sign(claims);
    }

    /** The id token for the browser client: aud is the client id; nonce only when the request carried one. */
    public String idToken(String subject, String name, String sessionId, Instant authTime, String nonce) {
        JwtClaims claims = new JwtClaims();
        claims.setIssuer(settings.issuer());
        claims.setSubject(subject);
        claims.setAudience(settings.clientId());
        claims.setClaim("azp", settings.clientId());
        stamp(claims, clock.instant(), ID_TOKEN_LIFETIME);
        claims.setClaim("auth_time", authTime.getEpochSecond());
        claims.setClaim("sid", sessionId);
        if (nonce != null && !nonce.isBlank()) {
            claims.setClaim("nonce", nonce);
        }
        claims.setClaim("name", name);
        return sign(claims);
    }

    public long accessTokenExpiresInSeconds() {
        return settings.accessTokenLifetime().toSeconds();
    }

    private static void stamp(JwtClaims claims, Instant now, Duration lifetime) {
        claims.setIssuedAt(NumericDate.fromSeconds(now.getEpochSecond()));
        claims.setExpirationTime(NumericDate.fromSeconds(now.plus(lifetime).getEpochSecond()));
    }

    /** A dotted path such as realm_access.roles nests; a name with a slash (a namespaced URL) is one top-level claim. */
    private static void putRoles(JwtClaims claims, String path, List<String> roles) {
        if (path.contains("/") || !path.contains(".")) {
            claims.setClaim(path, roles);
            return;
        }
        String[] parts = path.split("\\.");
        Object value = roles;
        for (int i = parts.length - 1; i > 0; i--) {
            Map<String, Object> level = new HashMap<>();
            level.put(parts[i], value);
            value = level;
        }
        claims.setClaim(parts[0], value);
    }

    private String sign(JwtClaims claims) {
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(keys.privateKey());
        jws.setKeyIdHeaderValue(keys.kid());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        jws.setHeader("typ", "JWT");
        try {
            return jws.getCompactSerialization();
        } catch (JoseException e) {
            throw new IllegalStateException("A demo sign-in token could not be signed");
        }
    }
}
