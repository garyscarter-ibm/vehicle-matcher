package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.approvals.HandoverPort;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.documents.DocumentCasePort;
import gcsp.api.documents.LifecycleDocumentCases;
import gcsp.api.ordering.ActiveOrderSource;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.Arc;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * The whole handover journey over HTTP with every lifecycle port real (ordering, approvals, documents, appointments):
 * real RS256 tokens, a private schema and the run clock. Only ordering's upstream slot and cart sources are test beans.
 */
@QuarkusTest
@TestProfile(HandoverJourneyProfile.class)
class HandoverJourneyHttpTest {

    private static final String ORDERING = BASE + "/manual/order";
    private static final String PRESENTER = BASE + "/presenter";
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
    OrderStagePort stages;

    @Inject
    HandoverReadinessPort readiness;

    @Inject
    AppointmentPolicy policy;

    @Inject
    AppointmentsStartup startup;

    private ApptHttp http;
    private int seq;

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_handover_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- helpers ----

    private void sql(String statement, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(statement)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** Released stock is upstream supply (the supply release is not part of this story), so it is the one thing seeded. */
    private void seedStock() throws Exception {
        var run = persistence.guard().currentRun();
        try (Connection c = dataSource.get().getConnection()) {
            List<JsonNode> rows = new ArrayList<>(StockDbFixture.rows());
            // Alex's grade (G1-6) is not eligible for the fixture's G21 Touring cars: one more released car of an included model.
            com.fasterxml.jackson.databind.node.ObjectNode extra = rows.get(0).deepCopy();
            String id = StockDbFixture.UUID_PREFIX + "9";
            extra.put("orderUuid", id).put("orderNumber", "1000009");
            ((com.fasterxml.jackson.databind.node.ObjectNode) extra.get("facts").get("sourceKeys")).put("stockId", id);
            ((com.fasterxml.jackson.databind.node.ObjectNode) extra.get("facts").get("facts").get("eligibilityModelKey"))
                    .put("value", "U11 X1|20i");
            rows.add(extra);
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), rows);
        }
    }

    /** The real account, draft, stock, claim and review routes for a demo employee; returns the order ordering writes. */
    private String order(String who, String taken) throws Exception {
        String sub = "sub-" + who;
        JsonNode account = body(http.as(who).get(BASE + "/manual/account")).get("value");
        assertEquals("ready", account.get("state").asText());
        assertTrue(account.get("slots").get(0).get("ordering").get("enabled").asBoolean());
        String draft = StockDbFixture.complete().toString().replace("paula", who).replace("Paula Mason", who)
                .replace("2026-11-12", "2026-11-30");
        Response saved = http.as(who).body("{\"commandId\":\"draft-" + ApptHttp.id() + "\",\"expectedDraftVersion\":0,"
                + "\"expectedContextVersion\":\"" + account.get("contextVersion").asText() + "\",\"choices\":" + draft + "}")
                .post(BASE + "/manual/draft");
        assertEquals(200, saved.statusCode(), sub + " " + saved.asString());
        Response browse = http.as(who).get(BASE + "/manual/stock");
        assertEquals(200, browse.statusCode(), browse.asString());
        com.fasterxml.jackson.databind.node.ObjectNode claim = null;
        for (JsonNode d : body(browse).get("value").get("decisions")) {
            if (claim == null && "eligible".equals(d.get("gateStatus").asText()) && !d.get("orderUuid").asText().equals(taken)) {
                claim = ((com.fasterxml.jackson.databind.node.ObjectNode) d.get("claimInput")).deepCopy();
            }
        }
        assertNotNull(claim, who + " has no eligible car: " + body(browse).get("value").get("decisions"));
        String car = claim.get("orderUuid").asText();
        claim.put("commandId", "claim-" + ApptHttp.id());
        Response claimed = http.as(who).body(claim.toString()).post(BASE + "/manual/claim");
        assertEquals(200, claimed.statusCode(), claimed.asString());
        JsonNode hold = body(claimed).get("value").get("hold");
        Response reviewed = http.as(who).body("{\"commandId\":\"review-" + ApptHttp.id() + "\",\"holdId\":\""
                + hold.get("holdId").asText() + "\",\"expectedHoldVersion\":" + hold.get("version").asLong()
                + ",\"expectedDraftVersion\":1}").post(BASE + "/manual/claim/review");
        assertEquals(200, reviewed.statusCode(), reviewed.asString());
        JsonNode inReview = body(reviewed).get("value");
        String digest = body(http.as(who).get(ORDERING + "/terms")).get("value").get("termsDigest").asText();
        String json = "{\"commandId\":\"cmd-" + ApptHttp.id() + "\",\"source\":{\"type\":\"cart\",\"holdId\":\""
                + hold.get("holdId").asText() + "\",\"expectedHoldVersion\":" + inReview.get("hold").get("version").asLong()
                + ",\"expectedDraftVersion\":1},\"expectedQuoteId\":\"" + inReview.get("quote").get("quoteId").asText()
                + "\",\"expectedStockVersion\":" + inReview.get("quote").get("stockVersion").asLong() + ",\"termsDigest\":\""
                + digest + "\",\"declarations\":{\"terms\":true,\"driver\":true,\"return\":true}}";
        Response r = http.as(who).body(json).post(ORDERING);
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode v = body(r).get("value");
        assertEquals("acknowledged", v.get("status").asText());
        assertNotNull(v.get("providerReference").asText());
        assertEquals(car, v.get("selection").get("orderUuid").asText());
        return car;
    }

    private JsonNode clock() throws Exception {
        Response r = http.as("presenter").get(PRESENTER + "/clock");
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    /** Advances the run clock to the instant, then ticks it: documents, approvals and appointments all run on it. */
    private void advanceAndTick(Instant to) throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response moved = http.as("presenter").body("{\"commandId\":\"adv-" + ApptHttp.id() + "\",\"expectedClockVersion\":"
                + version + ",\"to\":\"" + to + "\"}").post(PRESENTER + "/clock/advance");
        assertEquals(200, moved.statusCode(), moved.asString());
        tick();
    }

    private void tick() throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response r = http.as("presenter").body("{\"tickId\":\"jt-" + (++seq) + "-" + ApptHttp.id() + "\",\"expectedClockVersion\":"
                + version + "}").post(PRESENTER + "/clock/tick");
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode t = body(r).get("value");
        assertEquals("completed", t.get("state").asText(), t.toString());
    }

    private Response approvalTick(long clockVersion, Instant now) throws Exception {
        String id = "ja-" + (++seq) + "-" + ApptHttp.id();
        return http.as("presenter").body("{\"commandId\":\"cmd-" + id + "\",\"tickId\":\"" + id + "\",\"now\":\"" + now
                + "\",\"clockVersion\":" + clockVersion + "}").post(PRESENTER + "/approvals/ticks");
    }

    private JsonNode progress(String who, String order) throws Exception {
        Response r = http.as(who).get(BASE + "/orders/progress?orderUuid=" + order);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    private Response appointment(String who, String order) throws Exception {
        return http.as(who).get(BASE + "/appointments?orderUuid=" + order);
    }

    private JsonNode model(String who, String order) throws Exception {
        Response r = appointment(who, order);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    private static String command(String order, String slot, long version) {
        return "{\"commandId\":\"cmd-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order + "\"" + (slot == null ? "" : ",\"slotId\":\""
                + slot + "\"") + ",\"expectedVersion\":" + version + "}";
    }

    private Response post(String who, String path, String json) throws Exception {
        return http.as(who).body(json).post(BASE + "/appointments/" + path);
    }

    private JsonNode documentReadiness(String who, String order) throws Exception {
        Response r = http.as(who).get(BASE + "/documents/readiness?orderUuid=" + order);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    private static Class<?> beanClass(Class<?> type) {
        return Arc.container().instance(type).getBean().getBeanClass();
    }

    // ---- the journey ----

    @Test
    void theWholeHandoverJourneyRunsOnTheRealPortsAndSurvivesARestart() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        http = new ApptHttp(signingJwk);

        // The lifecycle ports resolve to the real adapters: no test alternative stands in for any of them.
        assertEquals(ApprovalsOrderStage.class, beanClass(OrderStagePort.class));
        assertEquals(DocumentsHandoverReadiness.class, beanClass(HandoverReadinessPort.class));
        assertEquals(LifecycleDocumentCases.class, beanClass(DocumentCasePort.class));
        assertEquals(AppointmentHandover.class, beanClass(HandoverPort.class));
        assertEquals(ActiveOrderSource.class, beanClass(OrderSourcePort.class));
        assertEquals(PolicyServiceAppointmentPolicy.class, beanClass(AppointmentPolicy.class));

        // 1. Two employees' orders are submitted and acknowledged by ordering itself.
        seedStock();
        // Alex (grade G1-6) is eligible for fewer cars, so alex orders first and paula takes another car.
        String b = order("alex", null);
        String a = order("paula", b);
        assertEquals(2, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE order_uuid IN (?, ?)", a, b));

        JsonNode run = clock();
        Instant t0 = Instant.parse(run.get("now").asText());
        long v0 = run.get("clockVersion").asLong();
        // The appointment demo clock starts with the first presenter tick.
        http.as("presenter").body("{\"tickId\":\"j-first\",\"now\":\"" + t0 + "\"}").post(PRESENTER + "/appointments/ticks")
                .then().statusCode(200);

        // 2. Before approval the order is not eligible and a request is refused by the real stage port.
        JsonNode early = model("paula", a);
        assertFalse(early.get("eligibility").get("eligible").asBoolean());
        assertEquals(0, early.get("offeredSlots").size());
        post("paula", "request", command(a, "slot-20261201T0900Z", 0)).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("appointment-not-eligible"));
        assertEquals(200, approvalTick(v0, t0).statusCode());
        JsonNode started = model("paula", a);
        assertEquals("opening-stage-not-reached", started.get("eligibility").get("code").asText());
        assertTrue(started.get("eligibility").get("reason").asText().contains("not been sent to ordering"));
        post("paula", "request", command(a, "slot-20261201T0900Z", 0)).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("appointment-not-eligible"));
        assertEquals(0, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM appointments WHERE order_uuid IN (?, ?)", a, b));

        // 3. The presenter drives approvals ticks until both orders are sent to ordering.
        for (int i = 0; i < 20 && !("sent-to-ordering".equals(progress("greg", a).get("outcome").asText())
                && "sent-to-ordering".equals(progress("greg", b).get("outcome").asText())); i++) {
            assertEquals(200, approvalTick(v0, t0).statusCode());
        }
        JsonNode sentA = progress("paula", a);
        assertEquals("sent-to-ordering", sentA.get("outcome").asText());
        assertEquals("sent-to-ordering", progress("alex", b).get("outcome").asText());
        assertFalse(sentA.get("stages").get(sentA.get("stages").size() - 1).get("providerReference").isNull());

        // 4. Availability: the owner sees offered slots; another employee is refused; greg and the presenter read.
        JsonNode open = model("paula", a);
        assertEquals("not-requested", open.get("state").asText());
        assertTrue(open.get("eligibility").get("eligible").asBoolean());
        List<String> offered = new ArrayList<>();
        open.get("offeredSlots").forEach(s -> offered.add(s.get("slotId").asText()));
        assertTrue(offered.size() >= 3, offered.toString());
        appointment("alex", a).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("not-resource-owner"));
        assertEquals(200, appointment("greg", a).statusCode());
        assertEquals(200, appointment("presenter", a).statusCode());

        // 5. A requests the last offered slot; the repeat replays; a different slot is refused; greg and the presenter cannot.
        String slotA = offered.get(offered.size() - 1);
        String requestId = "cmd-" + ApptHttp.id();
        String requestBody = "{\"commandId\":\"" + requestId + "\",\"orderUuid\":\"" + a + "\",\"slotId\":\"" + slotA
                + "\",\"expectedVersion\":0}";
        Response requested = http.as("paula").body(requestBody).post(BASE + "/appointments/request");
        assertEquals(200, requested.statusCode(), requested.asString());
        JsonNode r1 = body(requested).get("value");
        assertEquals("requested", r1.get("state").asText());
        assertFalse(r1.get("booked").asBoolean());
        assertEquals(1, r1.get("history").size());
        assertEquals("requested", r1.get("history").get(0).get("state").asText());
        String requestRef = r1.get("history").get(0).get("providerReference").asText();
        assertTrue(requestRef.startsWith("SYN-APT-"), requestRef);
        assertEquals(requested.asString(), http.as("paula").body(requestBody).post(BASE + "/appointments/request").asString());
        post("paula", "request", command(a, offered.get(0), r1.get("version").asLong())).then().statusCode(409)
                .body("code", org.hamcrest.Matchers.equalTo("appointment-already-requested"));
        for (String who : new String[] {"greg", "presenter"}) {
            post(who, "request", command(a, slotA, 0)).then().statusCode(403)
                    .body("code", org.hamcrest.Matchers.equalTo("role-required"));
        }
        String slotB = body(appointment("alex", b)).get("value").get("offeredSlots").get(0).get("slotId").asText();
        assertEquals(200, post("alex", "request", command(b, slotB, 0)).statusCode());
        assertEquals(2, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM appointments WHERE order_uuid IN (?, ?)", a, b));

        // 6. The presenter's appointment tick past confirmDelaySeconds schedules it with its own provider reference.
        Instant t1 = t0.plusSeconds(1801);
        long cv = clock().get("clockVersion").asLong();
        assertEquals(200, http.as("presenter").body("{\"commandId\":\"adv-t1\",\"expectedClockVersion\":" + cv + ",\"to\":\"" + t1
                + "\"}").post(PRESENTER + "/clock/advance").statusCode());
        Response ticked = http.as("presenter").body("{\"tickId\":\"j-confirm\",\"now\":\"" + t1 + "\"}")
                .post(PRESENTER + "/appointments/ticks");
        assertEquals(200, ticked.statusCode(), ticked.asString());
        JsonNode scheduled = model("paula", a);
        assertEquals("scheduled", scheduled.get("state").asText());
        assertTrue(scheduled.get("booked").asBoolean());
        assertEquals(slotA, scheduled.get("slot").get("slotId").asText());
        assertEquals(List.of("requested", "scheduled"), scheduled.get("history").findValuesAsText("state"));
        String scheduleRef = scheduled.get("history").get(1).get("providerReference").asText();
        assertTrue(scheduleRef.startsWith("SYN-APT-"));
        assertNotEquals(requestRef, scheduleRef);
        Instant slotStart = Instant.parse(scheduled.get("slot").get("start").asText());
        long v = scheduled.get("version").asLong();
        assertEquals("scheduled", model("alex", b).get("state").asText());

        // 7. Completion is gated on documents: not open yet, then open with every item blocking.
        Response notOpen = post("greg", "complete", command(a, null, v));
        assertEquals(409, notOpen.statusCode(), notOpen.asString());
        assertEquals("handover-not-ready", body(notOpen).get("code").asText());
        assertEquals("not-open", body(notOpen).get("readiness").get("state").asText());
        tick();
        JsonNode blocked = documentReadiness("greg", a);
        assertTrue(blocked.get("opened").asBoolean());
        assertFalse(blocked.get("ready").asBoolean());
        Response notReady = post("greg", "complete", command(a, null, v));
        assertEquals(409, notReady.statusCode(), notReady.asString());
        JsonNode nr = body(notReady);
        assertEquals("handover-not-ready", nr.get("code").asText());
        assertEquals("retailer", nr.get("owner").asText());
        assertEquals("The retailer finishes the documents and car preparation before the handover.", nr.get("nextStep").asText());
        assertEquals("waiting", nr.get("readiness").get("state").asText());
        assertEquals(List.of("agreement-acknowledgement", "licence-check", "vehicle-preparation", "delivery-to-retailer"),
                toList(nr.get("readiness").get("blocking")));
        assertEquals("scheduled", nr.get("appointment").get("state").asText());
        post("presenter", "complete", command(a, null, v)).then().statusCode(403)
                .body("code", org.hamcrest.Matchers.equalTo("role-required"));
        post("paula", "complete", command(a, null, v)).then().statusCode(403)
                .body("code", org.hamcrest.Matchers.equalTo("role-required"));

        // 8. Documents: the employee acknowledges, then time passes until the scheme team and retailer finish.
        JsonNode docs = body(http.as("paula").get(BASE + "/documents")).get("value").get("orders").get(0);
        assertEquals(a, docs.get("orderUuid").asText());
        Response ack = http.as("paula").body("{\"commandId\":\"ack-" + ApptHttp.id() + "\",\"orderUuid\":\"" + a
                + "\",\"itemId\":\"agreement-acknowledgement\",\"expectedDocumentsRevision\":"
                + docs.get("documentsRevision").asLong() + "}").post(BASE + "/documents/tasks/acknowledge");
        assertEquals(200, ack.statusCode(), ack.asString());
        advanceAndTick(t1.plusSeconds(86_401));
        JsonNode partial = documentReadiness("greg", a);
        assertEquals(List.of("delivery-to-retailer"), toList(partial.get("blocking")));
        Response stillNotReady = post("greg", "complete", command(a, null, v));
        assertEquals(409, stillNotReady.statusCode(), stillNotReady.asString());
        assertEquals(List.of("delivery-to-retailer"), toList(body(stillNotReady).get("readiness").get("blocking")));
        advanceAndTick(t1.plusSeconds(172_801));
        JsonNode ready = documentReadiness("greg", a);
        assertTrue(ready.get("ready").asBoolean(), ready.toString());
        assertTrue(ready.get("documentsComplete").asBoolean());
        assertTrue(ready.get("vehicleReady").asBoolean());

        // 9. Ready but the slot has not started: refused with the policy's own time. Then the clock reaches the slot.
        Response tooEarly = post("greg", "complete", command(a, null, v));
        assertEquals(409, tooEarly.statusCode(), tooEarly.asString());
        assertEquals("appointment-outcome-too-early", body(tooEarly).get("code").asText());
        assertEquals(slotStart.toString(), body(tooEarly).get("availableFrom").asText().replace(".000Z", "Z"));
        advanceAndTick(slotStart);
        String completeId = "cmd-" + ApptHttp.id();
        String completeBody = "{\"commandId\":\"" + completeId + "\",\"orderUuid\":\"" + a + "\",\"expectedVersion\":" + v + "}";
        Response done = http.as("greg").body(completeBody).post(BASE + "/appointments/complete");
        assertEquals(200, done.statusCode(), done.asString());
        JsonNode completed = body(done).get("value");
        assertEquals("completed", completed.get("state").asText());
        String outcomeRef = completed.get("outcome").get("providerReference").asText();
        assertTrue(outcomeRef.startsWith("SYN-APT-"));
        assertEquals(List.of("requested", "scheduled", "completed"), completed.get("history").findValuesAsText("state"));
        assertEquals(done.asString(), http.as("greg").body(completeBody).post(BASE + "/appointments/complete").asString());
        assertEquals(1, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-completed' "
                + "AND payload->>'orderUuid' = ?", a));
        JsonNode finalStage = progress("paula", a);
        assertEquals("handover", finalStage.get("currentStage").asText());
        assertEquals("handed-over", finalStage.get("outcome").asText());
        JsonNode last = finalStage.get("stages").get(finalStage.get("stages").size() - 1);
        assertEquals("handover", last.get("stage").asText());
        assertEquals(outcomeRef, last.get("providerReference").asText());
        assertEquals("Your handover is complete.", finalStage.get("nextStep").asText());

        // 11. The no-show branch on the other employee's order, then a rebooking to a slot that was not missed.
        JsonNode bScheduled = model("alex", b);
        Instant bStart = Instant.parse(bScheduled.get("slot").get("start").asText());
        assertTrue(!bStart.isAfter(slotStart), "the clock has already reached the second slot");
        long bv = bScheduled.get("version").asLong();
        for (String who : new String[] {"paula", "alex", "presenter"}) {
            post(who, "no-show", command(b, null, bv)).then().statusCode(403)
                    .body("code", org.hamcrest.Matchers.equalTo("role-required"));
        }
        String noShowBody = command(b, null, bv);
        Response missed = http.as("greg").body(noShowBody).post(BASE + "/appointments/no-show");
        assertEquals(200, missed.statusCode(), missed.asString());
        JsonNode m = body(missed).get("value");
        assertEquals("no-show", m.get("state").asText());
        assertTrue(m.get("outcome").get("providerReference").asText().startsWith("SYN-APT-"));
        assertEquals(1, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-no-show' "
                + "AND payload->>'orderUuid' = ?", b));
        assertEquals(missed.asString(), http.as("greg").body(noShowBody).post(BASE + "/appointments/no-show").asString());
        String missedSlot = m.get("slot").get("slotId").asText();
        long mv = m.get("version").asLong();
        post("alex", "request", command(b, missedSlot, mv)).then().statusCode(400)
                .body("reasons[0].field", org.hamcrest.Matchers.equalTo("slotId"));
        String next = null;
        for (JsonNode s : m.get("offeredSlots")) if (!missedSlot.equals(s.get("slotId").asText())) next = s.get("slotId").asText();
        assertNotNull(next, m.toString());
        Response rebooked = post("alex", "request", command(b, next, mv));
        assertEquals(200, rebooked.statusCode(), rebooked.asString());
        JsonNode second = body(rebooked).get("value");
        assertEquals("requested", second.get("state").asText());
        assertEquals(2, second.get("attempt").asInt());
        assertEquals(1, second.get("previousAttempts").size());

        // 10. Restart: a fresh service over a new pool reconciles and leaves every stored appointment as it was.
        String before = snapshot(a, b);
        PGSimpleDataSource pool = new PGSimpleDataSource();
        pool.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        pool.setCurrentSchema(schema);
        try (AppointmentService restarted = new AppointmentService(pool, policy, new SyntheticAppointments(pool), stages,
                new TickClock(pool), readiness)) {
            RunContext scope = new RunContext("test-app-env", persistence.guard().currentRun().runId(), "restart");
            AppointmentResult result = restarted.reconcileOnStartup(scope);
            assertTrue(result instanceof AppointmentResult.Ok, result.toString());
            assertEquals(0, ((AppointmentResult.Ok) result).value().path("applied").asInt());
        }
        startup.reconcileOnce();
        assertNotEquals("skipped", startup.summary());
        assertTrue(startup.summary().startsWith("reconciled:"), startup.summary());
        assertEquals(before, snapshot(a, b));
        assertEquals("completed", model("greg", a).get("state").asText());
        assertEquals("requested", model("alex", b).get("state").asText());
        assertEquals(0, ApptHttp.count(dataSource.get(), "SELECT count(*) FROM pending_operations WHERE operation_type LIKE "
                + "'lifecycle-appointment-%' AND state IN ('intent', 'pending')"));
    }

    private static List<String> toList(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }

    /** Everything an appointment restart must not change: both models, history, operations and events. */
    private String snapshot(String a, String b) throws Exception {
        return model("greg", a).toString() + model("greg", b).toString() + ApptHttp.count(dataSource.get(),
                "SELECT count(*) FROM appointment_history") + "/" + ApptHttp.count(dataSource.get(),
                "SELECT count(*) FROM pending_operations WHERE operation_type LIKE 'lifecycle-appointment-%'") + "/"
                + ApptHttp.count(dataSource.get(), "SELECT count(*) FROM outbox_events WHERE event_type LIKE 'appointment-%'")
                + "/" + ApptHttp.count(dataSource.get(), "SELECT count(*) FROM synthetic_appointment_receipts");
    }
}
