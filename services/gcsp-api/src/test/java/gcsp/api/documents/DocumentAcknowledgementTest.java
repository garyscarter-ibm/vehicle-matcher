package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.TransactionRunner;
import java.sql.SQLException;
import java.util.function.Function;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DocumentAcknowledgementTest {

    private static final String ORDER = "7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f";
    private static final String ITEM = "agreement-acknowledgement";
    private static final String EMPLOYEE = "employee-paula";

    /** A provider whose acknowledge answer the test chooses; a null answer is unavailable. */
    private static final class FakeProvider implements DocumentProviderPort {
        Function<Acknowledgement, Result> answer = (a) -> null;
        int calls;
        String lastOperationId;

        @Override
        public String mode() {
            return "fake";
        }

        @Override
        public boolean supportsAcknowledgement() {
            return true;
        }

        @Override
        public Result start(Operation op) {
            return new Result("accepted", op.operationId(), "FAKE-" + op.itemId(), null, null);
        }

        @Override
        public Result progress(Operation op, java.time.Instant now) {
            return new Result("in-progress", op.operationId(), null, null, null);
        }

        @Override
        public Result acknowledge(Acknowledgement ack) {
            calls++;
            lastOperationId = ack.operationId();
            return answer.apply(ack);
        }
    }

    private DocumentsPg pg;
    private final FakeProvider fake = new FakeProvider();

    @BeforeEach
    void setUp() throws Exception {
        pg = DocumentsPg.create();
        pg.order(ORDER);
        DocumentService opener = service(new SyntheticDocumentProvider());
        assertEquals("ok", opener.tick(pg.ctx, "t1", pg.clockNow, DocumentsPg.VERSION).status());
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

    private long revision() throws SQLException {
        return pg.count("SELECT version FROM document_orders WHERE order_uuid = ?", ORDER);
    }

    private ObjectNode body(String commandId, long revision) {
        ObjectNode b = DocumentsPg.JSON.createObjectNode();
        b.put("commandId", commandId);
        b.put("orderUuid", ORDER);
        b.put("itemId", ITEM);
        b.put("expectedDocumentsRevision", revision);
        return b;
    }

    private DocumentOutcome ack(DocumentService svc, String commandId) throws SQLException {
        return svc.acknowledge(pg.ctx, EMPLOYEE, body(commandId, revision()));
    }

    private String status() throws SQLException {
        return pg.text("SELECT status FROM document_items WHERE order_uuid = ? AND item_id = ?", ORDER, ITEM);
    }

    private long operations() throws SQLException {
        return pg.count("SELECT count(*) FROM pending_operations");
    }

    private String operationState() throws SQLException {
        return pg.text("SELECT state FROM pending_operations");
    }

    private void assertNotComplete() throws SQLException {
        assertNull(pg.text("SELECT completed_at::text FROM document_items WHERE item_id = ?", ITEM));
        assertNull(pg.text("SELECT acknowledgement::text FROM document_items WHERE item_id = ?", ITEM));
    }

    private static DocumentProviderPort.Result acknowledged(DocumentProviderPort.Acknowledgement a) {
        ObjectNode evidence = DocumentsPg.JSON.createObjectNode().put("kind", "fake-evidence")
                .put("operationId", a.operationId());
        return new DocumentProviderPort.Result("acknowledged", a.operationId(), "FAKE-ACK", null, evidence);
    }

    @Test
    void syntheticAcknowledgementCompletesWithEvidenceAndCountsTowardsReadiness() throws Exception {
        DocumentService svc = service(new SyntheticDocumentProvider());
        DocumentOutcome out = ack(svc, "cmd-1");
        assertEquals(200, out.http(), String.valueOf(out));
        JsonNode order = out.value().get("order");
        assertEquals("complete", status());
        assertEquals("acknowledged", operationState());
        assertEquals("synthetic-acknowledgement", pg.text("SELECT acknowledgement->>'kind' FROM document_items "
                + "WHERE item_id = ?", ITEM));
        assertNotNull(pg.text("SELECT completed_at::text FROM document_items WHERE item_id = ?", ITEM));
        assertEquals(pg.text("SELECT operation_id FROM pending_operations"),
                pg.text("SELECT acknowledgement->>'operationId' FROM document_items WHERE item_id = ?", ITEM));
        JsonNode task = order.get("tasks").get(0);
        assertEquals("complete", task.get("status").asText());
        assertFalse(task.get("actionable").asBoolean());
        assertEquals(revision(), order.get("documentsRevision").asLong());
        assertEquals(1, operations());
        // The employee agreement was the only employee document; provider items still gate readiness.
        assertTrue(svc.readiness(pg.ctx, ORDER).orElseThrow().get("documentsComplete").asBoolean() == false);
        pg.update("UPDATE document_items SET status = 'complete', completed_at = now() WHERE owner <> 'employee'");
        JsonNode ready = svc.readiness(pg.ctx, ORDER).orElseThrow();
        assertTrue(ready.get("ready").asBoolean());
    }

    @Test
    void staleRevisionRefusesAndChangesNothing() throws Exception {
        DocumentService svc = service(new SyntheticDocumentProvider());
        long before = revision();
        long receipts = pg.count("SELECT count(*) FROM command_receipts");
        DocumentOutcome out = svc.acknowledge(pg.ctx, EMPLOYEE, body("cmd-stale", before + 1));
        assertEquals(409, out.http());
        assertEquals("stale-version", out.code());
        assertTrue(out.retryable());
        assertEquals(before, out.value().get("current").get("documentsRevision").asLong());
        assertEquals("waiting-for-employee", status());
        assertEquals(before, revision());
        assertEquals(0, operations());
        assertEquals(receipts, pg.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void secondAcknowledgementOfACompleteItemIsNotWaiting() throws Exception {
        DocumentService svc = service(new SyntheticDocumentProvider());
        assertEquals(200, ack(svc, "cmd-1").http());
        DocumentOutcome again = ack(svc, "cmd-2");
        assertEquals(409, again.http());
        assertEquals("task-not-waiting", again.code());
        assertEquals("complete", again.value().get("current").get("status").asText());
        assertEquals(1, operations());
    }

    @Test
    void anotherEmployeeIsRefusedWithNoRows() throws Exception {
        DocumentService svc = service(new SyntheticDocumentProvider());
        DocumentOutcome out = svc.acknowledge(pg.ctx, "employee-other", body("cmd-x", revision()));
        assertEquals(403, out.http());
        assertEquals("not-resource-owner", out.code());
        assertEquals(0, operations());
        assertEquals("waiting-for-employee", status());
        ObjectNode unknownOrder = body("cmd-y", 1);
        unknownOrder.put("orderUuid", "no-such-order");
        assertEquals(404, svc.acknowledge(pg.ctx, EMPLOYEE, unknownOrder).http());
        ObjectNode providerItem = body("cmd-z", revision());
        providerItem.put("itemId", "licence-check");
        DocumentOutcome notYours = svc.acknowledge(pg.ctx, EMPLOYEE, providerItem);
        assertEquals(403, notYours.http());
        assertEquals("not-your-task", notYours.code());
        assertEquals(0, operations());
    }

    @Test
    void invalidBodiesAreRejectedWithTheField() throws Exception {
        DocumentService svc = service(new SyntheticDocumentProvider());
        ObjectNode missing = body("cmd-1", 1);
        missing.remove("commandId");
        assertEquals("commandId", svc.acknowledge(pg.ctx, EMPLOYEE, missing).value().get("reasons").get(0)
                .get("field").asText());
        ObjectNode extra = body("cmd-1", 1);
        extra.put("acknowledgement", "synthetic");
        assertEquals(400, svc.acknowledge(pg.ctx, EMPLOYEE, extra).http());
        ObjectNode fraction = body("cmd-1", 1);
        fraction.put("expectedDocumentsRevision", 1.5);
        assertEquals(400, svc.acknowledge(pg.ctx, EMPLOYEE, fraction).http());
        ObjectNode zero = body("cmd-1", 0);
        assertEquals(400, svc.acknowledge(pg.ctx, EMPLOYEE, zero).http());
        assertEquals(400, svc.acknowledge(pg.ctx, EMPLOYEE, null).http());
        assertEquals(0, operations());
    }

    @Test
    void aProviderWithoutSupportRefusesBeforeAnyWrite() throws Exception {
        DocumentService svc = service(new UnsupportedDocumentProvider());
        long receipts = pg.count("SELECT count(*) FROM command_receipts");
        DocumentOutcome out = ack(svc, "cmd-1");
        assertEquals(422, out.http());
        assertEquals("acknowledgement-unsupported", out.code());
        assertEquals("This step cannot be acknowledged here yet.", out.reason());
        assertEquals(0, operations());
        assertEquals("waiting-for-employee", status());
        assertEquals(receipts, pg.count("SELECT count(*) FROM command_receipts"));
        DocumentOutcome none = ack(service(new UnconfiguredDocumentProvider()), "cmd-2");
        assertEquals(422, none.http());
        assertEquals(0, operations());
    }

    @Test
    void anUnavailableClockIsAnswered503WithoutWriting() throws Exception {
        DocumentService svc = service(fake);
        pg.clockEmpty = true;
        assertEquals(503, ack(svc, "cmd-1").http());
        assertEquals(0, operations());
        assertEquals(0, fake.calls);
    }

    @Test
    void aRefusingProviderReturnsTheItemToWaiting() throws Exception {
        fake.answer = (a) -> new DocumentProviderPort.Result("refused", a.operationId(), null, "Not accepted.", null);
        DocumentService svc = service(fake);
        DocumentOutcome out = ack(svc, "cmd-1");
        assertEquals(409, out.http());
        assertEquals("acknowledgement-refused", out.code());
        assertFalse(out.retryable());
        assertEquals("Not accepted.", out.reason());
        assertEquals("waiting-for-employee", status());
        assertEquals("Not accepted.", pg.text("SELECT reason FROM document_items WHERE item_id = ?", ITEM));
        assertEquals("refused", operationState());
        assertNotComplete();
        // Replaying the same command gives the same refusal without asking the provider again.
        int calls = fake.calls;
        DocumentOutcome replay = svc.acknowledge(pg.ctx, EMPLOYEE, body("cmd-1", revision() - 2));
        assertEquals(409, replay.http());
        assertEquals("acknowledgement-refused", replay.code());
        assertEquals("Not accepted.", replay.reason());
        assertEquals(calls, fake.calls);
    }

    @Test
    void pendingThrowingAndEvidenceFreeAnswersNeverComplete() throws Exception {
        DocumentService svc = service(fake);
        long n = 0;
        for (Function<DocumentProviderPort.Acknowledgement, DocumentProviderPort.Result> answer : java.util.List.<
                Function<DocumentProviderPort.Acknowledgement, DocumentProviderPort.Result>>of(
                (a) -> new DocumentProviderPort.Result("pending", a.operationId(), null, null, null),
                (a) -> {
                    throw new IllegalStateException("provider down");
                },
                (a) -> new DocumentProviderPort.Result("acknowledged", a.operationId(), "REF", null, null),
                (a) -> new DocumentProviderPort.Result("acknowledged", a.operationId(), "REF", null,
                        DocumentsPg.JSON.createArrayNode()),
                (a) -> new DocumentProviderPort.Result("acknowledged", "another-operation", "REF", null,
                        DocumentsPg.JSON.createObjectNode().put("operationId", "another-operation")),
                (a) -> new DocumentProviderPort.Result("acknowledged", a.operationId(), "REF", null,
                        DocumentsPg.JSON.createObjectNode().put("operationId", "another-operation")),
                (a) -> new DocumentProviderPort.Result("surprising", a.operationId(), null, null, null))) {
            fake.answer = answer;
            pg.update("DELETE FROM pending_operations");
            pg.update("UPDATE document_items SET status = 'waiting-for-employee' WHERE item_id = ?", ITEM);
            DocumentOutcome out = ack(svc, "cmd-" + (++n));
            assertEquals(202, out.http(), String.valueOf(out));
            assertEquals("pending", out.status());
            assertEquals("acknowledgement-pending", out.code());
            assertNotNull(out.operationId());
            assertEquals("acknowledging", status());
            assertEquals("pending", operationState());
            assertNotComplete();
            JsonNode readiness = svc.readiness(pg.ctx, ORDER).orElseThrow();
            assertFalse(readiness.get("ready").asBoolean());
            assertTrue(readiness.get("blocking").toString().contains(ITEM));
        }
    }

    @Test
    void replayingAPendingCommandReconcilesWithTheSameOperation() throws Exception {
        fake.answer = (a) -> new DocumentProviderPort.Result("pending", a.operationId(), null, null, null);
        DocumentService svc = service(fake);
        DocumentOutcome first = ack(svc, "cmd-1");
        assertEquals(202, first.http());
        String operationId = first.operationId();
        ObjectNode same = body("cmd-1", revision() - 1);
        assertEquals(202, svc.acknowledge(pg.ctx, EMPLOYEE, same).http());
        assertEquals(2, fake.calls);
        assertEquals(1, operations());

        fake.answer = DocumentAcknowledgementTest::acknowledged;
        DocumentOutcome done = svc.acknowledge(pg.ctx, EMPLOYEE, same);
        assertEquals(200, done.http(), String.valueOf(done));
        assertEquals(operationId, fake.lastOperationId);
        assertEquals("complete", status());
        assertEquals("acknowledged", operationState());
        assertEquals("fake-evidence", pg.text("SELECT acknowledgement->>'kind' FROM document_items WHERE item_id = ?",
                ITEM));
        int calls = fake.calls;
        DocumentOutcome again = svc.acknowledge(pg.ctx, EMPLOYEE, same);
        assertEquals(200, again.http());
        assertEquals(calls, fake.calls);
        assertEquals(1, operations());
    }

    @Test
    void sameCommandIdWithChangedInputIsRefused() throws Exception {
        fake.answer = DocumentAcknowledgementTest::acknowledged;
        DocumentService svc = service(fake);
        long revision = revision();
        assertEquals(200, svc.acknowledge(pg.ctx, EMPLOYEE, body("cmd-1", revision)).http());
        DocumentOutcome changed = svc.acknowledge(pg.ctx, EMPLOYEE, body("cmd-1", revision + 5));
        assertEquals(409, changed.http());
        assertEquals("command-input-changed", changed.code());
    }

    @Test
    void aRunRetiredWhileTheProviderAnswersNeverCompletes() throws Exception {
        fake.answer = (a) -> {
            try {
                pg.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
                pg.update("INSERT INTO runs (environment_id, run_id, status) VALUES (?, 'run-2', 'active')",
                        DocumentsPg.ENV);
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
            return acknowledged(a);
        };
        DocumentService svc = service(fake);
        DocumentOutcome out = ack(svc, "cmd-1");
        assertEquals(409, out.http(), String.valueOf(out));
        assertEquals("stale-run", out.code());
        assertEquals("acknowledging", status());
        assertNotComplete();
        assertEquals("intent", operationState());
        // The old run's command cannot be driven to completion later either.
        assertEquals(409, svc.acknowledge(pg.ctx, EMPLOYEE, body("cmd-1", revision() - 1)).http());
        assertEquals("acknowledging", status());
    }
}
