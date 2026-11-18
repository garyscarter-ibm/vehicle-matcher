package gcsp.api.documents;

import static gcsp.api.documents.DocumentsJourneySupport.ackJson;
import static gcsp.api.documents.DocumentsJourneySupport.body;
import static gcsp.api.documents.DocumentsJourneySupport.id;
import static gcsp.api.documents.DocumentsJourneySupport.item;
import static gcsp.api.documents.DocumentsJourneySupport.task;
import static gcsp.api.documents.DocumentsJourneySupport.texts;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.lang.reflect.Field;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.function.Function;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * Documents and readiness on the deployed composition: real RS256 tokens, native PostgreSQL, real lifecycle ports and no
 * test alternative. Only the provider's answer is scripted, over the real service, policy, cases, clock and runner.
 */
@QuarkusTest
@TestProfile(DocumentsJourneyProfile.class)
class DocumentsJourneyHttpTest {

    private static final String AGREEMENT = "agreement-acknowledgement";
    private static final String LICENCE = "licence-check";
    private static final List<String> ITEMS = List.of(AGREEMENT, LICENCE, "vehicle-preparation", "delivery-to-retailer");
    private static String ownedSchema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private DocumentsJourneySupport j;

    @AfterAll
    static void drop() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_docjourney_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(System.getenv("GCSP_TEST_DATABASE_URL"));
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    private static Class<?> beanClass(Class<?> type) {
        return Arc.container().instance(type).getBean().getBeanClass();
    }

    /** A provider whose acknowledge answer is scripted; start and progress stay the synthetic provider's. */
    private static final class Scripted implements DocumentProviderPort {
        private final SyntheticDocumentProvider real = new SyntheticDocumentProvider();
        private final Function<Acknowledgement, Result> answer;

        Scripted(Function<Acknowledgement, Result> answer) {
            this.answer = answer;
        }

        @Override
        public String mode() {
            return "synthetic";
        }

        @Override
        public boolean supportsAcknowledgement() {
            return true;
        }

        @Override
        public Result start(Operation op) {
            return real.start(op);
        }

        @Override
        public Result progress(Operation op, Instant now) {
            return real.progress(op, now);
        }

        @Override
        public Result acknowledge(Acknowledgement ack) {
            return answer.apply(ack);
        }
    }

    private static DocumentProviderPort.Result acknowledged(String operationId, String evidenceOperationId) {
        var evidence = evidenceOperationId == null ? null
                : JsonNodeFactory.instance.objectNode().put("kind", "scripted").put("operationId", evidenceOperationId);
        return new DocumentProviderPort.Result("acknowledged", operationId, "SCRIPTED-REF", null, evidence);
    }

    /** Swaps the started app's provider (what GCSP_DOCUMENTS_PROVIDER selects) and rebuilds the service over the rest. */
    private static void swap(DocumentsWiring wiring, DocumentProviderPort provider) throws Exception {
        Field p = DocumentsWiring.class.getDeclaredField("provider");
        Field s = DocumentsWiring.class.getDeclaredField("service");
        p.setAccessible(true);
        s.setAccessible(true);
        synchronized (wiring) {
            p.set(wiring, provider);
            s.set(wiring, null);
        }
    }

    private String dbStatus(String order, String itemId) throws Exception {
        return j.text("SELECT status FROM document_items WHERE order_uuid = ? AND item_id = ?", order, itemId);
    }

    /** The item is not complete in the view, in readiness and in the table; nothing reads as ready. */
    private void assertIncomplete(String who, String order, String itemId) throws Exception {
        assertNotEquals("complete", item(j.order(who, order), itemId).get("status").asText());
        JsonNode r = j.readinessValue("greg", order);
        assertFalse(r.get("ready").asBoolean(), r.toString());
        assertTrue(texts(r.get("blocking")).contains(itemId), r.toString());
        assertNotEquals("complete", dbStatus(order, itemId));
    }

    private long revision(String who, String order) throws Exception {
        return j.order(who, order).get("documentsRevision").asLong();
    }

    private long operationRows(String commandId) throws Exception {
        return j.count("SELECT count(*) FROM pending_operations WHERE idempotency_key LIKE ?", "%:" + commandId);
    }

    @Test
    void theDeployedDocumentsCompositionReflectsAuthorityAndNeverCompletesWithoutEvidence() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        j = new DocumentsJourneySupport(signingJwk, dataSource.get(), persistence);
        DocumentsWiring wiring = ClientProxy.unwrap(Arc.container().instance(DocumentsWiring.class).get());

