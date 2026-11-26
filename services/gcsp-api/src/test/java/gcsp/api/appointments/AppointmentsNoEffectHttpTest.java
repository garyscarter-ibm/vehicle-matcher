package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** A real offer refusal before intent, then fresh deliberate recovery over signed-JWT HTTP and PostgreSQL. */
@QuarkusTest
@TestProfile(F521HttpProfile.class)
class AppointmentsNoEffectHttpTest {
    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @AfterEach
    void resetFault() {
        F521AppointmentsWiring.HTTP_CONTROL.set(null);
    }

    @Test
    void offerRefusalHasNoEffectAndFreshCommandAtUnchangedVersionSucceedsOnce() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ApptHttp http = new ApptHttp(signingJwk);
        String order = ApptHttp.id();
        String refusedCommand = "cmd-" + ApptHttp.id();
        String freshCommand = "cmd-" + ApptHttp.id();
        var run = persistence.guard().currentRun();
        ApptHttpPorts.STAGES.order(order, "employee-paula", 4);
        http.as("presenter").body(ApptHttp.JSON.createObjectNode().put("tickId", "t-" + ApptHttp.id())
                .put("now", ApptHttp.nextTick(dataSource.get(), persistence).toString()).toString())
                .post(BASE + "/presenter/appointments/ticks").then().statusCode(200);

        JsonNode initial = read(http, order);
        assertEquals(0, initial.path("version").asLong());
        assertEquals("not-requested", initial.path("state").asText());
        assertTrue(initial.path("offeredSlots").size() > 0);
        String slot = initial.path("offeredSlots").get(0).path("slotId").asText();
        assertCounts(order, refusedCommand, 0, 0, 0);

        F521AppointmentsWiring.HTTP_CONTROL.set(new F521AppointmentsWiring.Control(run.environmentId(), run.runId(), order, true, false));
        Response refused = http.as("paula").body(command(refusedCommand, order, slot)).post(BASE + "/appointments/request");
        assertEquals(503, refused.statusCode(), refused.asString());
        assertEquals("offer-unavailable", body(refused).path("code").asText());
        assertTrue(body(refused).path("retryable").asBoolean());
        assertCounts(order, refusedCommand, 0, 0, 0);
        assertEquals(0, read(http, order).path("version").asLong());

        F521AppointmentsWiring.HTTP_CONTROL.set(new F521AppointmentsWiring.Control(run.environmentId(), run.runId(), order, false, false));
        JsonNode recovered = read(http, order);
        assertEquals(0, recovered.path("version").asLong());
        assertEquals("not-requested", recovered.path("state").asText());
        assertEquals(slot, recovered.path("offeredSlots").get(0).path("slotId").asText());
        assertCounts(order, refusedCommand, 0, 0, 0);

        Response success = http.as("paula").body(command(freshCommand, order, slot)).post(BASE + "/appointments/request");
        assertEquals(200, success.statusCode(), success.asString());
        assertEquals("requested", body(success).path("value").path("state").asText());
        assertCounts(order, freshCommand, 1, 1, 1);
        assertEquals(0, receiptCount(refusedCommand));
        Response repeated = http.as("paula").body(command(freshCommand, order, slot)).post(BASE + "/appointments/request");
        assertEquals(200, repeated.statusCode(), repeated.asString());
        assertEquals(success.asString(), repeated.asString());
        assertCounts(order, freshCommand, 1, 1, 1);
    }

    private JsonNode read(ApptHttp http, String order) throws Exception {
        Response result = http.as("paula").get(BASE + "/appointments?orderUuid=" + order);
        assertEquals(200, result.statusCode(), result.asString());
        return body(result).path("value");
    }

    private static String command(String id, String order, String slot) {
        return ApptHttp.JSON.createObjectNode().put("commandId", id).put("orderUuid", order)
                .put("slotId", slot).put("expectedVersion", 0).toString();
    }

    private long receiptCount(String command) throws Exception {
        var run = persistence.guard().currentRun();
        return ApptHttp.count(dataSource.get(), "SELECT count(*) FROM command_receipts WHERE environment_id = ? AND run_id = ? "
                + "AND actor_id = ? AND command_id = ? AND command_type = 'appointment.request'",
                run.environmentId(), run.runId(), "employee-paula", command);
    }

    private void assertCounts(String order, String command, long appointments, long intents, long receipts) throws Exception {
        var run = persistence.guard().currentRun();
        assertEquals(appointments, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM appointments "
                + "WHERE environment_id = ? AND run_id = ? AND order_uuid = ?", run.environmentId(), run.runId(), order));
        assertEquals(intents, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM pending_operations "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND operation_type = 'lifecycle-appointment-request'",
                run.environmentId(), run.runId(), AppointmentIds.operationId(run.runId(), order, "request")));
        assertEquals(receipts, receiptCount(command));
    }
}
