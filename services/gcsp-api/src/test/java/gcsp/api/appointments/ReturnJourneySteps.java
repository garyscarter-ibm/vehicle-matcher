package gcsp.api.appointments;

import static gcsp.api.appointments.ApptHttp.BASE;
import static gcsp.api.appointments.ApptHttp.body;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.returns.CurrentCarStore;
import gcsp.api.returns.HandoverPort;
import gcsp.api.returns.ReturnPlans;
import gcsp.api.returns.ReturnSelection;
import gcsp.api.returns.ReturnSourcePort;
import gcsp.api.returns.ReturnStartup;
import io.agroal.api.AgroalDataSource;
import io.restassured.response.Response;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.ds.PGSimpleDataSource;

/** The shared steps of the old-car return journeys: one real handover order driven over HTTP, plus return helpers. */
public final class ReturnJourneySteps {

    static final String PRESENTER = BASE + "/presenter";
    static final String PLAN = BASE + "/return-plan";
    private static final String ORDERING = BASE + "/manual/order";

    final ApptHttp http;
    final AgroalDataSource ds;
    final Persistence persistence;
    private int seq;
    String order;
    Instant t0;
    Instant t1;
    String handoverSlot;
    Instant slotStart;

    ReturnJourneySteps(ApptHttp http, AgroalDataSource ds, Persistence persistence) {
        this.http = http;
        this.ds = ds;
        this.persistence = persistence;
    }

    // ---- database ----

    long count(String sql, Object... params) throws Exception {
        return ApptHttp.count(ds, sql, params);
    }