        // 1. Composition: real adapters, the run clock and the synthetic provider; no test alternative stands in.
        assertEquals(PolicyDocumentsAdapter.class, beanClass(DocumentPolicyPort.class));
        assertEquals(LifecycleDocumentCases.class, beanClass(DocumentCasePort.class));
        assertEquals(RunClockDocumentClock.class, beanClass(DocumentClock.class));
        assertEquals("synthetic", wiring.provider().mode());
        DocumentProviderPort synthetic = wiring.provider();

        // 2. Two employees order through the real routes; before the documents tick nothing is open.
        j.seedStock();
        String b = j.placeOrder("alex", null);
        String a = j.placeOrder("paula", b);
        j.tick();
        j.sendBothToOrdering(a, b);
        JsonNode notOpen = j.readinessValue("greg", a);
        assertFalse(notOpen.get("opened").asBoolean(), notOpen.toString());
        assertFalse(notOpen.get("ready").asBoolean());
        assertEquals("not-open", notOpen.get("state").asText());
        assertEquals("awaiting-document-tick", notOpen.get("reason").asText());
        assertEquals(0, body(j.documents("paula")).get("value").get("orders").size());
        j.tick();
        Instant opened = j.now();

        // 3. AC1: each list holds only its own order, with the canonical policy items and their owners.
        JsonNode paula = j.order("paula", a);
        JsonNode alex = j.order("alex", b);
        assertNotNull(paula);
        assertNotNull(alex);
        assertNull(j.order("alex", a));
        assertNull(j.order("paula", b));
        assertEquals(1, body(j.documents("paula")).get("value").get("orders").size());
        List<String> ids = new java.util.ArrayList<>();
        paula.get("items").forEach(i -> ids.add(i.get("itemId").asText()));
        assertEquals(ITEMS, ids);
        assertEquals("employee", item(paula, AGREEMENT).get("owner").asText());
        assertEquals("scheme-team", item(paula, LICENCE).get("owner").asText());
        assertEquals("retailer", item(paula, "vehicle-preparation").get("owner").asText());
        assertEquals("retailer", item(paula, "delivery-to-retailer").get("owner").asText());
        assertEquals("synthetic", paula.get("providerMode").asText());
        assertEquals(3, paula.get("assumptions").size());
        assertTrue(paula.get("acknowledgementSupported").asBoolean());
        for (String other : ITEMS.subList(1, 4)) assertFalse(item(paula, other).has("action"), other);
        assertEquals("Acknowledge the agreement", item(paula, AGREEMENT).get("action").asText());
        assertEquals(1, paula.get("tasks").size());
        assertEquals("waiting-for-employee", item(paula, AGREEMENT).get("status").asText());
        assertTrue(task(paula, AGREEMENT).get("actionable").asBoolean());
        assertNull(task(paula, LICENCE));

