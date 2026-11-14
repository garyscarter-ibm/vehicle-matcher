package gcsp.api.comparison;

import static io.restassured.RestAssured.given;

import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** A signed RS256 bearer for one of the profile's accounts. */
final class ComparisonHttpSupport {

    private ComparisonHttpSupport() {}

    static String token(String signingJwk, String subject, String role) {
        try {
            RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
            JwtClaims c = new JwtClaims();
            c.setIssuer(ComparisonHttpProfiles.ISSUER);
            c.setAudience(ComparisonHttpProfiles.AUDIENCE);
            c.setSubject(subject);
            c.setExpirationTimeMinutesInTheFuture(10);
            c.setIssuedAtToNow();
            c.setClaim("azp", ComparisonHttpProfiles.CLIENT);
            c.setClaim("scope", "openid gcsp-api");
            c.setClaim("realm_access", Map.of("roles", List.of(role)));
            JsonWebSignature jws = new JsonWebSignature();
            jws.setPayload(c.toJson());
            jws.setKey(key.getPrivateKey());
            jws.setKeyIdHeaderValue(ComparisonHttpProfiles.KID);
            jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
            return jws.getCompactSerialization();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static RequestSpecification as(String token) {
        return given().header("Authorization", "Bearer " + token);
    }
}
