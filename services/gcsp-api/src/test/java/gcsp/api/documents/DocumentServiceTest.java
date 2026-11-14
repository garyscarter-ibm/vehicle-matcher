package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.documents.DocumentsPg.StageOrder;
import gcsp.api.persistence.TransactionRunner;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.StreamSupport;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DocumentServiceTest {

    private static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";
    private static final long HOUR = 3600;
    private static final long DAY = 86400;

    private DocumentsPg pg;
    private int ticks;

    @BeforeEach
    void setUp() throws Exception {
        pg = DocumentsPg.create();
    }

    @AfterEach
    void tearDown() throws Exception {
        if (pg != null) pg.close();
    }

    private DocumentService service(DocumentProviderPort provider) throws SQLException {
        DataSource ds = pg.pool();
        return new DocumentService(new TransactionRunner(ds), ds, pg.policyPort(), pg.casePort(), pg.clock(),
                provider);
    }

    private DocumentService synthetic() throws SQLException {
        return service(new SyntheticDocumentProvider());
    }

    private DocumentOutcome tick(DocumentService svc) {
        return svc.tick(pg.ctx, "tick-" + (++ticks), pg.clockNow, DocumentsPg.VERSION);
    }

    private JsonNode tickOk(DocumentService svc) {
        DocumentOutcome out = tick(svc);
        assertEquals("ok", out.status(), String.valueOf(out));
        return out.value();
    }

    private String item(String orderUuid, String itemId, String column) throws SQLException {
        return pg.text("SELECT " + column + "::text FROM document_items WHERE order_uuid = ? AND item_id = ?",
                orderUuid, itemId);
    }

    private long events(String type) throws SQLException {
        return pg.count("SELECT count(*) FROM outbox_events WHERE event_type = ?", type);
    }

    private static JsonNode item(JsonNode view, String itemId) {
        return StreamSupport.stream(view.get("items").spliterator(), false)
                .filter((i) -> itemId.equals(i.get("itemId").asText())).findFirst().orElseThrow();
    }

    private ObjectNode view(DocumentService svc, String orderUuid) {
        return svc.view(pg.ctx, orderUuid, pg.clockNow).orElseThrow();
    }

    @Test
    void opensOnceAtTheOpeningStageBindsRevisionAndKeepsProgressOnLaterRevisions() throws Exception {
        DocumentService svc = synthetic();
        pg.order(ORDER).approved = 3;
        pg.order(ORDER).revision = 3;
        JsonNode early = tickOk(svc);
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));
        assertEquals("opening-stage-not-reached", early.get("notOpen").get(0).get("reason").asText());

        pg.order(ORDER).approved = 4;
        pg.order(ORDER).revision = 4;
        String id = "same-tick";
        JsonNode first = svc.tick(pg.ctx, id, pg.clockNow, DocumentsPg.VERSION).value();
        assertEquals(1, first.get("opened").asInt());
        assertEquals(3, first.get("orders").get(0).get("started").asInt());
        assertEquals(4, pg.count("SELECT count(*) FROM document_items"));
        assertEquals("waiting-for-employee", item(ORDER, "agreement-acknowledgement", "status"));
        assertEquals("in-progress", item(ORDER, "licence-check", "status"));
        assertTrue(item(ORDER, "licence-check", "provider_reference").startsWith("SYN-DOC-"));
        assertEquals(4, Long.parseLong(pg.text("SELECT opening->>'lifecycleRevision' FROM document_orders")));
        assertEquals("sent to ordering", pg.text("SELECT opening->>'stage' FROM document_orders"));
        long revisionAfterOpen = pg.count("SELECT revision FROM runs WHERE run_id = 'run-1'");
        long orderVersion = pg.count("SELECT version FROM document_orders");

        JsonNode replay = svc.tick(pg.ctx, id, pg.clockNow, DocumentsPg.VERSION).value();
        assertEquals(1, replay.get("opened").asInt());
        assertEquals(revisionAfterOpen, pg.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
        assertEquals(orderVersion, pg.count("SELECT version FROM document_orders"));
        assertEquals(4, pg.count("SELECT count(*) FROM document_items"));

        pg.order(ORDER).revision = 5;
        JsonNode later = tickOk(svc);
        assertEquals(0, later.get("opened").asInt());
        assertEquals(5, pg.count("SELECT last_observed_revision FROM document_orders"));
        assertEquals(4, Long.parseLong(pg.text("SELECT opening->>'lifecycleRevision' FROM document_orders")));
        assertEquals("in-progress", item(ORDER, "licence-check", "status"));
        assertEquals(4, pg.count("SELECT count(*) FROM document_items"));

        ObjectNode view = view(svc, ORDER);
        assertEquals(DocumentService.CONTRACT, view.get("contractVersion").asText());
        assertEquals("synthetic", view.get("providerMode").asText());
        assertTrue(view.get("fictional").asBoolean());
        for (JsonNode i : view.get("items")) {
            for (String hidden : List.of("operationId", "fail", "failureReason", "progressAt", "lastProviderOutcome")) {
                assertFalse(i.has(hidden), hidden);
            }
            assertTrue(i.get("assumption").get("synthetic").asBoolean());
            assertEquals(DocumentsPg.ITEMS, i.get("assumption").get("key").asText());
        }
        JsonNode task = view.get("tasks").get(0);
        assertEquals("agreement-acknowledgement", task.get("itemId").asText());
        assertTrue(task.get("actionable").asBoolean());
        assertTrue(task.get("acknowledgement").isNull());
        assertEquals(1, view.get("tasks").size());
    }

    @Test
    void unreadableStagesStayNotOpenAndWriteNothing() throws Exception {
        DocumentService svc = synthetic();
        pg.extraListed.add("no-lifecycle");
        pg.order("unsupported").status = "unsupported";
        pg.order("wrong-contract").contractVersion = "lifecycle.stages.v0";
        pg.order("foreign-run").runId = "demo-other-run";
        pg.order("pending").approved = 3;
        pg.order("bad-authority").renewalId = null;
        JsonNode summary = tickOk(svc);
        List<String> reasons = new ArrayList<>();
        for (JsonNode n : summary.get("notOpen")) reasons.add(n.get("orderUuid").asText() + "=" + n.get("reason").asText());
        assertEquals(List.of("unsupported=stage-mode-unsupported", "wrong-contract=stage-contract-unsupported",
                "foreign-run=stage-identity-mismatch", "pending=opening-stage-not-reached",
                "bad-authority=stage-renewal-authority-invalid", "no-lifecycle=no-lifecycle-for-order"), reasons);
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));
        assertEquals(0, pg.count("SELECT count(*) FROM document_items"));
        assertEquals(0, pg.count("SELECT count(*) FROM outbox_events"));
        assertEquals(0, pg.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void refusedCaseAndSchemeWithoutItemsAreNotOpen() throws Exception {
        DocumentService svc = synthetic();
        pg.order("mismatch").slot = "slot-other";
        pg.refusals.put("slot-other", "stage-slot-mismatch");
        pg.order("no-items").employeeId = "employee-nobody";
        pg.schemes.put("employee-nobody", "unknown-scheme");
        JsonNode summary = tickOk(svc);
        assertEquals("mismatch", summary.get("notOpen").get(0).get("orderUuid").asText());
        assertEquals("stage-slot-mismatch", summary.get("notOpen").get(0).get("reason").asText());
        assertEquals("no-document-items-for-scheme", summary.get("notOpen").get(1).get("reason").asText());
        assertEquals(0, summary.get("opened").asInt());
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));

        pg.caseUnavailable = true;
        pg.order("down");
        JsonNode blocked = tickOk(svc);
        assertEquals("open", blocked.get("blocked").get(0).get("step").asText());
        assertEquals("conflict", blocked.get("blocked").get(0).get("status").asText());
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));
    }

    @Test
    void unavailablePolicyAndClockAreReportedNotDefaulted() throws Exception {
        DocumentService svc = synthetic();
        pg.order(ORDER);
        DocumentOutcome noPolicy = svc.tick(pg.ctx, "t1", pg.clockNow, "gcsp-policy-v0");
        assertEquals("ok", noPolicy.status());
        assertEquals(ORDER, noPolicy.value().get("blocked").get(0).get("orderUuid").asText());
        assertEquals("unavailable", noPolicy.value().get("blocked").get(0).get("status").asText());
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));

        DocumentOutcome stale = svc.tick(pg.ctx, "t2", pg.clockNow.plusSeconds(1), DocumentsPg.VERSION);
        assertEquals(409, stale.http());
        assertEquals("stale-version", stale.code());
        assertTrue(stale.retryable());

        pg.clockEmpty = true;
        DocumentOutcome empty = svc.tick(pg.ctx, "t3", pg.clockNow, DocumentsPg.VERSION);
        assertEquals(503, empty.http());
        assertEquals(DocumentOutcome.UNAVAILABLE_REASON, empty.reason());
        assertEquals(400, svc.tick(pg.ctx, "x".repeat(101), pg.clockNow, DocumentsPg.VERSION).http());
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders"));
    }

    @Test
    void syntheticProviderStartsCompletesAndFailsExactlyOnce() throws Exception {
        DocumentService svc = synthetic();
        pg.order(ORDER);
        tickOk(svc);
        assertEquals("in-progress", item(ORDER, "licence-check", "status"));
        pg.advance(HOUR - 1);
        tickOk(svc);
        assertEquals("in-progress", item(ORDER, "licence-check", "status"));
        pg.advance(1);
        tickOk(svc);
        assertEquals("complete", item(ORDER, "licence-check", "status"));
        assertNotNull(item(ORDER, "licence-check", "completed_at"));
        assertEquals("in-progress", item(ORDER, "vehicle-preparation", "status"));
        pg.advance(2 * DAY);
        JsonNode done = tickOk(svc);
        assertEquals(2, done.get("orders").get(0).get("completed").asInt());
        assertEquals(0, events("document-failed"));
    }

    @Test
    void failedProviderItemRaisesOneFailedEvent() throws Exception {
        pg.value(DocumentsPg.SCENARIO).putArray("failItemIds").add("licence-check");
        DocumentService svc = synthetic();
        pg.order(ORDER);
        tickOk(svc);
        pg.advance(HOUR);
        JsonNode summary = tickOk(svc);
        assertEquals(1, summary.get("orders").get(0).get("failed").asInt());
        assertEquals("failed", item(ORDER, "licence-check", "status"));
        assertEquals("The provider reported this step as failed.", item(ORDER, "licence-check", "reason"));
        assertEquals(1, events("document-failed"));
        pg.advance(DAY);
        tickOk(svc);
        tickOk(svc);
        assertEquals(1, events("document-failed"));
        JsonNode view = view(svc, ORDER);
        assertEquals("failed", view.get("readiness").get("state").asText());
        assertEquals("licence-check", view.get("readiness").get("failed").get(0).asText());
        assertFalse(view.get("readiness").get("ready").asBoolean());
    }

    @Test
    void overdueEmployeeItemRaisesOneEventWithTheOrdersOwnSlotAndRenewal() throws Exception {
        DocumentService svc = synthetic();
        pg.order(ORDER);
        tickOk(svc);
        pg.advance(2 * DAY + 1);
        tickOk(svc);
        tickOk(svc);
        JsonNode view = view(svc, ORDER);
        assertTrue(item(view, "agreement-acknowledgement").get("overdue").asBoolean());
        assertTrue(view.get("tasks").get(0).get("overdue").asBoolean());
        assertEquals(1, events("document-overdue"));
        JsonNode payload = DocumentsPg.JSON.readTree(
                pg.text("SELECT payload::text FROM outbox_events WHERE event_type = 'document-overdue'"));
        assertEquals(DocumentsPg.SLOT, payload.get("entitlementSlotId").asText());
        assertEquals(DocumentsPg.RENEWAL, payload.get("renewalId").asText());
        assertEquals("validated", payload.get("renewalAuthority").asText());
        assertEquals("employee-paula", payload.get("employeeId").asText());
        assertEquals(4, payload.get("lifecycleRevision").asInt());
        assertEquals(pg.clockNow.toString(), payload.get("occurredAt").asText());
    }

    @Test
    void anOrderWithoutRenewalAuthorityCarriesNullsNotADefaultSlot() throws Exception {
        DocumentService svc = synthetic();
        StageOrder o = pg.order(ORDER);
        o.renewalId = null;
        o.slot = null;
        o.renewalAuthority = "missing";
        tickOk(svc);
        pg.advance(2 * DAY + 1);
        tickOk(svc);
        JsonNode payload = DocumentsPg.JSON.readTree(
                pg.text("SELECT payload::text FROM outbox_events WHERE event_type = 'document-overdue'"));
        assertTrue(payload.get("renewalId").isNull());
        assertTrue(payload.get("entitlementSlotId").isNull());
        assertEquals("missing", payload.get("renewalAuthority").asText());
    }

    @Test
    void oneOrderWhoseStageReadThrowsDoesNotStopTheOthers() throws Exception {
        DocumentService svc = synthetic();
        pg.order("a-broken").throwOnRead = true;
        pg.order(ORDER);
        JsonNode first = tickOk(svc);
        assertEquals(1, first.get("opened").asInt());
        assertEquals("a-broken", first.get("notOpen").get(0).get("orderUuid").asText());
        assertEquals("stage-read-unavailable", first.get("notOpen").get(0).get("reason").asText());
        assertEquals(0, pg.count("SELECT count(*) FROM document_orders WHERE order_uuid = 'a-broken'"));
        pg.advance(HOUR);
        tickOk(svc);
        assertEquals("complete", item(ORDER, "licence-check", "status"));
    }

    @Test
    void unsupportedProviderNeverProgressesAnItem() throws Exception {
        assertStuck(new UnsupportedDocumentProvider(), "unsupported", "unsupported");
    }

    @Test
    void unconfiguredProviderNeverProgressesAnItem() throws Exception {
        assertStuck(new UnconfiguredDocumentProvider(), "unavailable", "none");
    }

    private void assertStuck(DocumentProviderPort provider, String outcome, String mode) throws Exception {
        DocumentService svc = service(provider);
        pg.order(ORDER);
        tickOk(svc);
        pg.advance(3 * DAY);
        tickOk(svc);
        tickOk(svc);
        for (String id : List.of("licence-check", "vehicle-preparation", "delivery-to-retailer")) {
            assertEquals("not-started", item(ORDER, id, "status"), id);
            assertEquals(outcome, item(ORDER, id, "last_provider_outcome"), id);
            assertNull(item(ORDER, id, "completed_at"));
        }
        ObjectNode view = view(svc, ORDER);
        assertEquals(mode, view.get("providerMode").asText());
        assertFalse(view.get("readiness").get("ready").asBoolean());
        assertFalse(view.get("acknowledgementSupported").asBoolean());
        assertFalse(view.get("tasks").get(0).get("actionable").asBoolean());
        assertFalse(svc.readiness(pg.ctx, ORDER).orElseThrow().get("ready").asBoolean());
    }

    @Test
    void readinessNeedsEveryDocumentAndReadinessItemComplete() throws Exception {
        DocumentService svc = synthetic();
        assertTrue(svc.readiness(pg.ctx, ORDER).isEmpty());
        assertTrue(svc.view(pg.ctx, ORDER, pg.clockNow).isEmpty());
        pg.order(ORDER);
        tickOk(svc);
        JsonNode waiting = svc.readiness(pg.ctx, ORDER).orElseThrow();
        assertFalse(waiting.get("ready").asBoolean());
        assertEquals("waiting", waiting.get("state").asText());
        assertEquals(4, waiting.get("blocking").size());
        assertTrue(waiting.get("opened").asBoolean());

        pg.advance(2 * DAY);
        tickOk(svc);
        JsonNode partial = svc.readiness(pg.ctx, ORDER).orElseThrow();
        assertFalse(partial.get("ready").asBoolean());
        assertFalse(partial.get("documentsComplete").asBoolean());
        assertTrue(partial.get("vehicleReady").asBoolean());
        assertEquals(1, partial.get("blocking").size());
        assertEquals("agreement-acknowledgement", partial.get("blocking").get(0).asText());

        pg.update("UPDATE document_items SET status = 'complete', completed_at = ?, "
                + "acknowledgement = '{\"kind\":\"synthetic-acknowledgement\"}'::jsonb "
                + "WHERE order_uuid = ? AND item_id = 'agreement-acknowledgement'",
                pg.clockNow.atOffset(java.time.ZoneOffset.UTC), ORDER);
        pg.update("UPDATE document_orders SET version = version + 1 WHERE order_uuid = ?", ORDER);
        JsonNode ready = svc.readiness(pg.ctx, ORDER).orElseThrow();
        assertTrue(ready.get("ready").asBoolean());
        assertEquals("ready", ready.get("state").asText());
        assertEquals(0, ready.get("blocking").size());
        assertTrue(ready.get("documentsRevision").asLong() > 1);
        assertFalse(DocumentView.readiness(List.of()).get("ready").asBoolean());
        assertEquals(1, svc.viewsFor(pg.ctx, "employee-paula", pg.clockNow).size());
        assertEquals(0, svc.viewsFor(pg.ctx, "employee-alex", pg.clockNow).size());
    }

    @Test
    void openOrderLookupUsesThePartialIndexAndTicksIssueAFixedNumberOfStatementsPerOrder() throws Exception {
        try (Connection c = pg.pool().getConnection(); Statement st = c.createStatement()) {
            st.execute("SET enable_seqscan = off");
            try (PreparedStatement ps = c.prepareStatement("EXPLAIN " + DocumentStore.OPEN_ORDERS_SQL)) {
                ps.setString(1, DocumentsPg.ENV);
                ps.setString(2, "run-1");
                StringBuilder plan = new StringBuilder();
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) plan.append(rs.getString(1)).append('\n');
                }
                System.out.println("EXPLAIN open-orders: " + plan.toString().strip().replace("\n", " | "));
                assertTrue(plan.toString().contains("document_items_open"), plan.toString());
            }
        }
        List<String> sink = new ArrayList<>();
        DataSource ds = pg.counting(sink);
        DocumentService svc = new DocumentService(new TransactionRunner(ds), ds, pg.policyPort(), pg.casePort(),
                pg.clock(), new SyntheticDocumentProvider());
        int[] steady = new int[3];
        int total = 0;
        int[] sizes = {1, 3, 5};
        for (int k = 0; k < sizes.length; k++) {
            while (total < sizes[k]) pg.order("order-" + (++total));
            tickOk(svc);
            sink.clear();
            tickOk(svc);
            steady[k] = sink.size();
            assertTrue(sink.stream().noneMatch((s) -> s.startsWith("SELECT") && s.contains("item_id = ?")), sink.toString());
        }
        assertEquals(steady[1] - steady[0], steady[2] - steady[1], List.of(steady[0], steady[1], steady[2]).toString());
        assertTrue(steady[1] > steady[0]);
        System.out.println("statements per steady tick for 1, 3, 5 orders: " + steady[0] + ", " + steady[1] + ", " + steady[2]);
    }
}
