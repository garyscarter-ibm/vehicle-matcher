package gcsp.api.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.JwksServerResource;
import io.quarkus.runtime.LaunchMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The unknown-kid refetch window on a controllable clock, past the 30 s a @QuarkusTest can afford to wait. */
class OidcJwksRefetchTest {

    private static final String ISSUER = "https://issuer.test/realms/gcsp";
    private final JwksServerResource jwks = new JwksServerResource();
    private final HttpClient http = HttpClient.newHttpClient();
    private final AtomicLong clock = new AtomicLong(1_000_000_000L);
    private Map<String, String> served;
    private OidcIdentity identity;
    private RsaJsonWebKey key;
    private final RsaJsonWebKey forger;

    OidcJwksRefetchTest() throws Exception {
        forger = RsaJwkGenerator.generateJwk(2048);
    }

    @BeforeEach
    void start() throws Exception {
        served = jwks.start();
        key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(served.get("gcsp.test.signing-jwk"));
        Map<String, String> cfg = new HashMap<>(Map.of(
                "gcsp.oidc.issuer", ISSUER,
                "gcsp.oidc.jwks-uri", served.get("gcsp.oidc.jwks-uri"),
                "gcsp.oidc.audience", "gcsp-api",
                "gcsp.oidc.required-scopes", "gcsp-api",
                "gcsp.oidc.accounts", "[{\"subject\":\"sub-a\",\"roles\":[\"employee\"],\"employeeId\":\"E-1\"}]",
                "gcsp.environment.id", "isolated-dev",
                "gcsp.environment.run-id", "test-run-1",
                "gcsp.environment.policy-version", "test-policy-1"));
        identity = OidcIdentity.fromLookup(k -> Optional.ofNullable(cfg.get(k)), LaunchMode.TEST, clock::get);
    }

    @AfterEach
    void stop() {
        jwks.stop();
    }

    private int control(String action) throws Exception {
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(
                URI.create(served.get("gcsp.test.jwks-control") + "/" + action)).build(),
                HttpResponse.BodyHandlers.ofString());
        return Integer.parseInt(r.body().trim());
    }

    private static String sign(RsaJsonWebKey signer, String kid) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(ISSUER);
        c.setAudience("gcsp-api");
        c.setSubject("sub-a");
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of("employee")));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(signer.getPrivateKey());
        jws.setKeyIdHeaderValue(kid);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private IdentityResult forged() throws Exception {
        return identity.resolve(sign(forger, UUID.randomUUID().toString()));
    }

    private void advance(long seconds) {
        clock.addAndGet(TimeUnit.SECONDS.toNanos(seconds));
    }

    @Test
    void unknownKidsRefetchOncePerWindowAndStay401WhileTheJwksIsDown() throws Exception {
        assertInstanceOf(IdentityResult.Resolved.class, identity.resolve(sign(key, key.getKeyId())));
        Thread.sleep(400); // past jose4j's own 300 ms refresh guard
        int loaded = control("fetches");

        assertEquals(new IdentityResult.Rejected("token-signature-invalid"), forged());
        assertEquals(loaded + 1, control("fetches"), "first unknown kid refetches");
        advance(29);
        assertEquals(new IdentityResult.Rejected("token-signature-invalid"), forged());
        assertEquals(loaded + 1, control("fetches"), "inside the window: no refetch");

        advance(2);
        Thread.sleep(400);
        control("down");
        assertEquals(new IdentityResult.Rejected("token-signature-invalid"), forged(), "401, not 503");
        int attempted = control("fetches"); // jose4j's Get retries a failed fetch, so one refetch is a few requests
        assertTrue(attempted > loaded + 1, "one refetch attempt in the new window");
        assertEquals(new IdentityResult.Rejected("token-signature-invalid"), forged());
        assertEquals(attempted, control("fetches"), "a failed attempt still spends the window");
        assertInstanceOf(IdentityResult.Resolved.class, identity.resolve(sign(key, key.getKeyId())),
                "cached keys still verify while the JWKS is down");
    }
}
