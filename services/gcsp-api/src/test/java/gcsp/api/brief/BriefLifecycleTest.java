package gcsp.api.brief;

import static gcsp.api.brief.Harness.choose;
import static gcsp.api.brief.Harness.envelope;
import static gcsp.api.brief.Harness.list;
import static gcsp.api.brief.Harness.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Brief reads, draft resolution, confirmation, concurrency, restart and the store's own guarantees. */
class BriefLifecycleTest {

    BriefFixture f;
    Harness h;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private ObjectNode initial() {
        return ((ObjectNode) h.ok(f.service.resolveInitial(f.scope)).get("initial")).deepCopy();
    }

    private static JsonNode num(int n) {
        return Json.M.getNodeFactory().numberNode(n);
    }

    @Test
    void anEmployeeWithNothingSavedReadsPolicyDefaultsAndNotFoundForTheBrief() throws Exception {
        JsonNode r = h.ok(f.service.resolveInitial(f.scope));
        assertEquals("unconfirmed-policy-defaults", r.get("provenance").asText());
        assertEquals(0, r.get("briefVersion").intValue());
        assertEquals("policy:brief.editor.v1", r.get("initial").get("preferences").get("body").get("source").asText());
        assertEquals("needs-confirmation", r.get("initial").get("essentials").get("charging").get("state").asText());
        h.refused(f.service.current(f.scope), 404, "not-found");
        h.refused(f.service.draft(f.scope), 404, "not-found");
        assertEquals(0, h.ok(f.service.history(f.scope)).get("versions").size());
        // A read creates nothing, not even the head row.
        assertEquals(0, f.count("SELECT count(*) FROM brief_heads"));
    }

    @Test
    void aSavedDraftIsPendingUntilConfirmedThenTheBriefIsThePlainSavedContent() throws Exception {
        // Start from the policy defaults so the unchosen ones stay visibly untouched after confirmation.
        ObjectNode withDefaults = initial();
        choose(withDefaults, "body", list("saloon", "estate"), 50);
        choose(withDefaults, "sportiness", num(50), 50);
        choose(withDefaults, "economy", num(50), 50);
        h.saveOk(withDefaults);
        assertEquals("saved-draft", h.ok(f.service.resolveInitial(f.scope)).get("provenance").asText());
        JsonNode out = h.ok(f.service.confirm(f.scope, h.at("confirm-1")));
        JsonNode brief = out.get("brief");
        assertEquals(1, brief.get("briefVersion").intValue());
        assertTrue(brief.get("previousBriefVersion").isNull());
        assertEquals("confirmed", brief.get("operation").asText());
        assertFalse(brief.get("buddy").get("searchConsent").booleanValue());
        assertFalse(out.get("activity").get("canSearch").booleanValue());
        assertEquals("confirmed", brief.get("preferences").get("body").get("valueState").asText());
        assertTrue(brief.get("essentials").get("charging").get("state").asText().equals("needs-confirmation"));
        // The unchosen policy defaults stay untouched, so they still never count as considered.
        assertEquals("policy:brief.editor.v1", brief.get("preferences").get("fuel").get("source").asText());
        assertEquals("draft", brief.get("preferences").get("fuel").get("valueState").asText());
        assertEquals("approved-brief", h.ok(f.service.resolveInitial(f.scope)).get("provenance").asText());
        assertEquals(1, h.ok(f.service.history(f.scope)).get("versions").size());
    }

