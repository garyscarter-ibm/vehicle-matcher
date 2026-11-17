package gcsp.api.persistence;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.postgresql.ds.PGSimpleDataSource;

/** AC1 and AC2 on the started dev composition: real RS256 tokens, native PostgreSQL, the app's own routes plus SQL reads; cumulative. */
@QuarkusTest
@TestProfile(PersistenceDevCompositionProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class PersistenceDevCompositionHttpTest {

    private static final String API = "/api/gcsp/v1";
    private static final String CLOCK = API + "/presenter/clock";

    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    private String presenter;
    private String greg;
    private String paula;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        presenter = token("sub-presenter", "presenter");
        greg = token("sub-greg", "greg");
        paula = token("sub-paula", "employee");
    }

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_pdev_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(PersistenceDevCompositionProfile.URL);
        try (Connection c = ds.getConnection(); var st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    @Test
    @Order(1)
    void theStartedAppBindsPostgresPersistenceAndTheEnvironmentIdentity() throws Exception {
        given().get("/q/health/ready").then().statusCode(200).body("status", org.hamcrest.Matchers.equalTo("UP"))
                .body("checks.find { it.name == 'persistence' }.data.state", org.hamcrest.Matchers.equalTo("ready"))
                .body("checks.find { it.name == 'persistence' }.data.environmentId",
                        org.hamcrest.Matchers.equalTo(PersistenceDevCompositionProfile.ENV))
                .body("checks.find { it.name == 'persistence' }.data.runId",
                        org.hamcrest.Matchers.equalTo(activeRun()));
        assertEquals(1, count("SELECT count(*) FROM environment_identity WHERE environment_id = ? AND reset_allowed",
                PersistenceDevCompositionProfile.ENV));
        assertEquals(1, count("SELECT count(*) FROM runs WHERE status = 'active'"));
    }

    @Test
    @Order(2)
    void concurrentWritersOnOneVersionExactlyOneWins() throws Exception {
        long version = clockVersion();
        long revision = revision();
        long receipts = receipts();
        List<String> ids = new ArrayList<>();
        List<Callable<Response>> calls = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            String id = cmd();
            ids.add(id);
            calls.add(() -> advance(id, version, 60));
        }
        List<Response> answers = raceAll(calls);
        List<Response> won = answers.stream().filter(r -> r.statusCode() == 200).toList();
        List<Response> lost = answers.stream().filter(r -> r.statusCode() == 409).toList();
        assertEquals(1, won.size(), "exactly one writer wins: " + statuses(answers));
        assertEquals(7, lost.size(), statuses(answers));
        assertEquals(version + 1, won.get(0).jsonPath().getLong("value.clockVersion"));
        for (Response r : lost) {
            assertEquals("stale-version", r.jsonPath().getString("code"));
            assertEquals(version + 1, r.jsonPath().getLong("currentVersion"));
        }
        assertEquals(version + 1, storedClockVersion());
        assertEquals(version + 1, clockVersion());
        assertEquals(revision + 1, revision());
        assertEquals(receipts + 1, receipts());
        long stored = 0;
        for (String id : ids) stored += count("SELECT count(*) FROM command_receipts WHERE command_id = ?", "clock:advance:" + id);
        assertEquals(1, stored, "exactly one of the eight commands has a receipt");
    }

    @Test
    @Order(3)
    void concurrentDuplicatesHaveOneEffectAndReplayLater() throws Exception {
        long version = clockVersion();
        long revision = revision();
        long receipts = receipts();
        String id = cmd();
        List<Callable<Response>> calls = new ArrayList<>();
        for (int i = 0; i < 4; i++) calls.add(() -> advance(id, version, 90));
        List<Response> answers = raceAll(calls);
        for (Response r : answers) assertEquals(200, r.statusCode(), statuses(answers) + " " + r.asString());
        String now = answers.get(0).jsonPath().getString("value.now");
        for (Response r : answers) {
            assertEquals(version + 1, r.jsonPath().getLong("value.clockVersion"));
            assertEquals(now, r.jsonPath().getString("value.now"));
        }
        assertEquals(version + 1, storedClockVersion());
        assertEquals(revision + 1, revision());
        assertEquals(receipts + 1, receipts());
        assertEquals(1, count("SELECT count(*) FROM command_receipts WHERE command_id = ?", "clock:advance:" + id));

        Response replay = advance(id, version, 90);
        assertEquals(200, replay.statusCode(), replay.asString());
        assertEquals(now, replay.jsonPath().getString("value.now"));
        assertEquals(version + 1, replay.jsonPath().getLong("value.clockVersion"));
        assertEquals(revision + 1, revision());

        Response changed = advance(id, version, 91);
        assertEquals(409, changed.statusCode(), changed.asString());
        assertEquals("command-input-changed", changed.jsonPath().getString("code"));
        assertEquals(version + 1, storedClockVersion());
        assertEquals(revision + 1, revision());
        assertEquals(receipts + 1, receipts());
    }

    @Test
    @Order(4)
    void aRefusedCommandChangesNothing() throws Exception {
        long version = clockVersion();
        long revision = revision();
        long receipts = receipts();
        long outbox = count("SELECT count(*) FROM outbox_events");
        String all = allDigest();

        Response stale = advance(cmd(), version - 1, 60);
        assertEquals(409, stale.statusCode());
        assertEquals("stale-version", stale.jsonPath().getString("code"));
        assertEquals(version, stale.jsonPath().getLong("currentVersion"));
        // A valid shape with a rejected time and a malformed body are both refused before any write.
        Response backwards = advance(cmd(), version, -5);
        assertTrue(backwards.statusCode() >= 400 && backwards.statusCode() < 500, backwards.asString());
        Response malformed = presenterSpec().body("{\"commandId\":\"x\",\"expectedClockVersion\":" + version).post(CLOCK + "/advance");
        assertEquals(400, malformed.statusCode(), malformed.asString());
        Response unknown = presenterSpec().body("{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":" + version
                + ",\"bySeconds\":5,\"employeeId\":\"E-1\"}").post(CLOCK + "/advance");
        assertEquals(400, unknown.statusCode(), unknown.asString());

        assertEquals(version, storedClockVersion());
        assertEquals(revision, revision());
        assertEquals(receipts, receipts());
        assertEquals(outbox, count("SELECT count(*) FROM outbox_events"));
        assertEquals(all, allDigest(), "no table changed");
    }

    @Test
    @Order(5)
    void onlyThePresenterMayReset() {
        for (String who : new String[] {paula, greg}) {
            given().header("Authorization", "Bearer " + who).contentType(ContentType.JSON).body("{}")
                    .post(CLOCK + "/reset").then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("role-required"));
        }
        given().contentType(ContentType.JSON).body("{}").post(CLOCK + "/reset").then().statusCode(401);
    }

    @Test
    @Order(6)
    void aPresenterResetRetiresTheRunAndLeavesEveryOtherDatabaseRowUntouched() throws Exception {
        String oldRun = activeRun();
        long oldReceipts = receipts();
        long oldRevision = revision();
        String oldRunDigest = runDigest(oldRun);
        try (PgFixture other = PgFixture.createClaimed("GCSP_TEST_DATABASE_URL", "isolated-other-env", true);
                PgFixture running = PgFixture.createClaimed("GCSP_TEST_RUNNING_DATABASE_URL", "gcsp-poc", false)) {
            for (PgFixture f : new PgFixture[] {other, running}) {
                Support.seed(f);
                assertTrue(new TransactionRunner(f.pool()).execute(f.ctx(), Support.cmd("hold", "h-1", Support.input("c", "c1")),
                        Support.hold("hold-1", "c1", "s1", 1)) instanceof Outcome.Committed);
            }
            String otherBefore = other.allTablesDigest();
            String runningBefore = running.allTablesDigest();
            long otherRevision = other.revision(other.ctx());
            long runningRevision = running.revision(running.ctx());

            String command = cmd();
            String body = resetBody(command, oldRun);
            Response first = presenterSpec().body(body).post(CLOCK + "/reset");
            assertEquals(200, first.statusCode(), first.asString());
            JsonPath j = first.jsonPath();
            assertEquals("ok", j.getString("status"));
            assertEquals(oldRun, j.getString("value.retiredRunId"));
            assertEquals(false, j.getBoolean("value.replayed"));
            String newRun = j.getString("value.activatedRunId");
            assertNotEquals(oldRun, newRun);

            assertEquals("retired", text("SELECT status FROM runs WHERE run_id = ?", oldRun));
            assertEquals("active", text("SELECT status FROM runs WHERE run_id = ?", newRun));
            assertEquals(1, count("SELECT count(*) FROM runs WHERE status = 'active'"));
            assertEquals(1, count("SELECT count(*) FROM run_resets WHERE command_id = ? AND retired_run_id = ? AND activated_run_id = ?",
                    "scenario:reset:" + command, oldRun, newRun));
            // Nothing of the retired run was deleted: its receipts, revision and every row stay as they were.
            assertEquals(oldReceipts, count("SELECT count(*) FROM command_receipts WHERE run_id = ?", oldRun));
            assertEquals(oldRevision, count("SELECT revision FROM runs WHERE run_id = ?", oldRun));
            assertEquals(oldRunDigest, runDigest(oldRun));
            assertEquals(1, count("SELECT count(*) FROM run_clocks WHERE run_id = ?", newRun));

            assertEquals(newRun, given().header("Authorization", "Bearer " + presenter).get(CLOCK).jsonPath().getString("value.runId"));
            for (String who : new String[] {greg, paula}) {
                given().header("Authorization", "Bearer " + who).get(API + "/context").then().statusCode(200)
                        .body("value.runId", org.hamcrest.Matchers.equalTo(newRun));
            }
            given().get("/q/health/ready").then().body("checks.find { it.name == 'persistence' }.data.runId",
                    org.hamcrest.Matchers.equalTo(newRun));

            Response replay = presenterSpec().body(body).post(CLOCK + "/reset");
            assertEquals(200, replay.statusCode(), replay.asString());
            assertEquals(true, replay.jsonPath().getBoolean("value.replayed"));
            assertEquals(oldRun, replay.jsonPath().getString("value.retiredRunId"));
            assertEquals(newRun, replay.jsonPath().getString("value.activatedRunId"));
            assertEquals(1, count("SELECT count(*) FROM run_resets WHERE command_id = ?", "scenario:reset:" + command));

            Response stale = presenterSpec().body(resetBody(cmd(), oldRun)).post(CLOCK + "/reset");
            assertEquals(409, stale.statusCode(), stale.asString());
            assertEquals("stale-run", stale.jsonPath().getString("code"));
            assertEquals(newRun, activeRun());

            assertEquals(otherBefore, other.allTablesDigest(), "another environment's rows are byte-identical");
            assertEquals(runningBefore, running.allTablesDigest(), "the running database's rows are byte-identical");
            assertEquals(otherRevision, other.revision(other.ctx()));
            assertEquals(runningRevision, running.revision(running.ctx()));
            assertEquals("run-1", running.text("SELECT run_id FROM runs WHERE status = 'active'"));
            assertEquals(0, running.count("SELECT count(*) FROM run_resets"));
        }
    }

    // ---- helpers ----

    private Response advance(String command, long version, long bySeconds) {
        return presenterSpec().body("{\"commandId\":\"" + command + "\",\"expectedClockVersion\":" + version
                + ",\"bySeconds\":" + bySeconds + "}").post(CLOCK + "/advance");
    }

    /** The reset body the way the presenter console builds it: versions come from the scenario catalogue. */
    private String resetBody(String command, String expectedRun) {
        JsonPath c = given().header("Authorization", "Bearer " + presenter).get(API + "/presenter/scenarios").jsonPath();
        String base = "value.scenarios.find { it.scenarioId == 'gcsp-clock-scenario-v1' }.";
        return "{\"commandId\":\"" + command + "\",\"expectedRunId\":\"" + expectedRun + "\",\"scenarioVersion\":\""
                + c.getString(base + "scenarioVersion") + "\",\"fixtureVersion\":\"" + c.getString(base + "fixtureVersion")
                + "\",\"policyVersion\":\"" + c.getString(base + "policyVersion") + "\"}";
    }

    /** Starts every call at the same moment on its own thread and returns the answers in order. */
    private static List<Response> raceAll(List<Callable<Response>> calls) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(calls.size());
        try {
            CountDownLatch ready = new CountDownLatch(calls.size());
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Response>> futures = new ArrayList<>();
            for (Callable<Response> call : calls) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();
                    return call.call();
                }));
            }
            ready.await();
            go.countDown();
            List<Response> out = new ArrayList<>();
            for (Future<Response> f : futures) out.add(f.get(60, TimeUnit.SECONDS));
            return out;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String statuses(List<Response> answers) {
        return answers.stream().map(r -> String.valueOf(r.statusCode())).toList().toString();
    }

    private long clockVersion() {
        return given().header("Authorization", "Bearer " + presenter).get(CLOCK).then().statusCode(200).extract().jsonPath()
                .getLong("value.clockVersion");
    }

    private long storedClockVersion() throws SQLException {
        return count("SELECT clock_version FROM run_clocks WHERE run_id = ?", activeRun());
    }

    private String activeRun() throws SQLException {
        return text("SELECT run_id FROM runs WHERE status = 'active'");
    }

    private long revision() throws SQLException {
        return count("SELECT revision FROM runs WHERE status = 'active'");
    }

    private long receipts() throws SQLException {
        return count("SELECT count(*) FROM command_receipts WHERE run_id = ?", activeRun());
    }

    private String allDigest() throws SQLException {
        return PgFixture.allTablesDigest(source(), schema);
    }

    /** Digest of one run's receipts and outbox rows, so "nothing deleted or rewritten" is byte-level. */
    private String runDigest(String run) throws SQLException {
        return text("SELECT md5(coalesce((SELECT string_agg(x::text, '|' ORDER BY x::text) FROM command_receipts x WHERE x.run_id = ?), '')"
                + " || coalesce((SELECT string_agg(o::text, '|' ORDER BY o::text) FROM outbox_events o WHERE o.run_id = ?), ''))", run, run);
    }

    private static String cmd() {
        return "cmd-" + UUID.randomUUID();
    }

    private RequestSpecification presenterSpec() {
        return given().header("Authorization", "Bearer " + presenter).contentType(ContentType.JSON);
    }

    private PGSimpleDataSource source() {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(PersistenceDevCompositionProfile.URL);
        ds.setCurrentSchema(schema);
        return ds;
    }

    private long count(String sql, Object... params) throws SQLException {
        return Long.parseLong(text(sql, params));
    }

    private String text(String sql, Object... params) throws SQLException {
        try (Connection c = source().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
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
