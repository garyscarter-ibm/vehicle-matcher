package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.body;
import static gcsp.api.appointments.ReturnJourneySteps.acceptJson;
import static gcsp.api.appointments.ReturnJourneySteps.handler;
import static gcsp.api.appointments.ReturnJourneySteps.requestJson;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import gcsp.api.returns.HandoverPort;
import gcsp.api.returns.ReturnSelection;
import gcsp.api.returns.ReturnSourcePort;
import gcsp.api.returns.ReturnStartup;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/** The return journey under a retained GCSP_RETURNS_POLICY_FILE that proposes a change and records the outcome. */
@QuarkusTest
@TestProfile(ReturnOutcomeJourneyProfile.class)
class ReturnOutcomeJourneyHttpTest {

    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ReturnSelection selection;

    @Inject
    ReturnSourcePort sources;

    @Inject
    HandoverPort handovers;

    @Inject
    ReturnStartup startup;

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_retoutcome_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    @Test
    void theRetainedReturnPolicyProposesAcceptsAndConfirmsTheReturnOfTheOldCar() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        ApptHttp http = new ApptHttp(signingJwk);
        ReturnJourneySteps j = new ReturnJourneySteps(http, dataSource.get(), persistence);

        // 1. The explicit policy file is in force; the order's handover is scheduled and the same-visit return requested.
        assertEquals("file", selection.policyMode());
        assertEquals("synthetic", selection.providerName());
        j.startOrder();
        String order = j.order;
        String operationId = j.text("SELECT operation_id FROM selection_orders WHERE order_uuid = ?", order);
        j.requestHandover();
        JsonNode scheduled = j.scheduleHandover();
        Response requested = j.post("paula", "/return-plan/request", requestJson("rb-req", order, "same-visit", j.handoverSlot, 0));
        assertEquals(200, requested.statusCode(), requested.asString());
        assertEquals("return-requested", body(requested).get("value").get("state").asText());

        // 2. The retailer proposes another time at the confirmation tick; nobody but the owner may accept it.
        j.advanceAndTick(j.t1.plusSeconds(1801));
        JsonNode proposed = j.planValue("paula", order);
        assertEquals("return-requested", proposed.get("state").asText());
        assertEquals("change-proposed", proposed.get("appointment").get("state").asText());
        String proposalId = proposed.get("proposalId").asText();
        assertNotNull(proposalId);
        assertNotEquals(j.handoverSlot, proposed.get("proposedSlot").get("slotId").asText());
        assertTrue(proposed.get("slot").isNull());
        long version = proposed.get("version").asLong();
        for (String who : new String[] {"alex", "greg", "presenter"}) {
            Response denied = j.post(who, "/return-plan/accept", acceptJson("rb-" + who, order, proposalId, version));
            assertEquals(403, denied.statusCode(), who + denied.asString());
        }
        assertEquals(0, j.count("SELECT count(*) FROM return_operations WHERE order_uuid = ? AND step = 'accept'", order));
        Response wrong = j.post("paula", "/return-plan/accept", acceptJson("rb-wrong", order, "not-the-proposal", version));
        assertEquals(400, wrong.statusCode(), wrong.asString());
        assertEquals("invalid-return-command", body(wrong).get("code").asText());

        // 3. Paula accepts: the return is scheduled at the proposed slot; the replay is identical; the car is unchanged.
        String acceptBody = acceptJson("rb-accept", order, proposalId, version);
        Response accepted = j.post("paula", "/return-plan/accept", acceptBody);
        assertEquals(200, accepted.statusCode(), accepted.asString());
        JsonNode plan = body(accepted).get("value");
        assertEquals("return-scheduled", plan.get("state").asText());
        assertEquals(proposed.get("proposedSlot").get("slotId").asText(), plan.get("slot").get("slotId").asText());
        assertEquals(operationId, plan.get("source").get("reference").asText());
        assertEquals(accepted.asString(), j.post("paula", "/return-plan/accept", acceptBody).asString());
        assertNull(j.relationship(order));
        Instant slotEnd = Instant.parse(plan.get("slot").get("end").asText());

        // 4. The handover completes and the next tick makes the new car current; the old car is still held.
        JsonNode completed = j.completeHandover(scheduled);
        JsonNode applied = j.advanceAndTick(j.slotStart.plusSeconds(60));
        assertEquals(1, handler(applied, "lifecycle-return-outcomes").get("applied").asInt());
        Map<String, Object> rel = j.relationship(order);
        assertEquals("collected", rel.get("newStatus"));
        assertEquals(Instant.parse(completed.get("outcome").get("at").asText()), rel.get("newCollectedAt"));
        assertEquals("held", rel.get("oldStatus"));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ?", order));
        assertEquals("return-scheduled", j.planValue("paula", order).get("state").asText());
        assertTrue(j.planValue("paula", order).get("outcome").isNull());

        // 5. Before the slot's end plus the policy delay nothing is recorded; after it the old car is returned.
        JsonNode early = j.advanceAndTick(slotEnd.plusSeconds(1799));
        assertEquals(0, handler(early, "lifecycle-return-outcomes").get("applied").asInt());
        assertEquals("held", j.relationship(order).get("oldStatus"));
        JsonNode late = j.advanceAndTick(slotEnd.plusSeconds(1801));
        assertEquals(1, handler(late, "lifecycle-return-outcomes").get("applied").asInt());
        JsonNode done = j.planValue("greg", order);
        assertEquals("returned", done.get("state").asText());
        JsonNode outcome = done.get("outcome");
        assertEquals("returned", outcome.get("state").asText());
        assertEquals("current:employee-paula", outcome.get("oldContractId").asText());
        assertEquals(operationId, done.get("source").get("reference").asText());
        rel = j.relationship(order);
        assertEquals("returned", rel.get("oldStatus"));
        assertEquals(Instant.parse(outcome.get("at").asText()), rel.get("oldReturnedAt"));
        assertEquals(outcome.get("providerReference").asText(), rel.get("oldProviderReference"));
        assertEquals("collected", rel.get("newStatus"));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ? AND event_type = 'return-confirmed'", order));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ? AND event_type = 'handover-completed'", order));
        JsonNode account = j.accountRelationships("paula");
        assertEquals(1, account.size(), String.valueOf(account));
        assertEquals("returned", account.get(0).get("oldCar").get("status").asText());
        assertEquals("collected", account.get(0).get("newCar").get("status").asText());
        assertEquals("current:employee-paula", account.get(0).get("oldCar").get("contractId").asText());
        assertEquals(2, account.get(0).get("changes").size());
        assertNull(j.accountRelationships("alex"));

        // 6. A restart leaves everything identical, and a further tick and progress write nothing.
        String before = j.evidence(order, "greg");
        j.restart(schema, selection, sources, handovers, startup);
        assertEquals(before, j.evidence(order, "greg"));
        JsonNode again = j.advanceAndTick(slotEnd.plusSeconds(3600));
        assertEquals(0, handler(again, "lifecycle-return-outcomes").get("applied").asInt());
        Response progress = j.post("presenter", "/presenter/returns/progress", "{\"commandId\":\"rb-progress\"}");
        assertEquals(200, progress.statusCode(), progress.asString());
        assertEquals(0, body(progress).get("value").get("applied").asInt());
        assertEquals(before, j.evidence(order, "greg"));
        assertFalse(j.count("SELECT count(*) FROM pending_operations WHERE state IN ('intent', 'pending')") > 0);
    }
}
