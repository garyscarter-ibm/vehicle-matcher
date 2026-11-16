package gcsp.api.planning;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.JwksServerResource;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Signed test tokens, the no-database identity profiles and the fixture ports for the order-plan HTTP tests. */
final class PlanningHttpSupport {

    static final String PATH = "/api/gcsp/v1/greg/order-plan";
    private static final String ISSUER = "https://issuer.test/realms/gcsp";
    private static final String CLIENT = "gcsp-web";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String ACCOUNTS = "["
            + "{\"subject\":\"sub-employee\",\"roles\":[\"employee\"],\"employeeId\":\"E-1001\"},"
            + "{\"subject\":\"sub-greg\",\"roles\":[\"greg\"]}]";

    private PlanningHttpSupport() {
    }

    /** Fixture demand and supply bound in place of the unconfigured defaults. */
    @Alternative
    @ApplicationScoped
    public static class HttpPorts extends PlanningFixtures.Ports {
        public HttpPorts() {
            stock.add(PlanningFixtures.Ports.car("veh-1", PlanningFixtures.TOURING));
        }
    }

    /** A fixed instant, so two reads of unchanged inputs give the same plan id. */
    @Alternative
    @ApplicationScoped
    public static class FixedClock implements PlanningClock {
        @Override
        public Observation observe(gcsp.api.persistence.RunContext context) {
            return new Observation(PlanningFixtures.NOW, "fixed-clock");
        }
    }

    private static Map<String, String> identity() {
        Map<String, String> c = new HashMap<>();
        c.put("gcsp.identity.provider", "oidc");
        c.put("gcsp.oidc.issuer", ISSUER);
        c.put("gcsp.oidc.audience", "gcsp-api");
        c.put("gcsp.oidc.authorized-party", CLIENT);
        c.put("gcsp.oidc.required-scopes", "gcsp-api");
        c.put("gcsp.oidc.accounts", ACCOUNTS);
        c.put("gcsp.environment.id", "planning-http-env");
        c.put("gcsp.environment.run-id", "run-1");
        c.put("gcsp.environment.policy-version", PlanningFixtures.POLICY);
        c.put("quarkus.datasource.active", "false");
        c.put("quarkus.flyway.active", "false");
        return c;
    }

    /** Persistence off, the file policy source and the fixture ports. */
    public static class WithPorts implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return identity();
        }

        @Override
        public Set<Class<?>> getEnabledAlternatives() {
            return Set.of(HttpPorts.class, FixedClock.class);
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    /** Persistence off and no ports bound: the production defaults. */
    public static class Defaults implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return identity();
        }

        @Override
        public List<TestResourceEntry> testResources() {
            return List.of(new TestResourceEntry(JwksServerResource.class));
        }
    }

    static String token(String signingJwk, String subject, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(ISSUER);
        c.setAudience("gcsp-api");
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    static io.restassured.specification.RequestSpecification as(String token) {
        var request = given();
        return token == null ? request : request.header("Authorization", "Bearer " + token);
    }

    static Response get(String token, String query) {
        return as(token).get(PATH + query);
    }

    static Response preview(String token, String body) {
        return as(token).contentType(ContentType.JSON).body(body).post(PATH + "/preview");
    }

    static JsonNode json(Response response) throws Exception {
        return JSON.readTree(response.asString());
    }
}
