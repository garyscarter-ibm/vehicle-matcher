package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static gcsp.api.appointments.ReturnJourneySteps.PLAN;
import static gcsp.api.appointments.ReturnJourneySteps.handler;
import static gcsp.api.appointments.ReturnJourneySteps.requestJson;
import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import gcsp.api.returns.HandoverPort;
import gcsp.api.returns.OrderingReturnSource;
import gcsp.api.returns.ReturnSelection;
import gcsp.api.returns.ReturnSourcePort;
import gcsp.api.returns.ReturnStartup;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.Arc;
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

/** The deployed-default return journey (canonical policy: no proposal, no outcome) on the started app and real ports. */
@QuarkusTest
@TestProfile(ReturnJourneyProfile.class)
class ReturnJourneyHttpTest {

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
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_retjourney_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    private static Class<?> beanClass(Class<?> type) {
        return Arc.container().instance(type).getBean().getBeanClass();
    }

    private static void assertCarUnchanged(Map<String, Object> rel) {
        if (rel == null) return;
        assertEquals("on-order", rel.get("newStatus"), rel.toString());
        assertTrue(rel.get("oldStatus") == null || "held".equals(rel.get("oldStatus")), rel.toString());
    }

    @Test
    void theDeployedDefaultReturnJourneyChangesTheCurrentCarOnlyAtTheHandover() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        ApptHttp http = new ApptHttp(signingJwk);
        ReturnJourneySteps j = new ReturnJourneySteps(http, dataSource.get(), persistence);