        // 4. AC1: readiness reads by owner; another employee is refused; nothing is ready and every item blocks.
        assertEquals(200, j.readiness("paula", a).statusCode());
        j.readiness("alex", a).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("not-resource-owner"));
        j.readiness("paula", b).then().statusCode(403).body("code", org.hamcrest.Matchers.equalTo("not-resource-owner"));
        for (String who : new String[] {"paula", "greg", "presenter"}) {
            JsonNode r = j.readinessValue(who, a);
            assertTrue(r.get("opened").asBoolean());
            assertFalse(r.get("ready").asBoolean());
            assertEquals(ITEMS, texts(r.get("blocking")));
        }
        for (String who : new String[] {"greg", "presenter"}) {
            for (String path : new String[] {"complete", "acknowledge"}) {
                Response denied = j.post(who, path, ackJson("c-" + id(), a, AGREEMENT, paula.get("documentsRevision").asLong()));
                assertEquals(403, denied.statusCode(), denied.asString());
                assertEquals("role-required", body(denied).get("code").asText());
            }
        }
        assertIncomplete("paula", a, AGREEMENT);

        // 5. AC1: paula acknowledges through the inventory path; the synthetic evidence is recorded.
        Response ack = j.post("paula", "complete", ackJson("ack-" + id(), a, AGREEMENT, paula.get("documentsRevision").asLong()));
        assertEquals(200, ack.statusCode(), ack.asString());
        JsonNode done = body(ack).get("value").get("order");
        assertEquals("complete", item(done, AGREEMENT).get("status").asText());
        assertEquals("synthetic-acknowledgement", item(done, AGREEMENT).get("acknowledgement").get("kind").asText());
        assertEquals("Acknowledged. Not a signature.", item(done, AGREEMENT).get("acknowledgement").get("label").asText());
        assertTrue(item(done, AGREEMENT).get("acknowledgement").get("fictional").asBoolean());
        assertFalse(task(done, AGREEMENT).get("actionable").asBoolean());
        assertEquals("complete", dbStatus(a, AGREEMENT));
        JsonNode after = j.readinessValue("greg", a);
        assertEquals(ITEMS.subList(1, 4), texts(after.get("blocking")));
        assertFalse(after.get("ready").asBoolean());
        // A second command on the completed item changes nothing.
        Response again = j.post("paula", "complete", ackJson("ack-" + id(), a, AGREEMENT, revision("paula", a)));
        assertEquals(409, again.statusCode(), again.asString());
        assertEquals("task-not-waiting", body(again).get("code").asText());
        assertEquals("complete", body(again).get("current").get("status").asText());

        // 6. AC2: refusals that need no provider change; alex's order stays incomplete throughout.
        long rev = revision("alex", b);
        Response notOwner = j.post("paula", "complete", ackJson("no-" + id(), b, AGREEMENT, rev));
        assertEquals(403, notOwner.statusCode(), notOwner.asString());
        assertEquals("not-resource-owner", body(notOwner).get("code").asText());
        for (String itemId : new String[] {LICENCE, "vehicle-preparation", "no-such-item"}) {
            Response notYours = j.post("alex", "complete", ackJson("ny-" + id(), b, itemId, rev));
            assertEquals(403, notYours.statusCode(), notYours.asString());
            assertEquals("not-your-task", body(notYours).get("code").asText());
        }
        Response unknown = j.post("alex", "complete", ackJson("un-" + id(), "no-such-order", AGREEMENT, rev));
        assertEquals(404, unknown.statusCode(), unknown.asString());
        assertEquals("document-order-not-found", body(unknown).get("code").asText());
        assertEquals(rev, revision("alex", b));
        assertIncomplete("alex", b, AGREEMENT);
        assertIncomplete("alex", b, LICENCE);

        try {
            // 7. AC2: unsupported writes (GCSP_DOCUMENTS_PROVIDER=unsupported, then none) write nothing.
            for (DocumentProviderPort provider : new DocumentProviderPort[] {new UnsupportedDocumentProvider(),
                    new UnconfiguredDocumentProvider()}) {
                swap(wiring, provider);
                JsonNode view = j.order("alex", b);
                assertFalse(view.get("acknowledgementSupported").asBoolean());
                assertFalse(task(view, AGREEMENT).get("actionable").asBoolean());
                long rows = j.count("SELECT count(*) FROM pending_operations");
                String command = "uns-" + provider.mode() + "-" + id();
                Response r = j.post("alex", "complete", ackJson(command, b, AGREEMENT, rev));
                assertEquals(422, r.statusCode(), r.asString());
                assertEquals("acknowledgement-unsupported", body(r).get("code").asText());
                assertEquals("unsupported", body(r).get("status").asText());
                assertEquals(0, operationRows(command));
                assertEquals(rows, j.count("SELECT count(*) FROM pending_operations"));
                assertEquals(rev, revision("alex", b));
                assertEquals("waiting-for-employee", dbStatus(b, AGREEMENT));
                assertIncomplete("alex", b, AGREEMENT);
            }

            // 8. AC2: a refusing provider gives 409, returns the item to waiting and replays from the record.
            swap(wiring, new Scripted(ak -> new DocumentProviderPort.Result("refused", ak.operationId(), null,
                    "Scripted provider refusal.", null)));
            String refusedId = "ref-" + id();
            String refusedBody = ackJson(refusedId, b, AGREEMENT, rev);
            Response refused = j.post("alex", "complete", refusedBody);
            assertEquals(409, refused.statusCode(), refused.asString());
            assertEquals("acknowledgement-refused", body(refused).get("code").asText());
            assertEquals("Scripted provider refusal.", body(refused).get("reason").asText());
            assertEquals("waiting-for-employee", dbStatus(b, AGREEMENT));
            assertEquals("Scripted provider refusal.", item(j.order("alex", b), AGREEMENT).get("reason").asText());
            assertIncomplete("alex", b, AGREEMENT);
            assertEquals("refused", j.text("SELECT state FROM pending_operations WHERE idempotency_key LIKE ?", "%:" + refusedId));
            Response replay = j.post("alex", "complete", refusedBody);
            assertEquals(409, replay.statusCode());
            assertEquals(refused.asString(), replay.asString());
            assertEquals(1, operationRows(refusedId));
            // The same command id with another item or revision is a changed input, not a replay.
            for (String changed : new String[] {ackJson(refusedId, b, LICENCE, rev), ackJson(refusedId, b, AGREEMENT, rev + 1)}) {
                Response r = j.post("alex", "complete", changed);
                assertEquals(409, r.statusCode(), r.asString());
                assertEquals("command-input-changed", body(r).get("code").asText());
            }
            // A stale revision (one behind the bump the refusal made) is a conflict that shows the current one.
            long current = revision("alex", b);
            assertTrue(current > 1, "the refusal bumped the revision");
            Response stale = j.post("alex", "complete", ackJson("st-" + id(), b, AGREEMENT, current - 1));
            assertEquals(409, stale.statusCode(), stale.asString());
            assertEquals("stale-version", body(stale).get("code").asText());
            assertEquals(current, body(stale).get("current").get("documentsRevision").asLong());
            assertEquals(current, revision("alex", b));
            assertIncomplete("alex", b, AGREEMENT);

            // 9. AC2: acknowledged without matching evidence is pending, never complete.
            long fresh = revision("alex", b);
            String pendingId = "pen-" + id();
            String pendingBody = ackJson(pendingId, b, AGREEMENT, fresh);
            List<Function<DocumentProviderPort.Acknowledgement, DocumentProviderPort.Result>> weak = List.of(
                    ak -> acknowledged(ak.operationId(), null),
                    ak -> acknowledged(ak.operationId(), "another-operation"),
                    ak -> acknowledged("another-operation", "another-operation"));
            String operationId = null;
            for (int i = 0; i < weak.size(); i++) {
                swap(wiring, new Scripted(weak.get(i)));
                Response r = j.post("alex", i == 0 ? "complete" : "acknowledge", pendingBody);
                assertEquals(202, r.statusCode(), "variant " + i + " " + r.asString());
                assertEquals("pending", body(r).get("status").asText());
                assertEquals("acknowledgement-pending", body(r).get("code").asText());
                assertNotNull(body(r).get("operationId"));
                if (operationId == null) operationId = body(r).get("operationId").asText();
                assertEquals(operationId, body(r).get("operationId").asText());
                assertEquals("pending", j.text("SELECT state FROM pending_operations WHERE operation_id = ?", operationId));
                assertIncomplete("alex", b, AGREEMENT);
                assertEquals(1, operationRows(pendingId));
            }

            // 10. The synthetic provider reconciles the same command to complete, with matching evidence.
            swap(wiring, synthetic);
            Response settled = j.post("alex", "acknowledge", pendingBody);
            assertEquals(200, settled.statusCode(), settled.asString());
            JsonNode alexDone = body(settled).get("value").get("order");
            JsonNode evidence = item(alexDone, AGREEMENT).get("acknowledgement");
            assertEquals("complete", item(alexDone, AGREEMENT).get("status").asText());
            assertEquals("synthetic-acknowledgement", evidence.get("kind").asText());
            assertEquals(operationId, evidence.get("operationId").asText());
            assertEquals("acknowledged", j.text("SELECT state FROM pending_operations WHERE operation_id = ?", operationId));
            assertEquals("complete", dbStatus(b, AGREEMENT));
            // Both paths answer with the same shape.
            assertEquals(sortedNames(done), sortedNames(alexDone));
            assertEquals(sortedNames(item(done, AGREEMENT)), sortedNames(item(alexDone, AGREEMENT)));
            assertEquals(sortedNames(item(done, AGREEMENT).get("acknowledgement")), sortedNames(evidence));
        } finally {
            swap(wiring, synthetic);
        }

        // 11. Time passes: the scheme team and retailer finish, and both orders become ready.
        assertEquals(ITEMS.subList(1, 4), texts(j.readinessValue("greg", b).get("blocking")));
        j.advanceAndTick(opened.plusSeconds(86_401));
        assertEquals(List.of("delivery-to-retailer"), texts(j.readinessValue("greg", a).get("blocking")));
        assertFalse(j.readinessValue("greg", a).get("ready").asBoolean());
        j.advanceAndTick(opened.plusSeconds(172_801));
        for (String order : new String[] {a, b}) {
            JsonNode ready = j.readinessValue("greg", order);
            assertTrue(ready.get("ready").asBoolean(), ready.toString());
            assertTrue(ready.get("documentsComplete").asBoolean());
            assertTrue(ready.get("vehicleReady").asBoolean());
            assertEquals(List.of(), texts(ready.get("blocking")));
        }
    }

    private static List<String> sortedNames(JsonNode object) {
        return DocumentsJourneySupport.sorted(object);
    }
}
