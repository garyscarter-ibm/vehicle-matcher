package gcsp.api.brief;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.postgresql.ds.PGSimpleDataSource;

/** Real RS256 tokens, HTTP helpers and plain JDBC over the journey schema, shared by both phases. */
final class BriefJourneySupport {

    static final String BASE = "/api/gcsp/v1/brief";
    static final ObjectMapper JSON = new ObjectMapper();

    private BriefJourneySupport() {}

    static String token(String signingJwk, String sub, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(BriefJourneyProfiles.ISSUER);
        c.setAudience(BriefJourneyProfiles.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", BriefJourneyProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk)).getPrivateKey());
        jws.setKeyIdHeaderValue(BriefJourneyProfiles.KID);
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    static RequestSpecification as(String token) {
        RequestSpecification spec = given().accept(ContentType.JSON);
        return token == null ? spec : spec.header("Authorization", "Bearer " + token);
    }

    static Response get(String token, String path) {
        return as(token).get(BASE + path);
    }

    static Response post(String token, String path, String body) {
        return as(token).contentType(ContentType.JSON).body(body).post(BASE + path);
    }

    static JsonNode tree(Response r) throws Exception {
        return JSON.readTree(r.asString());
    }

    /** The value of a 200 read. */
    static JsonNode read(String token, String path) throws Exception {
        Response r = get(token, path);
        r.then().statusCode(200);
        return tree(r).get("value");
    }

    static String command(String id, long brief, long draft, String rest) {
        return "{\"commandId\":\"" + id + "\",\"expectedBriefVersion\":" + brief + ",\"expectedDraftVersion\":" + draft
                + (rest.isEmpty() ? "" : "," + rest) + "}";
    }

    /** A plain connection in the journey schema, outside the app's pool. */
    static Connection connect() throws Exception {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(BriefJourneyProfiles.URL);
        ds.setCurrentSchema(BriefJourneyProfiles.SCHEMA);
        return ds.getConnection();
    }

    static long count(String sql, String... args) throws Exception {
        try (Connection c = connect(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) ps.setString(i + 1, args[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    static void dropSchema(String schema) throws Exception {
        if (schema == null || !schema.startsWith("gcsp_s_briefj_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(BriefJourneyProfiles.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        }
    }
}
