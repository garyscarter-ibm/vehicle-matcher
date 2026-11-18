package gcsp.api.learning;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.agroal.api.AgroalDataSource;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.postgresql.ds.PGSimpleDataSource;

/** Real tokens, real routes and the brief journey shared by the started-app learned-plan tests. */
abstract class LearnedPlanHttpBase {

    static final ObjectMapper M = new ObjectMapper();
    static final String API = "/api/gcsp/v1";
    static final String PLAN = API + "/greg/order-plan";
    static final String ENV = "account-dev-env";
    static final String RUN = "run-1";

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Instance<AgroalDataSource> dataSource;

    static void dropSchema(String owned, String prefix) throws Exception {
        if (owned == null || !owned.startsWith(prefix)) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(LearnedPlanProfiles.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + owned + " CASCADE");
        }
    }

    /** The presenter's next-release tick, which delivers the demo supply to the run. */
    void tick(String presenter) throws Exception {
        JsonNode clock = get(presenter, API + "/presenter/clock").body().get("value");
        Resp tick = post(presenter, API + "/presenter/controls/tick", "{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.get("clockVersion") + ",\"mode\":\"next-release\"}");
        assertEquals(200, tick.status(), tick.toString());
        assertEquals("completed", tick.body().at("/value/tick/state").asText());
    }

    /** An employee's brief through the real routes: three categories and Same again, then confirm with consent. */
    void confirmBrief(String sub) throws Exception {
        confirmBrief(sub, false);
    }

    /** With bootAnswer, the employee also answers the editor's practical question "at least 430 litres?" with yes. */
    void confirmBrief(String sub, boolean bootAnswer) throws Exception {
        String t = token(sub, "employee");
        String who = sub.substring(4);
        JsonNode initial = get(t, API + "/brief/editor").body().at("/value/initial");
        String contract = initial.at("/currentCarRating/contractId").asText();
        Resp prefs = post(t, API + "/brief/preferences", "{\"commandId\":\"" + cmd() + "\",\"expectedBriefVersion\":"
                + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + initial.get("draftVersion") + ",\"changes\":{"
                + "\"comfort\":{\"value\":50},\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50}},"
                + "\"sameAgain\":{\"contractId\":\"" + contract + "\",\"on\":true}}");
        assertEquals(200, prefs.status(), who + " " + prefs);
        JsonNode draftVersion = prefs.body().at("/value/draftVersion");
        if (bootAnswer) {
            ObjectNode brief = (ObjectNode) get(t, API + "/brief/editor").body().at("/value/initial/brief").deepCopy();
            ObjectNode boot = (ObjectNode) brief.get("essentials").get("boot");
            boot.put("value", 430).put("state", "draft").put("source", "employee");
            ObjectNode draft = M.createObjectNode().put("commandId", cmd()).put("expectedBriefVersion", initial.get("briefVersion").asInt())
                    .put("expectedDraftVersion", draftVersion.asInt());
            draft.set("brief", brief);
            Resp saved = post(t, API + "/brief/draft", draft.toString());
            assertEquals(200, saved.status(), who + " " + saved);
            draftVersion = saved.body().at("/value/draftVersion");
        }
        Resp confirm = post(t, API + "/brief/confirm", "{\"commandId\":\"" + cmd() + "\",\"expectedBriefVersion\":"
                + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + draftVersion
                + ",\"consent\":{\"search\":true,\"hold\":true}}");
        assertEquals(200, confirm.status(), who + " " + confirm);
    }

    record Resp(int status, JsonNode body) {
    }

    Resp get(String token, String path) throws Exception {
        Response r = given().header("Authorization", "Bearer " + token).get(path);
        return new Resp(r.statusCode(), M.readTree(r.asString()));
    }

    Resp post(String token, String path, String body) throws Exception {
        Response r = given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).body(body).post(path);
        return new Resp(r.statusCode(), M.readTree(r.asString()));
    }

    static String cmd() {
        return "cmd-learnj-" + UUID.randomUUID();
    }

    long count(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    String token(String sub, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(LearnedPlanProfiles.ISSUER);
        c.setAudience(LearnedPlanProfiles.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", LearnedPlanProfiles.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(jwk)).getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }
}
