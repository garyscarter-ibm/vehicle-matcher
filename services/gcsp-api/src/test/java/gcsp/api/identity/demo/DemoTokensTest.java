package gcsp.api.identity.demo;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;
import gcsp.api.identity.IdentityResult;
import gcsp.api.identity.OidcIdentity;
import gcsp.api.identity.Principal;
import io.quarkus.runtime.LaunchMode;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.JsonWebKeySet;
import org.jose4j.jwt.JwtClaims;
import org.jose4j.jwt.consumer.JwtConsumerBuilder;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** Demo tokens go through the real OidcIdentity validator unchanged: no bypass, no special case. */
class DemoTokensTest {

    private static HttpServer server;
    private static DemoSigningKeys keys;
    private static String jwksUri;

    @BeforeAll
    static void serveKeys() throws Exception {
        keys = DemoSigningKeys.ephemeral();
        byte[] body = keys.jwksJson().getBytes(StandardCharsets.UTF_8);
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/demo-idp/jwks", ex -> {
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.start();
        jwksUri = "http://127.0.0.1:" + server.getAddress().getPort() + "/demo-idp/jwks";
    }

    @AfterAll
    static void stop() {
        server.stop(0);
    }

    private static DemoTokens tokens(Map<String, String> config, DemoSigningKeys signing, Instant at) {
        DemoIssuerSettings settings = DemoIssuerSettings.fromLookup(DemoSupport.lookup(config), LaunchMode.NORMAL, true,
                () -> DemoSupport.PEOPLE).orElseThrow();
        return new DemoTokens(settings, signing, Clock.fixed(at, ZoneOffset.UTC));
    }

    /** The real validator, pointed at the loopback JWKS, configured from the same map the issuer used. */
    private static OidcIdentity validator(Map<String, String> config) {
        Map<String, String> m = new HashMap<>(config);
        m.put("gcsp.oidc.jwks-uri", jwksUri);
        m.put("gcsp.environment.id", "env");
        m.put("gcsp.environment.run-id", "run");
        m.put("gcsp.environment.policy-version", "pv");
        return OidcIdentity.fromLookup(k -> Optional.ofNullable(m.get(k)), LaunchMode.TEST);
    }

    private static Principal resolved(IdentityResult result) {
        return assertInstanceOf(IdentityResult.Resolved.class, result).principal();
    }

    private static DemoPerson person(String principalId) {
        return DemoSupport.PEOPLE.stream().filter(p -> p.principalId().equals(principalId)).findFirst().orElseThrow();
    }

    private static String access(DemoTokens tokens, String principalId) {
        DemoPerson p = person(principalId);
        return tokens.accessToken(p.principalId(), p.roles());
    }

    @Test
    void mintedAccessTokensResolveToTheRightPeople() {
        Map<String, String> cfg = DemoSupport.valid();
        DemoTokens tokens = tokens(cfg, keys, Instant.now());
        OidcIdentity validator = validator(cfg);

        Principal paula = resolved(validator.resolve(access(tokens, "demo-paula")));
        assertEquals("demo-paula", paula.subject());
        assertEquals(List.of("employee"), paula.roles());
        assertEquals("employee-paula", paula.employeeId());

        Principal greg = resolved(validator.resolve(access(tokens, "demo-greg")));
        assertTrue(greg.roles().containsAll(List.of("greg", "employee")), greg.roles().toString());
        assertEquals("operator-greg", greg.employeeId());

        Principal presenter = resolved(validator.resolve(access(tokens, "demo-presenter")));
        assertEquals(List.of("presenter"), presenter.roles());
        assertNull(presenter.employeeId());
    }

    @Test
    void anExpiredTokenIsRefused() {
        Map<String, String> cfg = DemoSupport.valid();
        DemoTokens old = tokens(cfg, keys, Instant.now().minus(Duration.ofHours(2)));
        assertEquals(new IdentityResult.Rejected("token-expired"), validator(cfg).resolve(access(old, "demo-paula")));
    }

    @Test
    void aWrongAudienceOrClientIsRefused() {
        Map<String, String> cfg = DemoSupport.valid();
        String token = access(tokens(cfg, keys, Instant.now()), "demo-paula");

        Map<String, String> otherAudience = new HashMap<>(cfg);
        otherAudience.put("gcsp.oidc.audience", "another-api");
        assertEquals(new IdentityResult.Rejected("token-audience-invalid"), validator(otherAudience).resolve(token));

        Map<String, String> otherClient = new HashMap<>(cfg);
        otherClient.put("gcsp.oidc.authorized-party", "another-client");
        assertEquals(new IdentityResult.Rejected("token-client-invalid"), validator(otherClient).resolve(token));
    }

    @Test
    void aTokenSignedByAnotherKeyIsRefused() {
        Map<String, String> cfg = DemoSupport.valid();
        String forged = access(tokens(cfg, DemoSigningKeys.ephemeral(), Instant.now()), "demo-greg");
        assertEquals(new IdentityResult.Rejected("token-signature-invalid"), validator(cfg).resolve(forged));
    }

    @Test
    void rolesAreWrittenAtTheConfiguredClaim() {
        for (String claim : new String[] {"roles", "a.b.roles", "https://demo.example.test/roles"}) {
            Map<String, String> cfg = DemoSupport.valid();
            cfg.put("gcsp.oidc.role-claim", claim);
            String token = access(tokens(cfg, keys, Instant.now()), "demo-paula");
            assertEquals(List.of("employee"), resolved(validator(cfg).resolve(token)).roles(), claim);
        }
    }

    @Test
    void theIdTokenCarriesTheBrowserClientsClaims() throws Exception {
        Map<String, String> cfg = DemoSupport.valid();
        Instant now = Instant.now();
        DemoTokens tokens = tokens(cfg, keys, now);
        Instant authTime = now.minusSeconds(30);
        JsonWebKey key = new JsonWebKeySet(keys.jwksJson()).getJsonWebKeys().get(0);
        assertEquals("RS256", key.getAlgorithm());
        assertEquals("sig", key.getUse());
        assertEquals(keys.kid(), key.getKeyId());

        String token = tokens.idToken("demo-paula", "Paula Mason", "sid-1", authTime, "n-0S6");
        JwtClaims claims = new JwtConsumerBuilder().setVerificationKey(key.getKey())
                .setExpectedIssuer(DemoSupport.ISSUER).setExpectedAudience("gcsp-web")
                .setEvaluationTime(org.jose4j.jwt.NumericDate.fromSeconds(now.getEpochSecond()))
                .setRequireExpirationTime().build().processToClaims(token);
        assertEquals("demo-paula", claims.getSubject());
        assertEquals("gcsp-web", claims.getClaimValue("azp"));
        assertEquals("sid-1", claims.getClaimValue("sid"));
        assertEquals("n-0S6", claims.getClaimValue("nonce"));
        assertEquals("Paula Mason", claims.getClaimValue("name"));
        assertEquals(authTime.getEpochSecond(), ((Number) claims.getClaimValue("auth_time")).longValue());
        assertEquals(300, claims.getExpirationTime().getValue() - claims.getIssuedAt().getValue());

        JwtClaims noNonce = new JwtConsumerBuilder().setVerificationKey(key.getKey()).setSkipDefaultAudienceValidation()
                .build().processToClaims(tokens.idToken("demo-paula", "Paula Mason", "sid-1", authTime, null));
        assertNull(noNonce.getClaimValue("nonce"));
    }
}
