package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ws.rs.core.Response;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Every AppointmentResult variant maps to one HTTP status and the contract envelope, with no container. */
class AppointmentsRenderTest {

    static final ObjectNode MODEL = ApptFixture.JSON.createObjectNode();
    static final String ORDER = "order-1";

    static JsonNode body(Response r) {
        return ApptFixture.JSON.valueToTree(r.getEntity());
    }

    @Test
    void okIs200AndAnUncertainCommandIs202WithItsOperationId() {
        ObjectNode model = MODEL.deepCopy();
        model.putNull("pending");
        Response ok = AppointmentsResource.render(new AppointmentResult.Ok(model), "run-1", ORDER);
        assertEquals(200, ok.getStatus());
        assertEquals("ok", body(ok).get("status").asText());

        ObjectNode uncertain = MODEL.deepCopy();
        uncertain.putObject("pending").put("step", "request").put("reason", "Waiting for the provider to confirm the last update.");
        Response read = AppointmentsResource.render(new AppointmentResult.Ok(uncertain), "run-1", null);
        assertEquals(200, read.getStatus(), "a read of a pending appointment is not a 202");
        Response pending = AppointmentsResource.render(new AppointmentResult.Ok(uncertain), "run-1", ORDER);
        assertEquals(202, pending.getStatus());
        JsonNode p = body(pending);
        assertEquals("pending", p.get("status").asText());
        assertEquals("provider-outcome-uncertain", p.get("code").asText());
        assertEquals(AppointmentIds.operationId("run-1", ORDER, "request"), p.get("operationId").asText());
        assertFalse(p.get("retryable").asBoolean());
        assertEquals(uncertain, p.get("value"));

        Response commit = AppointmentsResource.render(new AppointmentResult.Pending("op-9"), "run-1", ORDER);
        assertEquals(202, commit.getStatus());
        assertEquals("op-9", body(commit).get("operationId").asText());
    }

    @Test
    void everyRefusalCarriesStatusCodeReasonAndRetryable() {
        Response invalid = AppointmentsResource.render(new AppointmentResult.Invalid("invalid-appointment-command",
                List.of(new AppointmentResult.Reason("slotId", "Choose one of the offered slots."))), "run-1", ORDER);
        assertEquals(400, invalid.getStatus());
        assertEquals("slotId", body(invalid).get("reasons").get(0).get("field").asText());

        assertEquals(403, AppointmentsResource.render(new AppointmentResult.Forbidden("role-required", "No."), "r", ORDER).getStatus());
        JsonNode nf = body(AppointmentsResource.render(new AppointmentResult.NotFound("order", "No order was found."), "r", ORDER));
        assertEquals("order-not-found", nf.get("code").asText());

        ObjectNode extra = ApptFixture.JSON.createObjectNode().put("currentVersion", 3).put("status", "tampered")
                .put("code", "tampered").put("nextStep", "Wait.");
        Response conflict = AppointmentsResource.render(new AppointmentResult.Conflict("stale-version", "Changed.", extra), "r", ORDER);
        assertEquals(409, conflict.getStatus());
        JsonNode c = body(conflict);
        assertEquals("conflict", c.get("status").asText());
        assertEquals("stale-version", c.get("code").asText());
        assertEquals(3, c.get("currentVersion").asInt());
        assertEquals("Wait.", c.get("nextStep").asText());

        ObjectNode appointment = MODEL.deepCopy().put("state", "not-requested");
        Response unsupported = AppointmentsResource.render(
                new AppointmentResult.Unsupported("live-appointments-unsupported", "Not connected.", appointment), "r", ORDER);
        assertEquals(422, unsupported.getStatus());
        assertEquals(appointment, body(unsupported).get("appointment"));
        assertFalse(body(AppointmentsResource.render(new AppointmentResult.Unsupported("x", "y", null), "r", ORDER)).has("appointment"));

        Response down = AppointmentsResource.render(new AppointmentResult.Unavailable("appointment-policy-unavailable", "Down.", true),
                "r", ORDER);
        assertEquals(503, down.getStatus());
        assertTrue(body(down).get("retryable").asBoolean());
        assertEquals("unavailable", body(down).get("status").asText());
    }
}