    @Test
    void confirmWithConsentNeedsTheGateAndTakesTheGrantsFromPolicy() throws Exception {
        ObjectNode b = h.sparse();
        choose(b, "body", list("saloon"), 50);
        h.saveOk(b);
        ObjectNode consent = h.at("c-1");
        consent.set("consent", obj().put("search", true).put("hold", true));
        h.refused(f.service.confirm(f.scope, consent), 400, "engagement-minimum");
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
        h.saveOk(h.three());
        ObjectNode ok = h.at("c-2");
        ok.set("consent", obj().put("search", true).put("hold", true));
        JsonNode out = h.ok(f.service.confirm(f.scope, ok));
        assertTrue(out.get("activity").get("canSearch").booleanValue());
        assertEquals(1, out.get("brief").get("buddy").get("permissionVersion").intValue());
        // Split grants are refused, and a malformed consent never reaches the database.
        ObjectNode split = h.at("c-3");
        split.set("consent", obj().put("search", true).put("hold", false));
        h.refused(f.service.confirm(f.scope, split), 400, "invalid-command");
        // Grants come from policy, not from the request.
        f.policy.edit(BriefAssumptions.ENGAGEMENT, v -> ((ObjectNode) v.get("grants")).put("hold", false));
        ObjectNode off = h.at("c-4");
        off.set("consent", obj().put("search", false).put("hold", false));
        h.ok(f.service.confirm(f.scope, off));
        assertFalse(h.current().get("activity").get("canSearch").booleanValue());
        ObjectNode on = h.at("c-5");
        on.set("consent", obj().put("search", true).put("hold", true));
        h.ok(f.service.confirm(f.scope, on));
        JsonNode buddy = h.current().get("brief").get("buddy");
        assertTrue(buddy.get("searchConsent").booleanValue());
        assertFalse(buddy.get("holdConsent").booleanValue());
        assertFalse(h.current().get("activity").get("canSearch").booleanValue());
    }