        // 1. The ports are the real adapters; the deployed lifecycle block selects synthetic and the canonical policy.
        assertEquals(OrderingReturnSource.class, beanClass(ReturnSourcePort.class));
        assertEquals(ReturnsHandover.class, beanClass(HandoverPort.class));
        assertEquals("canonical", selection.policyMode());
        assertEquals("synthetic", selection.providerName());
        Response health = given().get("/q/health/ready");
        JsonNode returnsCheck = null;
        for (JsonNode c : body(health).get("checks")) if ("returns".equals(c.get("name").asText())) returnsCheck = c;
        assertTrue(returnsCheck != null && "UP".equals(returnsCheck.get("status").asText()), health.asString());
        JsonNode data = returnsCheck.get("data");
        assertEquals("ordering", data.get("source").asText());
        assertEquals("appointments", data.get("handover").asText());
        assertEquals("canonical", data.get("policy").asText());
        assertEquals("synthetic", data.get("provider").asText());
        j.startOrder();
        String order = j.order;
        var run = persistence.guard().currentRun();
        assertEquals(0, j.count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ?",
                run.environmentId(), run.runId()));
        Response initialPlan = j.plan("paula", order);
        assertEquals(200, initialPlan.statusCode(), initialPlan.asString());
        Response initialProgress = j.post("presenter", "/presenter/returns/progress",
                "{\"commandId\":\"rj-progress-before-supply\"}");
        assertEquals(200, initialProgress.statusCode(), initialProgress.asString());
        Response unknown = j.plan("paula", "no-such-order");
        assertEquals(404, unknown.statusCode(), unknown.asString());

        // 2. The plan carries the order's source reference and the replaced contract; the handover is not ready yet.
        String operationId = j.text("SELECT operation_id FROM selection_orders WHERE order_uuid = ?", order);
        String entitlementSlot = j.text("SELECT entitlement_slot_id FROM selection_orders WHERE order_uuid = ?", order);
        JsonNode first = j.planValue("paula", order);
        assertEquals("not-planned", first.get("state").asText());
        assertEquals(operationId, first.get("source").get("reference").asText());
        assertEquals("current:employee-paula", first.get("oldContractId").asText());
        assertEquals(entitlementSlot, first.get("vehicleSlotId").asText());
        for (JsonNode choice : first.get("choices")) {
            assertFalse(choice.get("available").asBoolean(), choice.toString());
            assertEquals("Confirm your new car's handover first.", choice.get("reason").asText());
        }
        assertEquals("on-order", first.get("relationship").get("newCar").get("status").asText());
        assertEquals("held", first.get("relationship").get("oldCar").get("status").asText());
        assertEquals(200, j.plan("greg", order).statusCode());
        assertEquals(200, j.plan("presenter", order).statusCode());
        j.plan("alex", order).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("not-resource-owner"));

        // 3. While the handover is only requested, a return request is refused and writes nothing.
        j.requestHandover();
        Response early = j.post("paula", "/return-plan/request", requestJson("rj-early", order, "same-visit", j.handoverSlot, 0));
        assertEquals(409, early.statusCode(), early.asString());
        assertEquals("handover-not-ready", body(early).get("code").asText());
        assertEquals(0, j.count("SELECT count(*) FROM return_plans WHERE order_uuid = ?", order));

        // 4. Scheduled: same-visit offers exactly the handover slot, and the request is pinned and idempotent.
        JsonNode scheduled = j.scheduleHandover();
        assertEquals(j.t1, Instant.parse(j.clock().get("now").asText()));
        assertEquals(0, j.count("SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ?",
                run.environmentId(), run.runId()));
        Response advancedProgress = j.post("presenter", "/presenter/returns/progress",
                "{\"commandId\":\"rj-progress-after-advance\"}");
        assertEquals(200, advancedProgress.statusCode(), advancedProgress.asString());
        JsonNode offer = j.planValue("paula", order);
        assertEquals("not-planned", offer.get("state").asText());
        assertEquals(1, offer.get("offeredSlots").get("same-visit").size());
        assertEquals(j.handoverSlot, offer.get("offeredSlots").get("same-visit").get(0).get("slotId").asText());
        assertEquals("scheduled", offer.get("handover").get("state").asText());
        String requestBody = requestJson("rj-same", order, "same-visit", j.handoverSlot, 0);
        Response requested = j.post("paula", "/return-plan/request", requestBody);
        assertEquals(200, requested.statusCode(), requested.asString());
        JsonNode plan = body(requested).get("value");
        assertEquals("return-requested", plan.get("state").asText());
        assertEquals("same-visit", plan.get("choice").asText());
        assertEquals(j.handoverSlot, plan.get("requestedSlot").get("slotId").asText());
        assertTrue(plan.get("slot").isNull(), plan.get("slot").toString());
        assertEquals("demo-collection-centre", plan.get("location").get("locationId").asText());
        assertEquals("current:employee-paula", plan.get("oldContractId").asText());
        assertEquals("current:employee-paula", plan.get("currentCar").get("contractId").asText());
        assertEquals(operationId, plan.get("source").get("reference").asText());
        assertEquals(2, plan.get("version").asLong());
        assertEquals(requested.asString(), j.post("paula", "/return-plan/request", requestBody).asString());
        Response changed = j.post("paula", "/return-plan/request", requestJson("rj-same", order, "same-visit", j.handoverSlot, 7));
        assertEquals(409, changed.statusCode(), changed.asString());
        assertEquals("command-input-changed", body(changed).get("code").asText());
        for (String who : new String[] {"alex", "greg", "presenter"}) {
            Response denied = j.post(who, "/return-plan/request", requestJson("rj-" + who, order, "same-visit", j.handoverSlot, 1));
            assertEquals(403, denied.statusCode(), who + denied.asString());
        }
        long plans = j.count("SELECT count(*) FROM return_plans WHERE order_uuid = ?", order);
        long ops = j.count("SELECT count(*) FROM return_operations WHERE order_uuid = ?", order);
        Response made = j.post("paula", "/return-plan/accept", ReturnJourneySteps.acceptJson("rj-made-up", order, "no-such-proposal", 2));
        assertEquals(409, made.statusCode(), made.asString());
        assertEquals("no-change-proposed", body(made).get("code").asText());
        assertEquals(plans, j.count("SELECT count(*) FROM return_plans WHERE order_uuid = ?", order));
        assertEquals(ops, j.count("SELECT count(*) FROM return_operations WHERE order_uuid = ?", order));
        assertEquals(1, plans);
        assertCarUnchanged(j.relationship(order));

        // 5. Restart while the retailer's return confirmation is pending: nothing is written, the replay is the same.
        long receipts = j.count("SELECT count(*) FROM return_provider_receipts");
        assertEquals(1, receipts);
        j.restart(schema, selection, sources, handovers, startup);
        assertEquals("return-requested", j.planValue("paula", order).get("state").asText());
        assertEquals(receipts, j.count("SELECT count(*) FROM return_provider_receipts"));
        assertEquals(requested.asString(), j.post("paula", "/return-plan/request", requestBody).asString());
        assertCarUnchanged(j.relationship(order));

        // 6. The retailer confirms on the presenter tick; the car still does not change.
        JsonNode confirmTick = j.advanceAndTick(j.t1.plusSeconds(1801));
        assertEquals(1, handler(confirmTick, "lifecycle-return-outcomes").get("applied").asInt());
        JsonNode confirmed = j.planValue("paula", order);
        assertEquals("return-scheduled", confirmed.get("state").asText());
        assertEquals(j.handoverSlot, confirmed.get("slot").get("slotId").asText());
        assertEquals(1, j.count("SELECT count(*) FROM return_provider_receipts WHERE step = 'confirm'"));
        assertCarUnchanged(j.relationship(order));

        // 7. The handover completes; until return progress runs the current car is unchanged.
        JsonNode completed = j.completeHandover(scheduled);
        assertCarUnchanged(j.relationship(order));
        assertEquals(0, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ?", order));

        // 8. The next tick applies the handover once: the new car is collected, the old car is still held.
        JsonNode applied = j.advanceAndTick(j.slotStart.plusSeconds(60));
        assertEquals(1, handler(applied, "lifecycle-return-outcomes").get("applied").asInt());
        Map<String, Object> rel = j.relationship(order);
        assertEquals("collected", rel.get("newStatus"));
        assertEquals(Instant.parse(completed.get("outcome").get("at").asText()), rel.get("newCollectedAt"));
        assertEquals(completed.get("outcome").get("providerReference").asText(), rel.get("newProviderReference"));
        assertEquals("held", rel.get("oldStatus"));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ?", order));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ? AND event_type = 'handover-completed'", order));
        JsonNode shown = j.planValue("greg", order).get("relationship");
        assertEquals("collected", shown.get("newCar").get("status").asText());
        JsonNode account = j.accountRelationships("paula");
        assertEquals(1, account.size(), String.valueOf(account));
        assertEquals(order, account.get(0).get("orderUuid").asText());
        assertEquals("collected", account.get(0).get("newCar").get("status").asText());
        assertEquals("current:employee-paula", account.get(0).get("oldCar").get("contractId").asText());
        assertEquals("held", account.get(0).get("oldCar").get("status").asText());
        assertNull(j.accountRelationships("alex"));

        // 9. A repeat tick and the presenter's progress apply nothing more, and a second restart changes nothing.
        long version = (Long) rel.get("version");
        JsonNode again = j.advanceAndTick(j.slotStart.plusSeconds(120));
        assertEquals(0, handler(again, "lifecycle-return-outcomes").get("applied").asInt());
        Response progress = j.post("presenter", "/presenter/returns/progress", "{\"commandId\":\"rj-progress\"}");
        assertEquals(200, progress.statusCode(), progress.asString());
        assertEquals(0, body(progress).get("value").get("applied").asInt());
        assertEquals(version, (Long) j.relationship(order).get("version"));
        assertEquals(1, j.count("SELECT count(*) FROM current_car_events WHERE order_uuid = ?", order));
        String before = j.evidence(order, "greg");
        j.restart(schema, selection, sources, handovers, startup);
        assertEquals(before, j.evidence(order, "greg"));
        assertEquals(0, j.count("SELECT count(*) FROM pending_operations WHERE state IN ('intent', 'pending')"));

        // 10. A run-clock read failure is translated into the returns' existing unavailable responses.
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            c.setSchema(schema);
            st.execute("ALTER TABLE run_clocks RENAME TO run_clocks_unreadable");
        }
        Response unreadablePlan = j.plan("paula", order);
        assertEquals(503, unreadablePlan.statusCode(), unreadablePlan.asString());
        assertEquals("return-plan-unavailable", body(unreadablePlan).get("code").asText(), unreadablePlan.asString());
        Response unreadableProgress = j.post("presenter", "/presenter/returns/progress",
                "{\"commandId\":\"rj-progress-unreadable-clock\"}");
        assertEquals(503, unreadableProgress.statusCode(), unreadableProgress.asString());
        assertEquals("database-unavailable", body(unreadableProgress).get("code").asText(), unreadableProgress.asString());
    }
}
