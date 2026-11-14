package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The appointment journey over HTTP with real JWTs, the synthetic provider and the native test database. */
@QuarkusTest
@TestProfile(ApptHttpProfiles.Synthetic.class)
class AppointmentsHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AppointmentsStartup startup;

    private ApptHttp http;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        http = new ApptHttp(signingJwk);
        ApptHttpPorts.READINESS.mode = StubReadiness.Mode.NOT_READY;
    }

    private Instant tick(Instant at) throws Exception {
        Response r = http.as("presenter").body("{\"tickId\":\"t-" + ApptHttp.id() + "\",\"now\":\"" + at + "\"}")
                .post(BASE + "/presenter/appointments/ticks");
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode v = body(r).get("value");
        assertEquals(at.toString().substring(0, 19), v.get("tick").get("now").asText().substring(0, 19));
        assertTrue(v.get("summary").has("orders"), v.toString());
        return at;
    }

    private Response get(String who, String order) throws Exception {
        return http.as(who).get(BASE + "/appointments?orderUuid=" + order);
    }

    private static String command(String commandId, String order, String field, String value, long version) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + order + "\"" + (field == null ? "" : ",\"" + field
                + "\":\"" + value + "\"") + ",\"expectedVersion\":" + version + "}";
    }

    @Test
    void theWholeJourneyFromOfferToCompletion() throws Exception {
        String order = ApptHttp.id();
        ApptHttpPorts.STAGES.order(order, "employee-paula", 4);
        Instant t0 = tick(ApptHttp.nextTick(dataSource.get(), persistence));

        JsonNode first = body(get("paula", order)).get("value");
        assertEquals("not-requested", first.get("state").asText());
        assertEquals(0, first.get("version").asLong());
        assertFalse(first.get("booked").asBoolean());
        assertTrue(first.get("offeredSlots").size() > 0);
        assertEquals("synthetic", first.get("provider").get("mode").asText());
        assertTrue(first.get("fictional").asBoolean());
        String slot = first.get("offeredSlots").get(0).get("slotId").asText();

        String requestId = "cmd-" + ApptHttp.id();
        Response requested = http.as("paula").body(command(requestId, order, "slotId", slot, 0))
                .post(BASE + "/appointments/request");
        assertEquals(200, requested.statusCode(), requested.asString());
        JsonNode model = body(requested).get("value");
        assertEquals("requested", model.get("state").asText());
        assertFalse(model.get("booked").asBoolean());
        Response repeated = http.as("paula").body(command(requestId, order, "slotId", slot, 0))
                .post(BASE + "/appointments/request");
        assertEquals(200, repeated.statusCode());
        assertEquals(requested.asString(), repeated.asString());

        http.as("alex").body(command("cmd-" + ApptHttp.id(), order, "slotId", slot, 0)).post(BASE + "/appointments/request")
                .then().statusCode(403).body("status", equalTo("forbidden")).body("retryable", equalTo(false));
        get("alex", order).then().statusCode(403).body("code", equalTo("not-resource-owner"));
        assertEquals(200, get("greg", order).statusCode());
        assertEquals(200, get("presenter", order).statusCode());

        for (String who : new String[] {"greg", "presenter"}) {
            http.as(who).body(command("cmd-" + ApptHttp.id(), order, "slotId", slot, 0)).post(BASE + "/appointments/request")
                    .then().statusCode(403).body("code", equalTo("role-required"));
        }
        http.as("presenter").body(command("cmd-" + ApptHttp.id(), order, null, null, 1)).post(BASE + "/appointments/complete")
                .then().statusCode(403).body("code", equalTo("role-required"));
        http.as("paula").body(command("cmd-" + ApptHttp.id(), order, null, null, 1)).post(BASE + "/appointments/complete")
                .then().statusCode(403).body("code", equalTo("role-required"));

        for (String forged : new String[] {"employeeId", "runId", "roles"}) {
            String raw = "{\"commandId\":\"cmd-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order + "\",\"slotId\":\"" + slot
                    + "\",\"expectedVersion\":1,\"" + forged + "\":\"x\"}";
            http.as("paula").body(raw).post(BASE + "/appointments/request").then().statusCode(400)
                    .body("status", equalTo("invalid")).body("reasons[0].field", equalTo(forged));
        }
        http.as("paula").get(BASE + "/appointments?orderUuid=" + order + "&runId=run-9").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        http.as("paula").get(BASE + "/appointments?orderUuid=" + order + "&orderUuid=" + order).then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        http.as("paula").body("[1]").post(BASE + "/appointments/request").then().statusCode(400)
                .body("reasons[0].field", equalTo("body"));
        http.as("paula").body("").post(BASE + "/appointments/request").then().statusCode(400);
        http.as("paula").body("{}").post(BASE + "/appointments/request?x=1").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));

        long version = body(get("paula", order)).get("value").get("version").asLong();
        http.as("paula").body(command("cmd-" + ApptHttp.id(), order, "proposalId", "proposal-1", version))
                .post(BASE + "/appointments/accept").then().statusCode(409).body("code", equalTo("no-change-proposed"));

        tick(t0.plusSeconds(ApptHarness.DELAY + 1));
        JsonNode scheduled = body(get("paula", order)).get("value");
        assertEquals("scheduled", scheduled.get("state").asText());
        assertTrue(scheduled.get("booked").asBoolean());
        Instant slotStart = Instant.parse(scheduled.get("slot").get("start").asText());
        long v = scheduled.get("version").asLong();

        String completeId = "cmd-" + ApptHttp.id();
        Response notReady = http.as("greg").body(command(completeId, order, null, null, v)).post(BASE + "/appointments/complete");
        assertEquals(409, notReady.statusCode(), notReady.asString());
        JsonNode nr = body(notReady);
        assertEquals("handover-not-ready", nr.get("code").asText());
        assertEquals("documents-pending", nr.get("readiness").get("state").asText());
        assertEquals("scheduled", nr.get("appointment").get("state").asText());

        ApptHttpPorts.READINESS.mode = StubReadiness.Mode.READY;
        Response early = http.as("greg").body(command(completeId, order, null, null, v)).post(BASE + "/appointments/complete");
        assertEquals(409, early.statusCode(), early.asString());
        assertEquals("appointment-outcome-too-early", body(early).get("code").asText());
        assertEquals(slotStart.toString(), body(early).get("availableFrom").asText().replace(".000Z", "Z"));

        tick(slotStart);
        http.as("greg").body(command("cmd-" + ApptHttp.id(), order, null, null, v + 7)).post(BASE + "/appointments/complete")
                .then().statusCode(409).body("code", equalTo("stale-version")).body("currentVersion", equalTo((int) v));
        Response done = http.as("greg").body(command(completeId, order, null, null, v)).post(BASE + "/appointments/complete");
        assertEquals(200, done.statusCode(), done.asString());
        JsonNode completed = body(done).get("value");
        assertEquals("completed", completed.get("state").asText());
        assertEquals("completed", completed.get("outcome").get("state").asText());
        assertTrue(completed.get("outcome").get("providerReference").asText().startsWith("SYN-APT-"));
        Response again = http.as("greg").body(command(completeId, order, null, null, v)).post(BASE + "/appointments/complete");
        assertEquals(200, again.statusCode());
        assertEquals(done.asString(), again.asString());
        http.as("greg").body(command(completeId, order, null, null, v + 5)).post(BASE + "/appointments/complete")
                .then().statusCode(409).body("code", equalTo("command-input-changed"));
        assertEquals(1, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = "
                + "'appointment-completed' AND payload->>'orderUuid' = ?", order));
        assertNotEquals(requested.asString(), done.asString());
    }

    @Test
    void anAnonymousOrBadlyAuthenticatedCallerGetsJson401() {
        String order = ApptHttp.id();
        given().get(BASE + "/appointments?orderUuid=" + order).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
        given().contentType("application/json").body("{}").post(BASE + "/appointments/request").then().statusCode(401);
        given().contentType("application/json").body("{}").post(BASE + "/appointments/accept").then().statusCode(401);
        given().contentType("application/json").body("{}").post(BASE + "/appointments/complete").then().statusCode(401);
        given().contentType("application/json").body("{}").post(BASE + "/presenter/appointments/ticks").then().statusCode(401);
        given().header("Authorization", "Bearer not.a.jwt").get(BASE + "/appointments?orderUuid=" + order).then()
                .statusCode(401).body(not(containsString("not.a.jwt")));
    }

    @Test
    void onlyThePresenterMayTickAndABadTickIs400() throws Exception {
        http.as("paula").body("{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\"}").post(BASE + "/presenter/appointments/ticks")
                .then().statusCode(403);
        http.as("greg").body("{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\"}").post(BASE + "/presenter/appointments/ticks")
                .then().statusCode(403);
        http.as("presenter").body("{\"tickId\":\"\",\"now\":\"yesterday\",\"runId\":\"x\"}")
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(400).body("status", equalTo("invalid"));
        http.as("presenter").body("{}").post(BASE + "/presenter/appointments/ticks?x=1").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        Instant top = ApptHttp.nextTick(dataSource.get(), persistence);
        http.as("presenter").body("{\"tickId\":\"t-" + ApptHttp.id() + "\",\"now\":\"" + top.minusSeconds(3600) + "\"}")
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(409);
    }

    @Test
    void anUnknownOrderIs404AndAnUnopenedOneIsNotEligible() throws Exception {
        tick(ApptHttp.nextTick(dataSource.get(), persistence));
        get("paula", ApptHttp.id()).then().statusCode(404).body("status", equalTo("not-found"));
        String early = ApptHttp.id();
        ApptHttpPorts.STAGES.order(early, "employee-paula", 2);
        http.as("paula").body(command("cmd-" + ApptHttp.id(), early, "slotId", "slot-20261201T0900Z", 0))
                .post(BASE + "/appointments/request").then().statusCode(409).body("code", equalTo("appointment-not-eligible"));
        String foreign = ApptHttp.id();
        ApptHttpPorts.STAGES.order(foreign, "employee-alex", 4);
        get("paula", foreign).then().statusCode(403);
    }

    @Test
    void startupReconcileRanOnceAndNeverFailedStartup() {
        assertTrue(startup.summary().equals("unavailable") || startup.summary().startsWith("reconciled:"), startup.summary());
    }
}
