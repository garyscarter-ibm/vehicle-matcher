package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.TransactionRunner;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** ManualDrafts over a real PostgreSQL schema seeded with the paula golden; skips without GCSP_TEST_DATABASE_URL. */
class ManualDraftsDbTest {

    private static final com.fasterxml.jackson.databind.node.JsonNodeFactory F = GoldenFixture.JSON.getNodeFactory();
    private static final String SUB = "sub-paula";

    GoldenFixture fx;
    RepositoryFixture db;
    ManualDrafts drafts;
    AccountScope scope;
    Map<String, String> caller;

    @BeforeEach
    void setUp() throws Exception {
        db = RepositoryFixture.create();
        fx = new GoldenFixture("paula");
        db.claim(fx);
        db.seed(fx);
        build(fx.service(db.records()));
        caller = Map.of("employeeId", fx.scope.employeeId(), "environmentId", fx.scope.environmentId(),
                "runId", fx.scope.runId());
    }

    private void build(AccountService accounts) throws Exception {
        drafts = new ManualDrafts(accounts, db.pool(), new TransactionRunner(db.pool()));
        scope = new AccountScope(fx.scope.environmentId(), fx.scope.runId(), fx.scope.employeeId(), null, fx.scope.roles(),
                null, null, null, null, fx.scope.policyVersion());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (db != null) db.close();
    }

    private String context() {
        return fx.service(wrap()).readAccount(scope).value().get("contextVersion").asText();
    }

