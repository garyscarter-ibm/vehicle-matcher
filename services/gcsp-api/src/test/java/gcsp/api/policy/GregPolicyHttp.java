package gcsp.api.policy;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Shared helpers of the Greg policy HTTP tests: signed tokens, a steppable clock and the JSON calls. */
final class GregPolicyHttp {

    static final ObjectMapper JSON = new ObjectMapper();
    static final String PATH = "/api/gcsp/v1/greg/policy";
    private static final Instant START = Instant.parse("2026-11-14T10:00:00Z");
    private static final AtomicLong STEPS = new AtomicLong();

    private GregPolicyHttp() {
    }

    /** The clock instant now; every publication in a class moves it forward so versions stay in date order. */
    static final class StepClock extends WallPolicyClock {
        volatile Instant now = START;

        Instant advance() {
            now = START.plusSeconds(60 * STEPS.incrementAndGet());
            return now;
        }

        @Override
        public Instant now(RunContext context) {
            return now;
        }
    }

    static String token(String signingJwk, String subject, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(GregPolicyProfiles.ISSUER);
        c.setAudience(GregPolicyProfiles.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", GregPolicyProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(GregPolicyProfiles.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    static Response get(String token) {
        return token == null ? given().get(PATH) : given().header("Authorization", "Bearer " + token).get(PATH);
    }

    static Response post(String token, String suffix, Object body) {
        var request = given().contentType(ContentType.JSON);
        if (token != null) {
            request = request.header("Authorization", "Bearer " + token);
        }
        return request.body(body instanceof JsonNode ? body.toString() : body).post(PATH + suffix);
    }

    static JsonNode json(Response response) throws Exception {
        return JSON.readTree(response.asString());
    }

    static JsonNode field(JsonNode value, String id) {
        for (JsonNode f : value.get("fields")) {
            if (id.equals(f.get("id").textValue())) {
                return f;
            }
        }
        throw new IllegalStateException("No field " + id);
    }

    static ObjectNode change(String commandId, String expected, String version, Instant effectiveFrom, Object... edits) {
        ObjectNode body = JSON.createObjectNode();
        body.put("expectedActiveVersion", expected);
        body.put("commandId", commandId);
        body.put("policyVersion", version);
        body.put("effectiveFrom", PolicyClock.iso(effectiveFrom));
        ArrayNode changes = body.putArray("changes");
        for (int i = 0; i < edits.length; i += 2) {
            changes.addObject().put("id", (String) edits[i]).put("value", (Integer) edits[i + 1]);
        }
        return body;
    }
}
