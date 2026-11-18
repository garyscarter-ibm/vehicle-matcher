package gcsp.api.auth;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** Signed tokens and the raw request helper shared by the auth HTTP tests. */
final class AuthSupport {

    static final String API = "/api/gcsp/v1";

    private AuthSupport() {}

    static JwtClaims claims(String subject, String... roles) {
        JwtClaims c = new JwtClaims();
        c.setIssuer(AuthRouteTableProfile.ISSUER);
        c.setAudience(AuthRouteTableProfile.AUDIENCE);
        c.setSubject(subject);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", AuthRouteTableProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(roles)));
        return c;
    }

    static String sign(JwtClaims claims, RsaJsonWebKey key) throws Exception {
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    static RsaJsonWebKey key(String signingJwk) throws Exception {
        return (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
    }

    static String token(String signingJwk, String subject, String... roles) throws Exception {
        return sign(claims(subject, roles), key(signingJwk));
    }

    /** Any method and path; a body is sent as JSON, and a null token sends no Authorization header. */
    static Response call(String token, String method, String path, String body) {
        RequestSpecification spec = given().contentType(ContentType.JSON);
        if (token != null) spec = spec.header("Authorization", "Bearer " + token);
        if (body != null) spec = spec.body(body);
        return spec.request(method, path);
    }

    static String code(Response r) {
        try {
            return r.jsonPath().getString("code");
        } catch (RuntimeException e) {
            return null;
        }
    }
}
