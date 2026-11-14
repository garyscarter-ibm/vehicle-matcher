package gcsp.api.cases;

import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Real OIDC over the in-test JWKS server and the shared test database; every identity is synthetic. */
public class CaseHttpProfile implements QuarkusTestProfile {

    static final String ISSUER = "https://issuer.test/realms/gcsp";
    static final String AUDIENCE = "gcsp-api";
    static final String CLIENT = "gcsp-web";
    static final String URL = System.getenv("GCSP_TEST_DATABASE_URL");
    // Unique per JVM so reruns on the shared database see no old rows; a system property, because Quarkus
    // and the test load this class separately.
    static final String TAG = (String) System.getProperties().computeIfAbsent("gcsp.test.case-http-tag",
            k -> Long.toHexString(System.nanoTime()));
    static final String EMPLOYEE_A = "case-a-" + TAG;
    static final String EMPLOYEE_B = "case-b-" + TAG;
    static final String SUB_A = "sub-case-a";
    static final String SUB_B = "sub-case-b";
    static final String SUB_GREG = "sub-greg";
    static final String SUB_PRESENTER = "sub-presenter";
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"" + SUB_A + "\",\"roles\":[\"employee\"],\"employeeId\":\"" + EMPLOYEE_A + "\"},"
            + "{\"subject\":\"" + SUB_B + "\",\"roles\":[\"employee\"],\"employeeId\":\"" + EMPLOYEE_B + "\"},"
            + "{\"subject\":\"" + SUB_GREG + "\",\"roles\":[\"greg\"]},"
            + "{\"subject\":\"" + SUB_PRESENTER + "\",\"roles\":[\"presenter\"]}]";

    /** The identity and environment both profiles share. */
    static Map<String, String> identity() {
        Map<String, String> m = new HashMap<>();
        m.put("gcsp.identity.provider", "oidc");
        m.put("gcsp.oidc.issuer", ISSUER);
        m.put("gcsp.oidc.audience", AUDIENCE);
        m.put("gcsp.oidc.authorized-party", CLIENT);
        m.put("gcsp.oidc.required-scopes", "gcsp-api");
        m.put("gcsp.oidc.accounts", ACCOUNTS);
        m.put("gcsp.environment.id", "test-app-env");
        m.put("gcsp.environment.run-id", "run-1");
        m.put("gcsp.environment.policy-version", "gcsp-policy-v1");
        return m;
    }

    static Map<String, String> noDatabase(Map<String, String> m) {
        m.put("quarkus.datasource.active", "false");
        m.put("quarkus.flyway.active", "false");
        return m;
    }

    /** A bearer token for one identity, signed with the key the in-test JWKS server publishes. */
    static String bearer(String signingJwk, String subject, String... roles) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(ISSUER);
        c.setAudience(AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(roles)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    @Override
    public Map<String, String> getConfigOverrides() {
        Map<String, String> m = identity();
        if (URL == null || URL.isBlank()) return noDatabase(m);
        m.put("quarkus.datasource.active", "true");
        m.put("quarkus.flyway.active", "true");
        m.put("quarkus.datasource.jdbc.url", URL);
        m.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_app");
        m.put("quarkus.flyway.schemas", "gcsp_app");
        m.put("gcsp.environment-id", "test-app-env");
        m.put("gcsp.database.expected-name", "gcsp_test_dev");
        return m;
    }

    @Override
    public Set<Class<?>> getEnabledAlternatives() {
        return Set.of(CaseHttpPorts.KnownRenewal.class);
    }

    @Override
    public List<TestResourceEntry> testResources() {
        return List.of(new TestResourceEntry(JwksServerResource.class));
    }
}
