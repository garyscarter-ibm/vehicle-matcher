package gcsp.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.auth.Role;
import gcsp.api.identity.IdentityResult;
import gcsp.api.identity.OidcIdentity;
import io.quarkus.runtime.LaunchMode;
import java.net.ServerSocket;
import java.util.HashMap;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.Optional;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jwk.RsaJwkGenerator;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

/** Startup refusals and the key-source outage path, without Quarkus. */
class OidcIdentityTest {

    private static final String ACCOUNTS = "[{\"subject\":\"s1\",\"roles\":[\"employee\"],\"employeeId\":\"E-1\"}]";

    private static Map<String, String> valid() {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.oidc.issuer", "https://issuer.test/realms/gcsp");
        m.put("gcsp.oidc.jwks-uri", "https://issuer.test/jwks");
        m.put("gcsp.oidc.audience", "gcsp-api");
        m.put("gcsp.oidc.accounts", ACCOUNTS);
        m.put("gcsp.environment.id", "env");
        m.put("gcsp.environment.run-id", "run");
        m.put("gcsp.environment.policy-version", "pv");
        return m;
    }

    private static OidcIdentity build(Map<String, String> m, LaunchMode mode) {
        return OidcIdentity.fromLookup(k -> Optional.ofNullable(m.get(k)), mode);
    }

    private static String refusal(Map<String, String> m) {
        return assertThrows(IllegalStateException.class, () -> build(m, LaunchMode.NORMAL)).getMessage();
    }

    private static Map<String, String> with(String key, String value) {
        Map<String, String> m = valid();
        m.put(key, value);
        return m;
    }

    @Test
    void validConfigurationStarts() {
        assertEquals("oidc", build(valid(), LaunchMode.NORMAL).mode());
    }

    @Test
    void missingRequiredKeysStopStartupNamingTheKey() {
        for (String key : valid().keySet()) {
            Map<String, String> m = valid();
            m.remove(key);
            assertTrue(refusal(m).contains(key), key);
            assertTrue(refusal(with(key, "  ")).contains(key), key);
        }
    }

    @Test
    void invalidAccountsStopStartup() {
        String[] bad = {
            "not json",
            "[]",
            "{}",
            "[{\"subject\":\"a\",\"roles\":[\"greg\"]},{\"subject\":\"a\",\"roles\":[\"greg\"]}]",
            "[{\"subject\":\" \",\"roles\":[\"greg\"]}]",
            "[{\"roles\":[\"greg\"]}]",
            "[{\"subject\":\"a\",\"roles\":[\"admin\"]}]",
            "[{\"subject\":\"a\",\"roles\":[]}]",
            "[{\"subject\":\"a\"}]",
            "[{\"subject\":\"a\",\"roles\":[\"presenter\",\"greg\"]}]",
            "[{\"subject\":\"a\",\"roles\":[\"presenter\",\"employee\"],\"employeeId\":\"E-1\"}]",
            "[{\"subject\":\"a\",\"roles\":[\"employee\"]}]",
            "[{\"subject\":\"a\",\"roles\":[\"employee\"],\"employeeId\":\" \"}]",
            "[{\"subject\":\"a\",\"roles\":[\"greg\"],\"employeeId\":\"E-1\"}]",
        };
        for (String accounts : bad) {
            assertTrue(refusal(with("gcsp.oidc.accounts", accounts)).contains("gcsp.oidc.accounts"), accounts);
        }
    }

    @Test
    void jwksUriMustBeHttpsExceptLoopbackInTestMode() {
        assertTrue(refusal(with("gcsp.oidc.jwks-uri", "http://issuer.test/jwks")).contains("https"));
        assertTrue(refusal(with("gcsp.oidc.jwks-uri", "http://127.0.0.1:9/jwks")).contains("https"));
        assertThrows(IllegalStateException.class,
                () -> build(with("gcsp.oidc.jwks-uri", "http://issuer.test/jwks"), LaunchMode.TEST));
        assertEquals("oidc", build(with("gcsp.oidc.jwks-uri", "http://127.0.0.1:9/jwks"), LaunchMode.TEST).mode());
        assertEquals("oidc", build(with("gcsp.oidc.jwks-uri", "http://localhost:9/jwks"), LaunchMode.TEST).mode());
    }

    @Test
    void unreachableKeySetIsRetryableUnavailable() throws Exception {
        int closedPort;
        try (ServerSocket s = new ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())) {
            closedPort = s.getLocalPort();
        }
        OidcIdentity port = build(with("gcsp.oidc.jwks-uri", "http://127.0.0.1:" + closedPort + "/jwks"),
                LaunchMode.TEST);
        RsaJsonWebKey key = RsaJwkGenerator.generateJwk(2048);
        key.setKeyId("k");
        JwtClaims c = new JwtClaims();
        c.setIssuer("https://issuer.test/realms/gcsp");
        c.setAudience("gcsp-api");
        c.setSubject("s1");
        c.setExpirationTimeMinutesInTheFuture(5);
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("k");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        IdentityResult r = port.resolve(jws.getCompactSerialization());
        IdentityResult.Unavailable u = assertInstanceOf(IdentityResult.Unavailable.class, r);
        assertEquals("identity-keys-unavailable", u.code());
        assertTrue(u.retryable());
    }

    @Test
    void roleClaimIsExactNameOrDotPath() {
        Map<String, Object> claims = Map.of(
                "https://gcsp.test/roles", List.of("greg", "other"),
                "realm_access", Map.of("roles", List.of("employee")),
                "flat", "presenter");
        assertEquals(Set.of(Role.GREG), OidcIdentity.claimedRoles(claims, "https://gcsp.test/roles"));
        assertEquals(Set.of(Role.EMPLOYEE), OidcIdentity.claimedRoles(claims, "realm_access.roles"));
        assertEquals(Set.of(Role.PRESENTER), OidcIdentity.claimedRoles(claims, "flat"));
        assertEquals(Set.of(), OidcIdentity.claimedRoles(claims, "realm_access.missing"));
        assertEquals(Set.of(), OidcIdentity.claimedRoles(Map.of("roles", List.of(1, 2)), "roles"));
    }
}