    private AccountRecordsPort wrap() {
        try {
            return db.records();
        } catch (java.sql.SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private ObjectNode save(String commandId, long expectedDraft, String expectedContext, JsonNode choices) {
        ObjectNode in = F.objectNode().put("commandId", commandId).put("expectedDraftVersion", expectedDraft)
                .put("expectedContextVersion", expectedContext);
        in.set("choices", choices);
        return body(drafts.save(scope, SUB, in));
    }

    private ObjectNode discard(String commandId, long expectedDraft) {
        return body(drafts.discard(scope, SUB, F.objectNode().put("commandId", commandId).put("expectedDraftVersion", expectedDraft)));
    }

    private ObjectNode read() {
        return body(drafts.read(scope));
    }

    private static ObjectNode body(AccountOutcome o) {
        if (o.isOk()) {
            ObjectNode b = F.objectNode().put("status", "ok");
            b.set("value", o.value());
            return b;
        }
        return (ObjectNode) o.refusal();
    }

    private long rows() throws Exception {
        try (Connection c = db.pool().getConnection(); PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM manual_drafts");
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private void hold(String id, String state) throws Exception {
        db.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state) VALUES (?, ?, ?, 'cfg', 'available')",
                fx.scope.environmentId(), fx.scope.runId(), "car-" + id);
        db.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, hold_type, "
                + "state, expires_at) VALUES (?, ?, ?, ?, ?, 'slot-paula', 1, 'cart', ?, now() + interval '1 hour')",
                fx.scope.environmentId(), fx.scope.runId(), id, "car-" + id, fx.scope.employeeId(), state);
    }

    private static void stale(ObjectNode b, String resource, JsonNode expected, long current) {
        assertEquals("stale-version", b.get("status").asText(), b.toString());
        assertEquals(resource, b.get("resource").asText());
        assertEquals(expected.asText(), b.get("expectedVersion").asText());
        assertEquals(current, b.get("currentVersion").asLong());
        assertEquals("refresh", b.get("action").asText());
        assertEquals("conflict", b.get("view").get("state").asText());
        assertFalse(b.get("view").get("editable").asBoolean());
        assertEquals("employee", b.get("view").get("supportOwner").asText());
        assertEquals("refresh-review", b.get("view").get("action").asText());
    }

    @Test
    void saveReadReplayAndChangedInputConflict() throws Exception {
        ObjectNode absent = read();
        assertEquals("not-found", absent.get("status").asText());
        assertEquals("manual-draft", absent.get("resourceType").asText());

        String ctx = context();
        ObjectNode saved = save("c-1", 0, ctx, ManualDraftRulesTest.intent());
        ManualDraftShapes.assertOkDraft(saved, caller);
        JsonNode v = saved.get("value");
        assertEquals(1, v.get("draftVersion").asInt());
        assertEquals("intent", v.get("draftStage").asText());
        assertTrue(v.get("previousDraftVersion").isNull());
        assertEquals(SUB, v.get("savedBy").asText());
        assertEquals(fx.now, v.get("savedAt").asText());
        assertEquals(ctx, v.get("contextVersion").asText());
        assertEquals(3, v.get("sources").get("employee").asInt());
        assertEquals(2, v.get("sources").get("slot").asInt());

        ObjectNode got = read();
        ManualDraftShapes.assertOkDraft(got, caller);
        assertFalse(got.get("value").get("requiresRefresh").asBoolean());
        JsonNode stored = got.get("value").deepCopy();
        ((ObjectNode) stored).remove("requiresRefresh");
        assertEquals(v, stored);

        assertEquals(saved, save("c-1", 0, ctx, ManualDraftRulesTest.intent()), "same command and input replays the stored answer");
        assertEquals(1, rows());

        ObjectNode changed = save("c-1", 0, ctx, ManualDraftRulesTest.complete());
        assertEquals("conflict", changed.get("status").asText());
        assertEquals("idempotency-input-changed", changed.get("reason").asText());
        assertTrue(changed.get("current").isObject());
        ManualDraftShapes.assertFailure(changed, caller);
        assertEquals(1, rows());
    }

    @Test
    void completeSaveCarriesDependencyInvalidationsAndTheCounter() throws Exception {
        String ctx = context();
        save("c-1", 0, ctx, ManualDraftRulesTest.intent());
        ObjectNode second = save("c-2", 1, ctx, ManualDraftRulesTest.complete());
        ManualDraftShapes.assertOkDraft(second, caller);
        JsonNode v = second.get("value");
        assertEquals(2, v.get("draftVersion").asInt());
        assertEquals(1, v.get("previousDraftVersion").asInt());
        assertEquals("complete", v.get("draftStage").asText());
        assertEquals(1, v.get("dependentGeneration").asInt());
        assertEquals("[\"driverId\",\"contractOptionId\",\"requestedCollectionDate\",\"collectionLocationId\",\"brand\","
                + "\"selection\",\"quote\",\"eligible-stock\"]", v.get("invalidations").toString());
        assertEquals("browse-stock", v.get("view").get("action").asText());
        assertEquals("twelve-month-12000", v.get("contract").get("contractOptionId").asText());
        ObjectNode third = save("c-3", 2, ctx, ManualDraftRulesTest.complete());
        assertEquals(0, third.get("value").get("invalidations").size());
        assertEquals(1, third.get("value").get("dependentGeneration").asInt());
    }

    @Test
    void staleDraftAndContextVersionsAreAnsweredAsStale() throws Exception {
        String ctx = context();
        save("c-1", 0, ctx, ManualDraftRulesTest.intent());
        stale(save("c-2", 0, ctx, ManualDraftRulesTest.intent()), "manual-draft", F.numberNode(0), 1);
        stale(save("c-3", 5, ctx, ManualDraftRulesTest.intent()), "manual-draft", F.numberNode(5), 1);
        ObjectNode other = save("c-4", 1, "not-the-context", ManualDraftRulesTest.intent());
        stale(other, "manual-context", F.textNode("not-the-context"), 0);
        assertEquals(ctx, other.get("currentVersion").asText());
        ManualDraftShapes.assertFailure(other, caller);
        assertEquals(1, rows());
    }

    @Test
    void refusedSavesAreNotStoredSoTheCommandIdCanBeReused() throws Exception {
        String ctx = context();
        ObjectNode bad = ManualDraftRulesTest.complete();
        bad.put("brand", "ford");
        ObjectNode refused = save("c-1", 0, ctx, bad);
        assertEquals("invalid", refused.get("status").asText());
        assertEquals("brand", refused.get("reasons").get(0).get("field").asText());
        ManualDraftShapes.assertFailure(refused, caller);
        assertEquals(0, rows());
        ManualDraftShapes.assertOkDraft(save("c-1", 0, ctx, ManualDraftRulesTest.complete()), caller);
        assertEquals(1, rows());
    }

    @Test
    void malformedCommandsAreInvalidCommand() {
        assertEquals("command", body(drafts.save(scope, SUB, F.objectNode())).get("reasons").get(0).get("field").asText());
        assertEquals("invalid-manual-draft", body(drafts.save(scope, SUB, F.objectNode())).get("code").asText());
        ObjectNode longId = F.objectNode().put("commandId", "x".repeat(129)).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", "c");
        longId.set("choices", F.objectNode());
        assertEquals("command", body(drafts.save(scope, SUB, longId)).get("reasons").get(0).get("field").asText());
        ObjectNode extra = F.objectNode().put("commandId", "x").put("expectedDraftVersion", 0).put("expectedContextVersion", "c")
                .put("employeeId", "employee-jordan");
        extra.set("choices", F.objectNode());
        assertEquals("command", body(drafts.save(scope, SUB, extra)).get("reasons").get(0).get("field").asText());
        ObjectNode negative = F.objectNode().put("commandId", "x").put("expectedDraftVersion", -1).put("expectedContextVersion", "c");
        negative.set("choices", F.objectNode());
        assertEquals("command", body(drafts.save(scope, SUB, negative)).get("reasons").get(0).get("field").asText());
        assertEquals("command", body(drafts.discard(scope, SUB, F.objectNode().put("commandId", "x"))).get("reasons").get(0).get("field").asText());
        assertEquals("command", body(drafts.discard(scope, SUB, F.objectNode().put("commandId", "x")
                .put("expectedDraftVersion", 0).put("slotId", "s"))).get("reasons").get(0).get("field").asText());
    }

    @Test
    void discardKeepsTheCounterAndLeavesNothingToCarryForward() throws Exception {
        String ctx = context();
        assertEquals("not-found", discard("d-0", 0).get("status").asText());
        save("c-1", 0, ctx, ManualDraftRulesTest.complete());
        stale(discard("d-1", 0), "manual-draft", F.numberNode(0), 1);
        ObjectNode gone = discard("d-2", 1);
        ManualDraftShapes.assertOkDiscard(gone, caller);
        JsonNode v = gone.get("value");
        assertEquals(2, v.get("draftVersion").asInt());
        assertEquals(1, v.get("previousDraftVersion").asInt());
        assertEquals("slot-paula", v.get("entitlementSlotId").asText());
        assertTrue(v.get("discarded").asBoolean());
        assertEquals(fx.now, v.get("discardedAt").asText());
        assertEquals(SUB, v.get("discardedBy").asText());
        assertEquals(1, v.get("schemaVersion").asInt());

        assertEquals(gone, discard("d-2", 1), "replay");
        assertEquals("conflict", discard("d-2", 0).get("status").asText());
        ObjectNode absent = read();
        assertEquals("not-found", absent.get("status").asText());
        assertEquals("manual-draft", absent.get("resourceType").asText());
        assertEquals("not-found", discard("d-3", 2).get("status").asText(), "already discarded");

        ObjectNode again = save("c-2", 2, ctx, ManualDraftRulesTest.complete());
        ManualDraftShapes.assertOkDraft(again, caller);
        assertEquals(3, again.get("value").get("draftVersion").asInt());
        assertEquals(2, again.get("value").get("previousDraftVersion").asInt());
        assertEquals(0, again.get("value").get("invalidations").size());
        assertEquals(0, again.get("value").get("dependentGeneration").asInt());
        assertEquals(3, rows());
    }

    @Test
    void anOccupyingCartHoldBlocksSaveAndDiscardUntilReleased() throws Exception {
        String ctx = context();
        save("c-1", 0, ctx, ManualDraftRulesTest.intent());
        hold("h-1", "active");
        for (ObjectNode b : List.of(save("c-2", 1, ctx, ManualDraftRulesTest.intent()), discard("d-1", 1))) {
            assertEquals("conflict", b.get("status").asText(), b.toString());
            assertEquals("release-required", b.get("reason").asText());
            assertEquals("release-before-change", b.get("view").get("action").asText());
            assertEquals("conflict", b.get("view").get("state").asText());
            assertFalse(b.get("view").get("editable").asBoolean());
            ManualDraftShapes.assertFailure(b, caller);
        }
        db.update("UPDATE custody_holds SET state = 'released' WHERE hold_id = 'h-1'");
        ManualDraftShapes.assertOkDiscard(discard("d-1", 1), caller);
        hold("h-2", "allocated");
        assertEquals("release-required", save("c-3", 2, ctx, ManualDraftRulesTest.intent()).get("reason").asText());
    }

    @Test
    void anOrderingStateThatIsNotReadyIsAConflictWithTheStateView() throws Exception {
        String ctx = context();
        db.update("UPDATE entitlement_slots SET attributes = jsonb_set(attributes, '{state}', '\"disabled\"')");
        ObjectNode b = save("c-1", 0, ctx, ManualDraftRulesTest.intent());
        assertEquals("conflict", b.get("status").asText());
        assertEquals("no-entitlement", b.get("reason").asText());
        assertEquals("no-entitlement", b.get("view").get("state").asText());
        assertFalse(b.get("view").get("editable").asBoolean());
        assertEquals("contact-support", b.get("view").get("action").asText());
        assertTrue(b.get("view").get("fields").isObject());
        ManualDraftShapes.assertFailure(b, caller);
        assertEquals(0, rows());
    }

    @Test
    void aChangedContextMakesTheSavedDraftRequireRefresh() throws Exception {
        String ctx = context();
        save("c-1", 0, ctx, ManualDraftRulesTest.complete());
        db.update("UPDATE employee_account_records SET version = version + 1");
        ObjectNode got = read();
        ManualDraftShapes.assertOkDraft(got, caller);
        JsonNode v = got.get("value");
        assertTrue(v.get("requiresRefresh").asBoolean());
        assertEquals("[\"context\",\"selection\",\"quote\",\"eligible-stock\"]", v.get("invalidations").toString());
        assertTrue(v.get("selection").isNull());
        assertTrue(v.get("quote").isNull());
        assertEquals("context-changed", v.get("view").get("state").asText());
        assertFalse(v.get("view").get("editable").asBoolean());
        assertEquals("employee", v.get("view").get("supportOwner").asText());
        assertEquals("refresh-review", v.get("view").get("action").asText());
        assertEquals(ctx, v.get("contextVersion").asText(), "the stored version is kept for comparison");
        stale(save("c-2", 1, ctx, ManualDraftRulesTest.complete()), "manual-context", F.textNode(ctx), 0);
        ObjectNode fresh = save("c-3", 1, context(), ManualDraftRulesTest.complete());
        assertEquals(2, fresh.get("value").get("draftVersion").asInt());
        assertEquals("[\"context\",\"selection\",\"quote\",\"eligible-stock\"]", fresh.get("value").get("invalidations").toString());
    }

    /** A records port whose reported versions are one step ahead of the database, as after a racing write. */
    private AccountRecordsPort ahead(int employeeVersion, int slotVersion) throws Exception {
        AccountRecordsPort real = db.records();
        return new AccountRecordsPort() {
            public SourceResult readEmployeeContract(AccountScope s) {
                SourceResult r = real.readEmployeeContract(s);
                ObjectNode v = ((ObjectNode) r.value()).deepCopy();
                v.put("repositoryVersion", employeeVersion);
                v.get("slots").forEach(x -> ((ObjectNode) x).put("version", slotVersion));
                return SourceResult.ok(v);
            }

            public SourceResult readDrivers(AccountScope s) {
                ObjectNode v = ((ObjectNode) real.readDrivers(s).value()).deepCopy();
                v.put("repositoryVersion", employeeVersion);
                return SourceResult.ok(v);
            }

            public SourceResult readEmployment(String e, String r, String id) {
                return real.readEmployment(e, r, id);
            }
        };
    }

    @Test
    void employeeAndSlotVersionsAreCheckedInsideTheTransaction() throws Exception {
        build(fx.service(ahead(9, 2)));
        ObjectNode b = save("c-1", 0, context9(ahead(9, 2)), ManualDraftRulesTest.intent());
        stale(b, "employee-context", F.numberNode(9), 3);
        build(fx.service(ahead(3, 7)));
        stale(save("c-2", 0, context9(ahead(3, 7)), ManualDraftRulesTest.intent()), "entitlement-slot", F.numberNode(7), 2);
        assertEquals(0, rows());
    }

    private String context9(AccountRecordsPort records) {
        return fx.service(records).readAccount(scope).value().get("contextVersion").asText();
    }

    @Test
    void twoSavesOfTheSameNextVersionLeaveOneWinnerAndOneStale() throws Exception {
        String ctx = context();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Callable<ObjectNode> a = () -> {
                ready.countDown();
                go.await();
                return save("race-a", 0, ctx, ManualDraftRulesTest.intent());
            };
            Callable<ObjectNode> b = () -> {
                ready.countDown();
                go.await();
                return save("race-b", 0, ctx, ManualDraftRulesTest.intent());
            };
            var fa = pool.submit(a);
            var fb = pool.submit(b);
            ready.await();
            go.countDown();
            ObjectNode ra = fa.get(30, TimeUnit.SECONDS);
            ObjectNode rb = fb.get(30, TimeUnit.SECONDS);
            ObjectNode win = "ok".equals(ra.get("status").asText()) ? ra : rb;
            ObjectNode lose = win == ra ? rb : ra;
            assertEquals("ok", win.get("status").asText(), ra + " / " + rb);
            stale(lose, "manual-draft", F.numberNode(0), 1);
            assertEquals(1, rows());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void draftsAreImmutableAndOneSetPerEmployee() throws Exception {
        save("c-1", 0, context(), ManualDraftRulesTest.intent());
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                () -> db.update("UPDATE manual_drafts SET discarded = true"));
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class, () -> db.update("DELETE FROM manual_drafts"));
        org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class,
                () -> db.update("INSERT INTO manual_drafts (environment_id, run_id, employee_id, draft_version, value) "
                        + "VALUES (?, ?, ?, 0, '{}'::jsonb)", fx.scope.environmentId(), fx.scope.runId(), "e"));
        assertNotNull(read().get("value"));
    }
}
