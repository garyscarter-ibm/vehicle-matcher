package gcsp.api.allocation;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;

/** JWTs, presenter clock calls and SQL reads shared by the two Buddy journey tests. */
public final class BuddyJourneySupport {

    public static final ObjectMapper JSON = new ObjectMapper();
    public static final String API = "/api/gcsp/v1";
    public static final String OCCUPYING = "('active', 'claim-pending', 'release-pending', 'selection-pending')";
    private static final String HELD = "('active', 'claim-pending', 'release-pending', 'selection-pending', 'allocated')";

    private final DataSource dataSource;
    private final String signingJwk;

    public BuddyJourneySupport(DataSource dataSource, String signingJwk) {
        this.dataSource = dataSource;
        this.signingJwk = signingJwk;
    }

    public String token(String subject, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims claims = new JwtClaims();
        claims.setIssuer("https://issuer.test/realms/gcsp");
        claims.setAudience("gcsp-api");
        claims.setSubject(subject);
        claims.setExpirationTimeMinutesInTheFuture(10);
        claims.setIssuedAtToNow();
        claims.setClaim("azp", "gcsp-web");
        claims.setClaim("scope", "openid gcsp-api");
        claims.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(claims.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue(key.getKeyId());
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    public static Response get(String token, String path) {
        return given().header("Authorization", "Bearer " + token).when().get(path);
    }

    public static Response post(String token, String path, String body) {
        return given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).body(body).when().post(path);
    }

    public long clockVersion(String presenter) {
        return get(presenter, API + "/presenter/clock").then().statusCode(200).extract().jsonPath().getLong("value.clockVersion");
    }

    public String clockNow(String presenter) {
        return get(presenter, API + "/presenter/clock").then().statusCode(200).extract().jsonPath().getString("value.now");
    }

    public void advance(String presenter, long bySeconds) {
        long version = clockVersion(presenter);
        post(presenter, API + "/presenter/clock/advance", "{\"commandId\":\"adv-" + UUID.randomUUID()
                + "\",\"expectedClockVersion\":" + version + ",\"bySeconds\":" + bySeconds + "}").then().statusCode(200);
    }

    /** A presenter tick at the current clock; it must complete with a 200. Returns the tick view's value. */
    public JsonNode tick(String presenter, String tickId) throws Exception {
        String body = post(presenter, API + "/presenter/clock/tick", "{\"tickId\":\"" + tickId
                + "\",\"expectedClockVersion\":" + clockVersion(presenter) + "}").then().statusCode(200).extract().asString();
        return JSON.readTree(body).get("value");
    }

    public static JsonNode outcome(JsonNode tick, String handlerId) {
        for (JsonNode o : tick.get("outcomes")) if (handlerId.equals(o.path("handlerId").asText())) return o.get("outcome");
        throw new AssertionError("no outcome for " + handlerId + " in " + tick.get("outcomes"));
    }

    public static JsonNode value(Response r, int status) throws Exception {
        return JSON.readTree(r.then().statusCode(status).extract().asString());
    }

    /** Every car has at most one occupying or allocated hold, every employee at most maxActive, every slot unit one. */
    public void assertCustodyInvariants(long maxActive) throws SQLException {
        assertEquals(0, count("SELECT count(*) FROM (SELECT order_uuid FROM custody_holds WHERE state IN " + HELD
                + " GROUP BY order_uuid HAVING count(*) > 1) x"), "a car has two holders");
        assertEquals(0, count("SELECT count(*) FROM (SELECT employee_id FROM custody_holds WHERE state IN " + OCCUPYING
                + " GROUP BY employee_id HAVING count(*) > " + maxActive + ") x"), "an employee exceeds maxActive");
        assertEquals(0, count("SELECT count(*) FROM (SELECT slot_id, slot_unit FROM custody_holds WHERE state IN " + OCCUPYING
                + " GROUP BY slot_id, slot_unit HAVING count(*) > 1) x"), "a slot unit has two occupants");
    }

    public JsonNode json(String sql, Object... parameters) throws Exception {
        return JSON.readTree(text(sql, parameters));
    }

    public String text(String sql, Object... parameters) throws SQLException {
        List<String> rows = column(sql, parameters);
        assertEquals(1, rows.size(), sql);
        assertTrue(rows.get(0) != null, sql);
        return rows.get(0);
    }

    public List<String> column(String sql, Object... parameters) throws SQLException {
        List<String> out = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) ps.setObject(i + 1, parameters[i]);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(rs.getString(1));
            }
        }
        return out;
    }

    public long count(String sql, Object... parameters) throws SQLException {
        return Long.parseLong(text(sql, parameters));
    }
}
