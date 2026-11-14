package gcsp.api.presenter;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Signed tokens, the request helpers and schema cleanup shared by the presenter clock HTTP tests. */
final class PresenterClockSupport {

    static final String BASE = "/api/gcsp/v1/presenter";

    private PresenterClockSupport() {}

    static String token(String signingJwk, String subject, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(PresenterClockProfiles.ISSUER);
        c.setAudience(PresenterClockProfiles.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", PresenterClockProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    static RequestSpecification as(String token) {
        RequestSpecification spec = given().contentType(ContentType.JSON);
        return token == null ? spec : spec.header("Authorization", "Bearer " + token);
    }

    static Response get(String token, String path) {
        return as(token).get(BASE + path);
    }

    static Response post(String token, String path, String body) {
        return as(token).body(body).post(BASE + path);
    }

    static void dropSchema(String schema) throws Exception {
        if (schema == null || !schema.startsWith("gcsp_s_pclock_")) return;
        try (Connection c = PresenterClockProfiles.plain().getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