    @Test
    void confirmAndEngageAreNotFoundWithoutADraftOrABrief() throws Exception {
        h.refused(f.service.confirm(f.scope, h.at("c-1")), 404, "not-found");
        h.refused(h.engage(), 404, "not-found");
        h.refused(f.service.pauseSearch(f.scope, h.at("p-1")), 404, "not-found");
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void inferredSuggestionsAreRefusedAtConfirmationButAcceptedInADraft() throws Exception {
        ObjectNode b = h.three();
        ((ObjectNode) b.get("preferences").get("body")).put("valueState", "inferred");
        h.saveOk(b);
        BriefResult.Refusal r = h.refused(f.service.confirm(f.scope, h.at("c-1")), 400, "confirmation-required");
        assertEquals("brief", r.extra().get("reasons").get(0).get("field").asText());
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
    }

    @Test
    void invalidContentIsRefusedWithFieldReasonsAndNothingIsStored() throws Exception {
        ObjectNode b = h.three();
        ((ObjectNode) b.get("preferences").get("sportiness")).put("value", 101);
        ((ObjectNode) b.get("preferences")).set("unknown", obj());
        b.set("extra", obj());
        h.refused(f.service.saveDraft(f.scope, h.at("s-1").set("brief", b)), 400, "invalid-brief");
        assertEquals(0, f.count("SELECT count(*) FROM brief_drafts"));
        ObjectNode c = h.three();
        ((ObjectNode) c.get("preferences").get("sportiness")).put("value", 101);
        ((ObjectNode) c.get("preferences")).set("nope", obj());
        BriefResult.Refusal r2 = h.refused(f.service.saveDraft(f.scope, h.at("s-2").set("brief", c)), 400, "invalid-brief");
        List<String> fields = new ArrayList<>();
        r2.extra().get("reasons").forEach(x -> fields.add(x.get("field").asText()));
        assertTrue(fields.contains("preferences.sportiness") && fields.contains("preferences.nope"), fields.toString());
        assertEquals(0, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void aDraftAlreadyConfirmedIntoALaterVersionIsConsumedNotStaleButAnUnrelatedOneIsStale() throws Exception {
        h.saveOk(h.three());
        h.ok(f.service.confirm(f.scope, h.at("c-1")));
        // The draft (base 0) now differs from the brief only by confirmation state, so it reads as consumed or equal.
        assertEquals("approved-brief", h.ok(f.service.resolveInitial(f.scope)).get("provenance").asText());
        // A later confirmation changes the brief; the old draft was consumed into version 1, so it is not stale.
        ObjectNode next = initial();
        choose(next, "comfort", num(100), 50);
        h.saveOk(next);
        h.ok(f.service.confirm(f.scope, h.at("c-2")));
        assertEquals("approved-brief", h.ok(f.service.resolveInitial(f.scope)).get("provenance").asText());
        // A draft whose content no later version consumed, saved against an older base, is stale.
        f.update("INSERT INTO brief_drafts (environment_id, run_id, employee_id, draft_version, base_brief_version, content, "
                + "semantic_digest, policy_version, saved_by, saved_at, command_id) SELECT environment_id, run_id, employee_id, 9, 1, "
                + "content, repeat('a', 64), policy_version, saved_by, saved_at, 'planted' FROM brief_drafts WHERE draft_version = 2");
        f.update("UPDATE brief_heads SET draft_version = 9");
        BriefResult.Refusal stale = h.refused(f.service.resolveInitial(f.scope), 409, "stale-version");
        assertEquals(1, stale.extra().get("expectedVersion").intValue());
        assertEquals(2, stale.extra().get("currentVersion").intValue());
        assertEquals("refresh", stale.extra().get("action").asText());
    }

    @Test
    void anAcceptedOfferLetsTheReadOnlyBriefIgnoreAPendingDraft() throws Exception {
        h.engaged();
        ObjectNode edit = initial();
        choose(edit, "size", num(3), 50);
        h.saveOk(edit);
        f.offers.list = List.of(new BriefOfferPort.Offer("o", "accepted", 1L));
        assertEquals("approved-brief", h.ok(f.service.resolveInitial(f.scope)).get("provenance").asText());
    }

    @Test
    void theConsumedDraftCheckUsesTheSemanticIndex() throws Exception {
        for (int i = 0; i < 30; i++) {
            ObjectNode b = h.three();
            choose(b, "comfort", num(i), 50);
            h.saveOk(b);
            h.ok(f.service.confirm(f.scope, h.at(f.nextId())));
        }
        try (Connection c = f.pool().getConnection(); var st = c.createStatement()) {
            st.execute("SET enable_seqscan = off");
            try (var rs = st.executeQuery("EXPLAIN SELECT 1 FROM briefs WHERE environment_id = 'test-env' AND run_id = 'run-1' "
                    + "AND employee_id = 'emp-1' AND semantic_digest = repeat('a', 64) AND brief_version > 0 LIMIT 1")) {
                StringBuilder plan = new StringBuilder();
                while (rs.next()) plan.append(rs.getString(1)).append('\n');
                assertTrue(plan.toString().contains("briefs_semantic"), plan.toString());
            }
        }
    }

    @Test
    void sameCommandIdWithChangedInputConflictsAndWritesNothing() throws Exception {
        ObjectNode body = h.at("save-1").set("brief", h.three());
        JsonNode first = h.ok(f.service.saveDraft(f.scope, body));
        BriefResult replay = f.service.saveDraft(f.scope, body);
        assertEquals(first, h.ok(replay));
        assertTrue(((BriefResult.Ok) replay).replayed());
        assertEquals(1, f.count("SELECT count(*) FROM brief_drafts"));
        ObjectNode changed = body.deepCopy();
        ((ObjectNode) changed.get("brief").get("preferences").get("body")).put("importance", 75);
        List<Long> before = f.snapshot();
        h.refused(f.service.saveDraft(f.scope, changed), 409, "command-input-changed");
        assertEquals(before, f.snapshot());
    }

    @Test
    void aRunOnlyEverSeesItsOwnEmployeesBrief() throws Exception {
        h.engaged();
        BriefScope other = new BriefScope(BriefFixture.ENV, "run-1", "emp-2", "principal-2", BriefFixture.POLICY);
        h.refused(f.service.current(other), 404, "not-found");
        assertEquals(0, h.ok(f.service.history(other)).get("versions").size());
        // Command ids are scoped to the actor: emp-2 can reuse an id emp-1 has used.
        h.ok(f.service.saveDraft(other, envelope("shared-id", 0, 0).set("brief", h.three())));
        h.ok(f.service.saveDraft(f.scope, envelope("shared-id", 1, 1).set("brief", initial())));
        assertEquals(1, f.count("SELECT count(*) FROM brief_drafts WHERE employee_id = 'emp-2'"));
    }

    @Test
    void aRetiredRunIsRefusedAsStaleRun() throws Exception {
        f.update("UPDATE runs SET status = 'retired', retired_at = now() WHERE run_id = 'run-1'");
        h.refused(f.service.saveDraft(f.scope, envelope("s", 0, 0).set("brief", h.sparse())), 409, "stale-run");
    }

    @Test
    void twoEngagesWithTheSameExpectedVersionsOnSeparateConnectionsOnlyOneCommits() throws Exception {
        h.saveOk(h.three());
        BriefService other = f.newService(f.pool());
        ObjectNode a = h.at("race-a");
        ObjectNode b = h.at("race-b");
        List<BriefResult> results = race(() -> f.service.engage(f.scope, a), () -> other.engage(f.scope, b));
        assertEquals(1, results.stream().filter(r -> r instanceof BriefResult.Ok).count(), results.toString());
        BriefResult.Refusal loser = (BriefResult.Refusal) results.stream().filter(r -> r instanceof BriefResult.Refusal).findFirst().get();
        // Either the version CAS lost, or the loser started after the winner committed and saw Buddy engaged.
        assertTrue(loser.code().equals("stale-version") || loser.code().equals("already-engaged"), loser.toString());
        assertEquals(409, loser.httpStatus());
        assertEquals(1, f.count("SELECT count(*) FROM briefs"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-changed'"));
        assertEquals(2, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void twoSaversRacingOnTheSameVersionsLeaveExactlyOneDraftAndOneStaleVersion() throws Exception {
        h.saveOk(h.three());
        BriefService other = f.newService(f.pool());
        ObjectNode a = h.at("save-a").set("brief", h.three());
        ObjectNode edited = h.three();
        choose(edited, "comfort", num(5), 50);
        ObjectNode b = envelope("save-b", 0, 1).set("brief", edited);
        List<BriefResult> results = race(() -> f.service.saveDraft(f.scope, a), () -> other.saveDraft(f.scope, b));
        long oks = results.stream().filter(r -> r instanceof BriefResult.Ok).count();
        assertEquals(1, oks, results.toString());
        BriefResult.Refusal loser = (BriefResult.Refusal) results.stream().filter(r -> r instanceof BriefResult.Refusal).findFirst().get();
        assertEquals("stale-version", loser.code());
        assertEquals(409, loser.httpStatus());
        assertEquals(2, f.count("SELECT count(*) FROM brief_drafts"));
        assertEquals(2, f.count("SELECT draft_version FROM brief_heads"));
        assertEquals(2, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void theCasLoserRollsEverythingBackIncludingTheBriefRowAndOutboxEvent() throws Exception {
        h.engaged();
        BriefService other = f.newService(f.pool());
        ObjectNode e1 = initial();
        choose(e1, "comfort", num(10), 50);
        ObjectNode e2 = initial();
        choose(e2, "comfort", num(90), 50);
        ObjectNode a = h.at("edit-a").set("brief", e1);
        ObjectNode b = h.at("edit-b").set("brief", e2);
        List<BriefResult> results = race(() -> f.service.saveDraft(f.scope, a), () -> other.saveDraft(f.scope, b));
        assertEquals(1, results.stream().filter(r -> r instanceof BriefResult.Ok).count(), results.toString());
        assertEquals(2, f.count("SELECT count(*) FROM briefs"));
        assertEquals(2, f.count("SELECT count(*) FROM brief_drafts"));
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-changed'"));
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-draft-saved'"));
        assertEquals(3, f.count("SELECT count(*) FROM command_receipts"));
    }

    @Test
    void aNewConnectionPoolReadsTheSameStateAndReplaysTheOriginalResults() throws Exception {
        h.saveOk(h.three());
        ObjectNode body = h.at("engage-once");
        JsonNode engaged = h.ok(f.service.engage(f.scope, body));
        ObjectNode edit = initial();
        choose(edit, "comfort", num(70), 100);
        JsonNode edited = h.saveOk(edit);
        JsonNode currentBefore = h.current();
        JsonNode draftBefore = h.ok(f.service.draft(f.scope));
        JsonNode historyBefore = h.ok(f.service.history(f.scope));
        long revisionBefore = f.count("SELECT revision FROM runs WHERE run_id = 'run-1'");
        // "Restart": a brand-new data source and service, nothing shared in memory.
        BriefService restarted = f.newService(f.pool());
        assertEquals(currentBefore, h.ok(restarted.current(f.scope)));
        assertEquals(draftBefore, h.ok(restarted.draft(f.scope)));
        assertEquals(historyBefore, h.ok(restarted.history(f.scope)));
        assertEquals(2, h.ok(restarted.resolveInitial(f.scope)).get("briefVersion").intValue());
        BriefResult replay = restarted.engage(f.scope, body);
        assertEquals(engaged, h.ok(replay));
        assertTrue(((BriefResult.Ok) replay).replayed());
        assertEquals(revisionBefore, f.count("SELECT revision FROM runs WHERE run_id = 'run-1'"));
        assertEquals(edited.get("draftVersion").longValue(), h.ok(restarted.draft(f.scope)).get("draftVersion").longValue());
        // The restarted service continues the version chain.
        ObjectNode next = initial();
        choose(next, "size", num(1), 50);
        assertEquals(3, h.ok(restarted.saveDraft(f.scope, envelope("after-restart", 2, 2).set("brief", next)))
                .get("confirmed").get("briefVersion").intValue());
    }

    @Test
    void storedVersionsAreImmutableAndTheChainIsContiguous() throws Exception {
        h.engaged();
        assertThrows(SQLException.class, () -> f.update("UPDATE briefs SET operation = 'confirmed'"));
        assertThrows(SQLException.class, () -> f.update("DELETE FROM brief_drafts"));
        assertThrows(SQLException.class, () -> f.update("UPDATE brief_drafts SET saved_by = 'x'"));
        assertThrows(SQLException.class, () -> f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, "
                + "previous_brief_version, operation, content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, "
                + "command_id) SELECT environment_id, run_id, employee_id, 3, 1, operation, content, buddy, semantic_digest, "
                + "policy_version, confirmed_by, confirmed_at, 'gap' FROM briefs"));
    }

    @Test
    void aChangedNothingCommandWritesNothing() throws Exception {
        h.saveOk(h.three());
        List<Long> before;
        // An engage refused by the gate has no effect; so does a disengage that finds nothing to revoke.
        h.saveOk(h.sparse());
        before = f.snapshot();
        h.refused(h.engage(), 400, "engagement-minimum");
        h.refused(f.service.disengage(f.scope, h.at(f.nextId())), 409, "already-disengaged");
        assertEquals(before, f.snapshot());
    }

    @Test
    void anUnknownFieldOrMissingVersionIsInvalidCommandWithoutTouchingTheDatabase() throws Exception {
        h.refused(f.service.saveDraft(f.scope, obj().put("commandId", "c").put("expectedBriefVersion", 0)), 400, "invalid-command");
        ObjectNode extra = envelope("c", 0, 0).set("brief", h.sparse());
        ((ObjectNode) extra).put("employeeId", "someone-else");
        h.refused(f.service.saveDraft(f.scope, extra), 400, "invalid-command");
        h.refused(f.service.confirm(f.scope, envelope("", 0, 0)), 400, "invalid-command");
        h.refused(f.service.confirm(f.scope, envelope("c", -1, 0)), 400, "invalid-command");
        h.refused(f.service.engage(f.scope, null), 400, "invalid-command");
        assertEquals(0, f.count("SELECT count(*) FROM brief_heads"));
        assertInstanceOf(BriefResult.Refusal.class, f.service.engage(f.scope, obj()));
    }

    private static List<BriefResult> race(Callable<BriefResult> a, Callable<BriefResult> b) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch go = new CountDownLatch(1);
            Future<BriefResult> fa = pool.submit(() -> gated(ready, go, a));
            Future<BriefResult> fb = pool.submit(() -> gated(ready, go, b));
            ready.await();
            go.countDown();
            return List.of(fa.get(30, TimeUnit.SECONDS), fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }

    private static BriefResult gated(CountDownLatch ready, CountDownLatch go, Callable<BriefResult> c) throws Exception {
        ready.countDown();
        go.await();
        return c.call();
    }
}
