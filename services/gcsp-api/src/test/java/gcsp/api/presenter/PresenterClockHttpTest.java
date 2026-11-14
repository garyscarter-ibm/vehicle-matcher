package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The presenter clock and controls over the native test database, with the bound stock-release handler. */
@QuarkusTest
@TestProfile(PresenterClockProfiles.WithSupply.class)
class PresenterClockHttpTest {

    private static final String[] PATHS = {"/clock", "/controls", "/clock/ticks/x"};
    private static final String[][] POSTS = {{"/clock/advance", "{}"}, {"/clock/tick", "{}"},
            {"/controls/tick", "{}"}};

    /** The profile's schema as the running app sees it; the profile's own constant is per class loader. */
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    RunClockHolder holder;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @Inject
    DocumentClock documentClock;

    String presenter;
    String employee;
    String greg;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        // The documents tests' shared @Alternative clock would pin the time; use the real binding here.
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        employee = PresenterClockSupport.token(signingJwk, "sub-employee", "employee");
        greg = PresenterClockSupport.token(signingJwk, "sub-greg", "greg");
    }

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    long version() {
        return get(presenter, "/clock").then().statusCode(200).extract().jsonPath().getLong("value.clockVersion");
    }

    static String id(String prefix) {
        return prefix + "-" + UUID.randomUUID();
    }

    @Test
    void everyEndpointRefusesAnAnonymousEmployeeAndGregCaller() {
        for (String path : PATHS) {
            get(null, path).then().statusCode(401).body("code", equalTo("bearer-missing"));
            for (String who : new String[] {employee, greg}) {
                get(who, path).then().statusCode(403).body("status", equalTo("forbidden"))
                        .body("code", equalTo("role-required"));
            }
        }
        for (String[] post : POSTS) {
            post(null, post[0], post[1]).then().statusCode(401);
            for (String who : new String[] {employee, greg}) {
                post(who, post[0], post[1]).then().statusCode(403).body("code", equalTo("role-required"));
            }
        }
    }

    @Test
    void queryParametersAreRefusedOnEveryEndpoint() {
        for (String path : PATHS) {
            get(presenter, path + "?runId=run-1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        }
        for (String[] post : POSTS) {
            post(presenter, post[0] + "?employeeId=E-1", post[1]).then().statusCode(400)
                    .body("code", equalTo("unsupported-query"));
        }
    }

    @Test
    void theClockAndTheControlsHaveTheContractShapeAndNoPrincipals() {
        get(presenter, "/clock").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.runId", equalTo("run-1")).body("value.clockVersion", org.hamcrest.Matchers.greaterThan(0))
                .body("value.namedTimes.release", org.hamcrest.Matchers.notNullValue());
        Response controls = get(presenter, "/controls");
        controls.then().statusCode(200).body("status", equalTo("ok")).body("value.controls.step.unit", equalTo("seconds"))
                .body("value.controls.step.value", equalTo(60)).body("value.controls.policyVersion",
                        org.hamcrest.Matchers.notNullValue())
                .body("value.controls.namedTimes.release", org.hamcrest.Matchers.notNullValue())
                .body("value.principals", nullValue()).body("value.controls.principals", nullValue())
                .body(not(containsString("principals")));
    }

    @Test
    void advanceReplaysByCommandIdAndAStaleVersionIs409WithTheCurrentOne() {
        long v = version();
        String command = id("adv");
        String body = "{\"commandId\":\"" + command + "\",\"expectedClockVersion\":" + v + ",\"bySeconds\":5}";
        JsonPath first = post(presenter, "/clock/advance", body).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.clockVersion", equalTo((int) v + 1)).extract().jsonPath();
        JsonPath replay = post(presenter, "/clock/advance", body).then().statusCode(200).extract().jsonPath();
        assertEquals(first.getString("value.now"), replay.getString("value.now"));
        assertEquals(v + 1, version());
        post(presenter, "/clock/advance", "{\"commandId\":\"" + id("adv") + "\",\"expectedClockVersion\":" + v
                + ",\"bySeconds\":5}").then().statusCode(409).body("code", equalTo("stale-version"))
                .body("currentVersion", equalTo((int) v + 1)).body("action", equalTo("refresh"))
                .body("retryable", equalTo(false));
        post(presenter, "/clock/advance", "{\"commandId\":\"" + command + "\",\"expectedClockVersion\":" + v
                + ",\"bySeconds\":6}").then().statusCode(409).body("code", equalTo("command-input-changed"));
    }

    @Test
    void badBodiesAre400WithFieldReasonsAndUnknownFieldsRefused() {
        post(presenter, "/clock/advance", "{\"commandId\":\"c\",\"expectedClockVersion\":1}").then().statusCode(400)
                .body("code", equalTo("invalid-clock-command")).body("reasons.field", hasItem("bySeconds"));
        post(presenter, "/clock/advance", "{\"commandId\":\"c\",\"expectedClockVersion\":1,\"bySeconds\":5,"
                + "\"employeeId\":\"E-1\"}").then().statusCode(400).body("reasons.field", hasItem("employeeId"));
        post(presenter, "/clock/advance", "{\"commandId\":\"c\",\"expectedClockVersion\":\"1\",\"bySeconds\":5}")
                .then().statusCode(400).body("reasons.field", hasItem("expectedClockVersion"));
        post(presenter, "/clock/tick", "{\"tickId\":\"t\",\"expectedClockVersion\":0}").then().statusCode(400)
                .body("code", equalTo("invalid-tick"));
        post(presenter, "/controls/tick", "{\"commandId\":\"c\",\"expectedClockVersion\":1,\"mode\":\"jump\"}")
                .then().statusCode(400).body("code", equalTo("invalid-presenter-tick"))
                .body("reasons.field", hasItem("mode"));
        post(presenter, "/controls/tick", "{\"commandId\":\"c\",\"expectedClockVersion\":1,\"mode\":\"step\","
                + "\"to\":\"release\"}").then().statusCode(400).body("reasons.field", hasItem("to"));
        post(presenter, "/controls/tick", "not json").then().statusCode(400);
    }

    @Test
    void aBackwardsTargetIs400AndWritesNothing() {
        long v = version();
        post(presenter, "/controls/tick", "{\"commandId\":\"" + id("back") + "\",\"expectedClockVersion\":" + v
                + ",\"mode\":\"to\",\"to\":\"2020-01-01T00:00:00Z\"}").then().statusCode(400)
                .body("code", equalTo("invalid-clock-command"));
        assertEquals(v, version());
    }

    @Test
    void aStepTickAdvancesRunsEveryBoundHandlerAndIsReadableByTickId() {
        long v = version();
        String command = id("step");
        String body = "{\"commandId\":\"" + command + "\",\"expectedClockVersion\":" + v + ",\"mode\":\"step\"}";
        JsonPath first = post(presenter, "/controls/tick", body).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.advance.clockVersion", equalTo((int) v + 1)).body("value.tick.state", equalTo("completed"))
                .extract().jsonPath();
        String tickId = first.getString("value.tick.tickId");
        assertTrue(tickId.startsWith("presenter-"));
        JsonPath replay = post(presenter, "/controls/tick", body).then().statusCode(200).extract().jsonPath();
        assertEquals(tickId, replay.getString("value.tick.tickId"));
        assertEquals(v + 1, version());
        get(presenter, "/clock/ticks/" + tickId).then().statusCode(200).body("value.tickId", equalTo(tickId))
                .body("value.kind", equalTo("presenter")).body("value.state", equalTo("completed"));
        get(presenter, "/clock").then().body("value.lastTick.tickId", equalTo(tickId));
    }

    @Test
    void nextReleaseTickReleasesStockThroughTheBoundHandlerInPolicyOrder() {
        long v = version();
        Response controls = get(presenter, "/controls");
        String status = controls.jsonPath().getString("value.controls.nextRelease.status");
        Assumptions.assumeTrue("available".equals(status), "the release cue was already passed by an earlier test");
        String at = controls.jsonPath().getString("value.controls.nextRelease.at");
        JsonPath tick = post(presenter, "/controls/tick", "{\"commandId\":\"" + id("rel") + "\",\"expectedClockVersion\":"
                + v + ",\"mode\":\"next-release\"}").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.advance.now", equalTo(at)).body("value.tick.state", equalTo("completed"))
                .body("value.tick.handlerOrder.handlerId", org.hamcrest.Matchers.contains("stock-release",
                        "lifecycle-documents", "captured-outbox"))
                .body("value.tick.handlerOrder.stage", org.hamcrest.Matchers.contains("release-pull",
                        "pending-reconciliation", "outbox-dispatch"))
                .body("value.tick.missingStages", org.hamcrest.Matchers.containsInAnyOrder("manual-expiry",
                        "buddy-expiry", "buddy-allocation"))
                .body("value.tick.outcomes", hasSize(3)).extract().jsonPath();
        assertEquals("ok", tick.getString("value.tick.outcomes.find { it.handlerId == 'stock-release' }.outcome.status"));
        // The plan's one window is open on the run's dated clock: the run's first full tick releases it (whichever
        // test ticks first), and later ticks report no-release.
        String kind = tick.getString("value.tick.outcomes.find { it.handlerId == 'stock-release' }.outcome.value.kind");
        assertTrue(Set.of("stock-released", "no-release").contains(kind), kind);
        PresenterClockSupport.as(presenter).get("/api/gcsp/v1/presenter/releases/latest").then().statusCode(200)
                .body("value.release.trancheId", org.hamcrest.Matchers.notNullValue());
        // The release cue is spent, so the control reports it unavailable.
        get(presenter, "/controls").then().body("value.controls.nextRelease.status", equalTo("unavailable"));
        post(presenter, "/controls/tick", "{\"commandId\":\"" + id("rel") + "\",\"expectedClockVersion\":" + version()
                + ",\"mode\":\"next-release\"}").then().statusCode(503).body("code", equalTo("no-future-release"));
    }

    @Test
    void aStaleTickVersionIs409AndAnUnknownTickIs404() {
        long v = version();
        post(presenter, "/clock/tick", "{\"tickId\":\"" + id("t") + "\",\"expectedClockVersion\":" + (v + 50) + "}")
                .then().statusCode(409).body("code", equalTo("stale-version")).body("currentVersion", equalTo((int) v));
        get(presenter, "/clock/ticks/nothing-here").then().statusCode(404).body("code", equalTo("tick-not-found"));
        get(presenter, "/clock/ticks/bad%20id").then().statusCode(404).body("code", equalTo("tick-not-found"));
    }

    @Test
    void aPresenterTickRunsAndRepeatsByTickId() {
        long v = version();
        String tickId = id("manual");
        String body = "{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":" + v + "}";
        post(presenter, "/clock/tick", body).then().statusCode(200).body("value.tickId", equalTo(tickId))
                .body("value.kind", equalTo("presenter")).body("value.clockVersion", equalTo((int) v));
        post(presenter, "/clock/tick", body).then().statusCode(200).body("value.tickId", equalTo(tickId));
        post(presenter, "/clock/tick", "{\"tickId\":\"" + tickId + "\",\"expectedClockVersion\":" + (v + 1) + "}")
                .then().statusCode(409);
    }

    @Test
    void theDocumentClockReadsTheRunClockAfterAnAdvance() {
        long v = version();
        post(presenter, "/clock/advance", "{\"commandId\":\"" + id("doc") + "\",\"expectedClockVersion\":" + v
                + ",\"bySeconds\":7}").then().statusCode(200);
        var run = holder.activeRun();
        RunContext ctx = new RunContext(run.environmentId(), run.runId(), "test");
        ClockReading reading = holder.clock().now(run.environmentId(), run.runId()).orElseThrow();
        assertEquals(Instant.parse(get(presenter, "/clock").jsonPath().getString("value.now")), reading.now());
        assertEquals(reading.now(), runClockDocuments.now(ctx).orElseThrow());
        assertEquals(reading.now(), documentClock.now(ctx).orElseThrow());
    }

    @Test
    void readinessReportsTheClockCheckAndItsHandlers() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'clock' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'clock' }.data.handlers",
                        equalTo("captured-outbox,lifecycle-documents,stock-release"))
                .body("checks.find { it.name == 'clock' }.data.startup", equalTo("completed"));
    }
}