    String text(String sql, Object... params) throws Exception {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    /** The order's current-car row (instants as instants), or null when no confirmed event has been recorded. */
    Map<String, Object> relationship(String orderUuid) throws Exception {
        try (Connection c = ds.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT new_status, new_collected_at, "
                + "new_provider_reference, old_status, old_returned_at, old_provider_reference, version, old_contract_id "
                + "FROM current_car_relationships WHERE order_uuid = ?")) {
            ps.setString(1, orderUuid);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("newStatus", rs.getString(1));
                OffsetDateTime collected = rs.getObject(2, OffsetDateTime.class);
                m.put("newCollectedAt", collected == null ? null : collected.toInstant());
                m.put("newProviderReference", rs.getString(3));
                m.put("oldStatus", rs.getString(4));
                OffsetDateTime returned = rs.getObject(5, OffsetDateTime.class);
                m.put("oldReturnedAt", returned == null ? null : returned.toInstant());
                m.put("oldProviderReference", rs.getString(6));
                m.put("version", rs.getLong(7));
                m.put("oldContractId", rs.getString(8));
                return m;
            }
        }
    }

    /** Everything a restart or a repeated tick must leave alone, for the order. */
    String evidence(String orderUuid, String who) throws Exception {
        return planValue(who, orderUuid).toString() + relationship(orderUuid) + "/"
                + count("SELECT count(*) FROM current_car_events WHERE order_uuid = ?", orderUuid) + "/"
                + count("SELECT count(*) FROM return_operations WHERE order_uuid = ?", orderUuid) + "/"
                + count("SELECT count(*) FROM return_provider_receipts") + "/"
                + count("SELECT count(*) FROM pending_operations") + "/"
                + count("SELECT count(*) FROM return_plans WHERE order_uuid = ?", orderUuid) + "/"
                + count("SELECT count(*) FROM return_outcomes WHERE order_uuid = ?", orderUuid);
    }

    // ---- ordering ----

    /** Change only the date, using the server's selected account, policy and window at every required phase. */
    public static ObjectNode withCollectionDate(JsonNode account, ObjectNode choices, Instant... laterPhases) {
        assertEquals("ready", account.path("state").asText());
        JsonNode trusted = account.get("choices");
        assertEquals(trusted.get("slotId"), choices.get("slotId"));
        assertEquals(trusted.get("schemeId"), choices.get("schemeId"));
        JsonNode slot = selected(account.get("slots"), "entitlementSlotId", choices.get("slotId").asText());
        assertTrue(slot.at("/ordering/enabled").asBoolean(), "the selected slot must permit ordering");
        JsonNode rules = selected(account.get("assumptions"), "key", "manual.context.v1").get("value");
        JsonNode driver = selected(account.get("drivers"), "driverId", choices.get("driverId").asText());
        JsonNode contract = selected(rules.get("contractOptions"), "contractOptionId", choices.get("contractOptionId").asText());
        assertTrue(includes(contract.get("schemeIds"), choices.get("schemeId").asText()));
        assertTrue(includes(contract.get("driverKinds"), driver.get("kind").asText()));
        JsonNode location = selected(rules.get("locations"), "locationId", choices.get("collectionLocationId").asText());
        assertTrue(includes(location.get("contractOptionIds"), contract.get("contractOptionId").asText()));
        assertTrue(includes(location.get("driverKinds"), driver.get("kind").asText()));
        assertTrue(rules.path("minimumLeadDays").isIntegralNumber() && rules.path("maximumLeadDays").isIntegralNumber());
        long min = rules.get("minimumLeadDays").longValue(), max = rules.get("maximumLeadDays").longValue();
        assertTrue(min >= 0 && max >= min, "the canonical collection lead bounds must be valid");
        // AccountService uses the first ten characters of its own asOf, rather than the test machine's date.
        LocalDate day = LocalDate.parse(account.get("asOf").asText().substring(0, 10));
        LocalDate first = day.plusDays(min), last = day.plusDays(max);
        for (Instant phase : laterPhases) {
            LocalDate phaseDay = LocalDate.ofInstant(phase, ZoneOffset.UTC);
            if (phaseDay.plusDays(min).isAfter(first)) first = phaseDay.plusDays(min);
            if (phaseDay.plusDays(max).isBefore(last)) last = phaseDay.plusDays(max);
        }
        JsonNode window = account.get("currentContract");
        if (window == null || window.isNull()) window = slot;
        if (window.hasNonNull("earliestCollectionDate")) {
            LocalDate earliest = LocalDate.parse(window.get("earliestCollectionDate").asText());
            if (earliest.isAfter(first)) first = earliest;
        }
        if (window.hasNonNull("latestCollectionDate")) {
            LocalDate latest = LocalDate.parse(window.get("latestCollectionDate").asText());
            if (latest.isBefore(last)) last = latest;
        }
        JsonNode licence = driver.get("licence");
        assertTrue(includes(licence.get("categories"), "car"));
        LocalDate validFrom = LocalDate.parse(licence.get("validFrom").asText());
        LocalDate validUntil = LocalDate.parse(licence.get("validUntil").asText());
        if (validFrom.isAfter(first)) first = validFrom;
        if (validUntil.isBefore(last)) last = validUntil;
        JsonNode closed = location.get("closedDates");
        assertTrue(closed == null || closed.isNull() || closed.isArray(), "closedDates must be an array");
        for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
            if (closed == null || closed.isNull() || !includes(closed, date.toString())) {
                return choices.deepCopy().put("requestedCollectionDate", date.toString());
            }
        }
        throw new AssertionError("No admissible collection date between " + first + " and " + last
                + " at " + choices.get("collectionLocationId").asText());
    }

    private static JsonNode selected(JsonNode rows, String key, String value) {
        assertTrue(rows != null && rows.isArray(), "missing server array for " + key);
        for (JsonNode row : rows) if (value.equals(row.path(key).asText())) return row;
        throw new AssertionError("No server selection for " + key + "=" + value);
    }

    private static boolean includes(JsonNode rows, String value) {
        assertTrue(rows != null && rows.isArray(), "missing canonical selection list");
        for (JsonNode row : rows) if (row.isTextual() && value.equals(row.textValue())) return true;
        return false;
    }

    /** Released stock is upstream supply, so it is the one thing seeded; the fixture rows suit paula's grade. */
    void seedStock() throws Exception {
        var run = persistence.guard().currentRun();
        try (Connection c = ds.getConnection()) {
            StockDbFixture.insertStock(c, run.environmentId(), run.runId(), new ArrayList<>(StockDbFixture.rows()));
        }
    }

    /** The real account, draft, stock, claim and review routes for a demo employee; returns the order ordering writes. */
    String placeOrder(String who) throws Exception {
        JsonNode account = body(http.as(who).get(BASE + "/manual/account")).get("value");
        assertEquals("ready", account.get("state").asText());
        ObjectNode choices = (ObjectNode) ApptHttp.JSON.readTree(StockDbFixture.complete().toString()
                .replace("paula", who).replace("Paula Mason", who));
        String draft = withCollectionDate(account, choices).toString();
        Response saved = http.as(who).body("{\"commandId\":\"draft-" + ApptHttp.id() + "\",\"expectedDraftVersion\":0,"
                + "\"expectedContextVersion\":\"" + account.get("contextVersion").asText() + "\",\"choices\":" + draft + "}")
                .post(BASE + "/manual/draft");
        assertEquals(200, saved.statusCode(), saved.asString());
        Response browse = http.as(who).get(BASE + "/manual/stock");
        assertEquals(200, browse.statusCode(), browse.asString());
        ObjectNode claim = null;
        for (JsonNode d : body(browse).get("value").get("decisions")) {
            if (claim == null && "eligible".equals(d.get("gateStatus").asText())) claim = ((ObjectNode) d.get("claimInput")).deepCopy();
        }
        assertNotNull(claim, "no eligible car: " + body(browse).get("value").get("decisions"));
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
        assertEquals("acknowledged", body(r).get("value").get("status").asText());
        assertEquals(car, body(r).get("value").get("selection").get("orderUuid").asText());
        return car;
    }

    // ---- the run clock ----

    JsonNode clock() throws Exception {
        Response r = http.as("presenter").get(PRESENTER + "/clock");
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    /** One presenter clock tick at the clock's own time: every lifecycle handler runs, return outcomes included. */
    JsonNode tick() throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response r = http.as("presenter").body("{\"tickId\":\"rj-" + (++seq) + "-" + ApptHttp.id() + "\",\"expectedClockVersion\":"
                + version + "}").post(PRESENTER + "/clock/tick");
        assertEquals(200, r.statusCode(), r.asString());
        JsonNode t = body(r).get("value");
        assertEquals("completed", t.get("state").asText(), t.toString());
        return t;
    }

    JsonNode advanceAndTick(Instant to) throws Exception {
        long version = clock().get("clockVersion").asLong();
        Response moved = http.as("presenter").body("{\"commandId\":\"adv-" + ApptHttp.id() + "\",\"expectedClockVersion\":"
                + version + ",\"to\":\"" + to + "\"}").post(PRESENTER + "/clock/advance");
        assertEquals(200, moved.statusCode(), moved.asString());
        return tick();
    }

    /** What the named handler answered in this tick (its outcome value). */
    static JsonNode handler(JsonNode tick, String handlerId) {
        for (JsonNode o : tick.get("outcomes")) if (handlerId.equals(o.get("handlerId").asText())) return o.get("outcome").get("value");
        throw new AssertionError(handlerId + " missing in " + tick.get("outcomes"));
    }

    private Response approvalTick() throws Exception {
        JsonNode c = clock();
        String id = "ra-" + (++seq) + "-" + ApptHttp.id();
        return http.as("presenter").body("{\"commandId\":\"cmd-" + id + "\",\"tickId\":\"" + id + "\",\"now\":\""
                + Instant.parse(c.get("now").asText()) + "\",\"clockVersion\":" + c.get("clockVersion").asLong() + "}")
                .post(PRESENTER + "/approvals/ticks");
    }

    // ---- the order's journey to a scheduled handover ----

    /** Seeds stock, orders for paula and delivers the first clock tick (which the return plan reads its time from). */
    void startOrder() throws Exception {
        seedStock();
        order = placeOrder("paula");
        t0 = Instant.parse(clock().get("now").asText());
        tick();
    }

    /** Approvals ticks until ordering has the order, then the employee requests the last offered handover slot. */
    void requestHandover() throws Exception {
        for (int i = 0; i < 20 && !"sent-to-ordering".equals(progress("paula").get("outcome").asText()); i++) {
            assertEquals(200, approvalTick().statusCode());
        }
        assertEquals("sent-to-ordering", progress("paula").get("outcome").asText());
        JsonNode open = appointment("paula");
        assertEquals("not-requested", open.get("state").asText());
        JsonNode offered = open.get("offeredSlots");
        assertTrue(offered.size() >= 3, offered.toString());
        handoverSlot = offered.get(offered.size() - 1).get("slotId").asText();
        Response requested = http.as("paula").body("{\"commandId\":\"cmd-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order
                + "\",\"slotId\":\"" + handoverSlot + "\",\"expectedVersion\":0}").post(BASE + "/appointments/request");
        assertEquals(200, requested.statusCode(), requested.asString());
        assertEquals("requested", body(requested).get("value").get("state").asText());
    }

    /** The clock moves past the retailer's confirmation delay and ticks: the handover is scheduled. */
    JsonNode scheduleHandover() throws Exception {
        t1 = t0.plusSeconds(1801);
        advanceAndTick(t1);
        JsonNode scheduled = appointment("paula");
        assertEquals("scheduled", scheduled.get("state").asText());
        assertEquals(handoverSlot, scheduled.get("slot").get("slotId").asText());
        slotStart = Instant.parse(scheduled.get("slot").get("start").asText());
        return scheduled;
    }

    /** The employee acknowledges, time passes until the documents and car are ready, and Greg completes at the slot. */
    JsonNode completeHandover(JsonNode scheduled) throws Exception {
        JsonNode docs = body(http.as("paula").get(BASE + "/documents")).get("value").get("orders").get(0);
        assertEquals(order, docs.get("orderUuid").asText());
        Response ack = http.as("paula").body("{\"commandId\":\"ack-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order
                + "\",\"itemId\":\"agreement-acknowledgement\",\"expectedDocumentsRevision\":"
                + docs.get("documentsRevision").asLong() + "}").post(BASE + "/documents/tasks/acknowledge");
        assertEquals(200, ack.statusCode(), ack.asString());
        advanceAndTick(t1.plusSeconds(86_401));
        advanceAndTick(t1.plusSeconds(172_801));
        Response readiness = http.as("greg").get(BASE + "/documents/readiness?orderUuid=" + order);
        assertTrue(body(readiness).get("value").get("ready").asBoolean(), readiness.asString());
        advanceAndTick(slotStart);
        String json = "{\"commandId\":\"cmd-" + ApptHttp.id() + "\",\"orderUuid\":\"" + order + "\",\"expectedVersion\":"
                + scheduled.get("version").asLong() + "}";
        Response done = http.as("greg").body(json).post(BASE + "/appointments/complete");
        assertEquals(200, done.statusCode(), done.asString());
        JsonNode completed = body(done).get("value");
        assertEquals("completed", completed.get("state").asText());
        assertEquals(1, count("SELECT count(*) FROM outbox_events WHERE event_type = 'appointment-completed' "
                + "AND payload->>'orderUuid' = ?", order));
        return completed;
    }

    JsonNode progress(String who) throws Exception {
        Response r = http.as(who).get(BASE + "/orders/progress?orderUuid=" + order);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    JsonNode appointment(String who) throws Exception {
        Response r = http.as(who).get(BASE + "/appointments?orderUuid=" + order);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    // ---- the return plan routes ----

    Response plan(String who, String orderUuid) throws Exception {
        return http.as(who).get(PLAN + "?orderUuid=" + orderUuid);
    }

    JsonNode planValue(String who, String orderUuid) throws Exception {
        Response r = plan(who, orderUuid);
        assertEquals(200, r.statusCode(), r.asString());
        return body(r).get("value");
    }

    static String requestJson(String commandId, String orderUuid, String choice, String slotId, long version) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + orderUuid + "\",\"choice\":\"" + choice
                + "\",\"slotId\":\"" + slotId + "\",\"expectedVersion\":" + version + "}";
    }

    static String acceptJson(String commandId, String orderUuid, String proposalId, long version) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + orderUuid + "\",\"proposalId\":\"" + proposalId
                + "\",\"expectedVersion\":" + version + "}";
    }

    Response post(String who, String path, String json) throws Exception {
        return http.as(who).body(json).post(BASE + path);
    }

    /** The account's current-car list for the employee, or null when the account omits it. */
    JsonNode accountRelationships(String who) throws Exception {
        JsonNode account = body(http.as(who).get(BASE + "/manual/account")).get("value");
        return account.has("currentCarRelationships") ? account.get("currentCarRelationships") : null;
    }

    // ---- restart ----

    /** A fresh ReturnPlans over a new pool runs the reconcile-only pass the startup runs; the bean's own pass follows. */
    ReturnPlans.Summary restart(String schema, ReturnSelection selection, ReturnSourcePort sources, HandoverPort handovers,
            ReturnStartup startup) throws Exception {
        PGSimpleDataSource pool = new PGSimpleDataSource();
        pool.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        pool.setCurrentSchema(schema);
        RunContext scope = new RunContext("test-app-env", persistence.guard().currentRun().runId(), "restart");
        ReturnPlans.Summary summary;
        try (ReturnPlans fresh = new ReturnPlans(selection.policy(), sources, handovers, selection.clock(), selection.provider(),
                new CurrentCarStore(pool), new TransactionRunner(pool), pool)) {
            summary = fresh.progress(scope, selection.clock().now(scope).orElseThrow(), false);
        }
        startup.reconcileOnce();
        assertTrue(startup.summary().startsWith("reconciled:"), startup.summary());
        assertEquals(0, summary.failed().size(), summary.toString());
        return summary;
    }
}
