package gcsp.api.persistence;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The app booted on the running-database stand-in: claimed gcsp-poc, reset not allowed, so a reset is refused and writes nothing. */
@QuarkusTest
@TestProfile(PersistenceRunningDatabaseProfile.class)
class PersistenceRunningDatabaseHttpTest {

    private static final String CLOCK = "/api/gcsp/v1/presenter/clock";
    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    private String presenter;
    private String greg;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_RUNNING_DATABASE_URL is not set");
        ownedSchema = schema;
        presenter = token("sub-presenter", "presenter");
        greg = token("sub-greg", "greg");
    }

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_prun_")) return;
        try (Connection c = source(ownedSchema).getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    @Test
    void theRunningDatabaseIsClaimedWithoutResetAndTheAppRefusesToResetIt() throws Exception {
        assertEquals("false", text("SELECT reset_allowed::text FROM environment_identity"));
        assertEquals(PersistenceRunningDatabaseProfile.ENV, text("SELECT environment_id FROM environment_identity"));
        given().get("/q/health/ready").then().statusCode(200).body("checks.find { it.name == 'persistence' }.data.environmentId",
                org.hamcrest.Matchers.equalTo(PersistenceRunningDatabaseProfile.ENV));
        String run = text("SELECT run_id FROM runs WHERE status = 'active'");
        String before = PgFixture.allTablesDigest(source(schema), schema);
        long receipts = Long.parseLong(text("SELECT count(*) FROM command_receipts"));
        long resets = Long.parseLong(text("SELECT count(*) FROM run_resets"));

        String body = "{\"commandId\":\"" + cmd() + "\",\"expectedRunId\":\"" + run
                + "\",\"scenarioVersion\":\"v\",\"fixtureVersion\":\"v\",\"policyVersion\":\"v\"}";
        Response refused = as(presenter).body(body).post(CLOCK + "/reset");
        assertEquals(403, refused.statusCode(), refused.asString());
        assertEquals("scenarios-not-configured", refused.jsonPath().getString("code"));
        Response other = as(presenter).body(body).post("/api/gcsp/v1/presenter/scenarios/reset");
        assertEquals(403, other.statusCode(), other.asString());
        assertEquals("scenarios-not-configured", other.jsonPath().getString("code"));
        as(greg).body(body).post(CLOCK + "/reset").then().statusCode(403)
                .body("code", org.hamcrest.Matchers.equalTo("role-required"));

        assertEquals(before, PgFixture.allTablesDigest(source(schema), schema), "a refused reset writes nothing");
        assertEquals(run, text("SELECT run_id FROM runs WHERE status = 'active'"));
        assertEquals(receipts, Long.parseLong(text("SELECT count(*) FROM command_receipts")));
        assertEquals(resets, Long.parseLong(text("SELECT count(*) FROM run_resets")));
    }

    @Test
    void theRunningAppStillCommitsItsOwnWork() throws Exception {
        long version = given().header("Authorization", "Bearer " + presenter).get(CLOCK).then().statusCode(200).extract()
                .jsonPath().getLong("value.clockVersion");
        long revision = Long.parseLong(text("SELECT revision FROM runs WHERE status = 'active'"));
        String command = cmd();
        Response advanced = as(presenter).body("{\"commandId\":\"" + command + "\",\"expectedClockVersion\":" + version
                + ",\"bySeconds\":60}").post(CLOCK + "/advance");
        assertEquals(200, advanced.statusCode(), advanced.asString());
        assertEquals(version + 1, advanced.jsonPath().getLong("value.clockVersion"));
        assertEquals(revision + 1, Long.parseLong(text("SELECT revision FROM runs WHERE status = 'active'")));
        assertEquals("1", text("SELECT count(*) FROM command_receipts WHERE command_id = ?", "clock:advance:" + command));
    }

    @Test
    void theDemoResetGuardRefusesADatabaseClaimedWithoutReset() throws Exception {
        try (PgFixture fixture = PgFixture.createClaimed("GCSP_TEST_RUNNING_DATABASE_URL", "gcsp-poc", false)) {
            // requireResetDatabase is package-private in gcsp.api.scenario, so it is reached by reflection.
            Method guard = Class.forName("gcsp.api.scenario.ScenarioWiring").getDeclaredMethod("requireResetDatabase", DataSource.class);
            guard.setAccessible(true);
            InvocationTargetException e = assertThrows(InvocationTargetException.class, () -> guard.invoke(null, fixture.pool()));
            assertEquals(IllegalStateException.class, e.getCause().getClass());
        }
    }

    // ---- helpers ----

    private io.restassured.specification.RequestSpecification as(String token) {
        return given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON);
    }

    private static String cmd() {
        return "cmd-" + UUID.randomUUID();
    }

    private static PGSimpleDataSource source(String schema) {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(PersistenceRunningDatabaseProfile.URL);
        ds.setCurrentSchema(schema);
        return ds;
    }

    private String text(String sql, Object... params) throws SQLException {
        try (Connection c = source(schema).getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private String token(String sub, String role) throws Exception {
        RsaJsonWebKey key = (RsaJsonWebKey) JsonWebKey.Factory.newJwk(signingJwk);
        JwtClaims c = new JwtClaims();
        c.setIssuer(PersistenceDevCompositionProfile.ISSUER);
        c.setAudience(PersistenceDevCompositionProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", PersistenceDevCompositionProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(key.getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }
}
