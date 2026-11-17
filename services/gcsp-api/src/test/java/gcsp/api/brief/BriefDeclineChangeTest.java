package gcsp.api.brief;

import static gcsp.api.brief.Harness.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** brief/change-after-decline over the fixture schema with recorded decisions and a real confirmed history. */
class BriefDeclineChangeTest {

    BriefFixture f;
    Harness h;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
        h.saveOk(h.three());
        h.ok(f.service.confirm(f.scope, h.at(f.nextId())));
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    /** One recorded decision; replica mode skips the offer, hold and stock rows this check does not read. */
    private void decision(String id, String employee, String kind, long briefVersion) throws SQLException {
        try (Connection c = f.pool().getConnection()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, "
                    + "command_id, input_digest, employee_id, hold_id, decision, reason_code, versions, outcome, decided_at) "
                    + "VALUES (?, 'run-1', ?, ?, 'cmd', repeat('a', 64), ?, 'hold-1', ?, ?, ?::jsonb, '{}'::jsonb, now())")) {
                ps.setString(1, BriefFixture.ENV);
                ps.setString(2, "offer-" + id);
                ps.setString(3, id);
                ps.setString(4, employee);
                ps.setString(5, kind);
                ps.setString(6, "decline".equals(kind) ? "body-style" : null);
                ps.setString(7, "{\"brief\":" + briefVersion + ",\"policy\":\"gcsp-policy-v1\"}");
                ps.executeUpdate();
            }
        }
    }

    private ObjectNode request(String command, String decisionId, String path, JsonNode value) {
        ObjectNode r = obj().put("commandId", command).put("expectedBriefVersion", h.briefVersion()).put("decisionId", decisionId);
        r.putObject("change").put("path", path).set("value", value);
        return r;
    }

    private static JsonNode text(String v) {
        return Json.M.getNodeFactory().textNode(v);
    }

    @Test
    void aDeclineIsAnsweredByOneNewConfirmedVersionThatRecordsTheChange() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        long before = h.briefVersion();
        JsonNode out = h.ok(f.service.changeAfterDecline(f.scope, request("c-1", "d1", "preferences.body.value", text("suv"))));
        assertTrue(PreviewShapes.currentValue(out), out.toString());
        JsonNode brief = out.get("brief");
        assertEquals(before + 1, brief.get("briefVersion").longValue());
        assertEquals(before, brief.get("previousBriefVersion").longValue());
        assertEquals("suv", brief.get("preferences").get("body").get("value").asText());
        JsonNode change = brief.get("postDeclineChange");
        assertEquals("d1", change.get("decisionId").asText());
        assertEquals("offer-d1", change.get("offerId").asText());
        assertEquals(before, change.get("fromBriefVersion").longValue());
        assertEquals("preferences.body.value", change.get("path").asText());
        assertEquals(Harness.list("saloon", "estate"), change.get("before"));
        assertEquals("suv", change.get("after").asText());
        assertEquals("principal-1", change.get("confirmedBy").asText());
        assertEquals("brief-changed", out.get("event").get("eventType").asText());
        assertEquals("changed-after-decline", out.get("event").get("operation").asText());
        assertEquals("changed-after-decline", h.operation(before + 1));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_id = ?", "brief:emp-1:" + (before + 1)));
        // The stored brief and the history read back with the audit; the editable content carries none of it.
        assertEquals(change, h.current().get("brief").get("postDeclineChange"));
        assertFalse(f.text("SELECT content::text FROM briefs WHERE brief_version = " + (before + 1)).contains("postDeclineChange"));
        assertEquals(before + 1, h.briefVersion());
    }

    @Test
    void theSameCommandReplaysAndAChangedInputIsRefused() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        ObjectNode req = request("c-1", "d1", "preferences.body.value", text("suv"));
        JsonNode first = h.ok(f.service.changeAfterDecline(f.scope, req));
        List<Long> after = f.snapshot();
        BriefResult again = f.service.changeAfterDecline(f.scope, req);
        assertTrue(((BriefResult.Ok) again).replayed());
        assertEquals(first, ((BriefResult.Ok) again).value());
        assertEquals(after, f.snapshot());
        ObjectNode changed = req.deepCopy();
        ((ObjectNode) changed.get("change")).put("value", "estate");
        h.refused(f.service.changeAfterDecline(f.scope, changed), 409, "command-input-changed");
    }

    @Test
    void aSecondChangeForTheSameDeclineConflictsEvenWithANewCommand() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        h.ok(f.service.changeAfterDecline(f.scope, request("c-1", "d1", "preferences.body.value", text("suv"))));
        BriefResult.Refusal r = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-2", "d1", "preferences.sportiness.value", Json.M.getNodeFactory().numberNode(60))), 409,
                "decline-change-already-recorded");
        assertEquals(2, r.body().get("current").get("briefVersion").intValue());
    }

    @Test
    void anotherEmployeesDeclineANonDeclineAnUnknownIdAndAnUnapprovedVersionAreRefused() throws Exception {
        decision("other", "emp-2", "decline", 1);
        decision("acc", "emp-1", "accept", 1);
        decision("far", "emp-1", "decline", 9);
        List<Long> before = f.snapshot();
        BriefResult.Refusal forbidden = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-1", "other", "preferences.body.value", text("suv"))), 403, "decline-not-owned");
        assertEquals("The decline belongs to another employee.", forbidden.reason());
        BriefResult.Refusal accept = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-2", "acc", "preferences.body.value", text("suv"))), 400, "invalid-brief");
        assertEquals("A recorded decline is required.", accept.reason());
        BriefResult.Refusal far = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-3", "far", "preferences.body.value", text("suv"))), 400, "invalid-brief");
        assertEquals("The decline must reference an approved brief version.", far.reason());
        assertEquals("decisionId", far.body().get("reasons").get(0).get("field").asText());
        BriefResult.Refusal unknown = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-4", "nobody", "preferences.body.value", text("suv"))), 404, "not-found");
        assertEquals("decisions", unknown.body().get("resourceType").asText());
        assertEquals(before, f.snapshot(), "a refused change writes nothing");
    }

    @Test
    void aStaleBriefVersionAndAMissingBriefAreRefusedAndNothingIsWritten() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        ObjectNode stale = request("c-1", "d1", "preferences.body.value", text("suv"));
        stale.put("expectedBriefVersion", 7);
        List<Long> before = f.snapshot();
        BriefResult.Refusal r = h.refused(f.service.changeAfterDecline(f.scope, stale), 409, "stale-version");
        assertEquals(7, r.body().get("expectedVersion").intValue());
        assertEquals(h.briefVersion(), r.body().get("currentVersion").longValue());
        assertEquals("briefs", r.body().get("resource").get("table").asText());
        assertEquals(before, f.snapshot());
        BriefScope nobody = new BriefScope(BriefFixture.ENV, "run-1", "emp-9", "principal-9", BriefFixture.POLICY);
        ObjectNode none = request("c-9", "d1", "preferences.body.value", text("suv")).put("expectedBriefVersion", 0);
        h.refused(f.service.changeAfterDecline(nobody, none), 404, "not-found");
    }

    @Test
    void theNodeMessagesAreVerbatimForUnchangedUnknownAndUnconfirmedChanges() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        BriefResult.Refusal same = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-1", "d1", "preferences.body.value", Harness.list("saloon", "estate"))), 400, "invalid-brief");
        assertEquals("Confirm a different value.", same.reason());
        assertEquals("change.value", same.body().get("reasons").get(0).get("field").asText());
        BriefResult.Refusal unknown = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-2", "d1", "preferences.fuel.value", text("ev"))), 400, "invalid-brief");
        assertEquals("Change an existing registered field with an explicitly confirmed value.", unknown.reason());
        assertEquals("change.path", unknown.body().get("reasons").get(0).get("field").asText());
        BriefResult.Refusal essential = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-3", "d1", "essentials.charging", text("home"))), 400, "invalid-brief");
        assertEquals("change.value", essential.body().get("reasons").get(0).get("field").asText());
        assertEquals("change.path", h.refused(f.service.changeAfterDecline(f.scope,
                request("c-4", "d1", "essentials.nothing", text("home"))), 400, "invalid-brief")
                .body().get("reasons").get(0).get("field").asText());
        assertEquals(0, f.count("SELECT count(*) FROM briefs WHERE operation = 'changed-after-decline'"));
    }

    @Test
    void aValueTheRegistryRejectsLeavesTheBriefUntouched() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        long version = h.briefVersion();
        BriefResult.Refusal r = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-1", "d1", "preferences.body.value", text("spaceship"))), 400, "invalid-brief");
        assertEquals("preferences.body", r.body().get("reasons").get(0).get("field").asText());
        assertEquals(version, h.briefVersion());
    }

    @Test
    void aMissingTargetIsAddedOnlyWhenAnAdoptedFollowUpQuestionCoversItWithinItsControl() throws Exception {
        decision("d1", "emp-1", "decline", 1);
        ObjectNode fuel = request("c-1", "d1", "preferences.fuel.value", text("ev"));
        assertEquals("change.path", h.refused(f.service.changeAfterDecline(f.scope, fuel), 400, "invalid-brief")
                .body().get("reasons").get(0).get("field").asText(), "no adopted follow-up set: nothing can be added");
        f.policy.followup = BriefFixture.Policy.retainedFollowup();
        BriefResult.Refusal bad = h.refused(f.service.changeAfterDecline(f.scope,
                request("c-2", "d1", "preferences.fuel.value", text("steam"))), 400, "invalid-brief");
        assertEquals("change.value", bad.body().get("reasons").get(0).get("field").asText());
        JsonNode out = h.ok(f.service.changeAfterDecline(f.scope, request("c-3", "d1", "preferences.fuel.value", text("ev"))));
        JsonNode added = out.get("brief").get("preferences").get("fuel");
        assertEquals("ev", added.get("value").asText());
        assertEquals("confirmed", added.get("valueState").asText());
        assertEquals("confirmed", added.get("importanceState").asText());
        assertTrue(added.get("importance").isNumber());
        assertEquals("null", out.get("brief").get("postDeclineChange").get("before").toString());
        assertTrue(PreviewShapes.currentValue(out));
    }

    @Test
    void theMigrationAcceptsTheNewOperationAndStillKeepsEveryOldOne() throws Exception {
        for (String op : new String[] {"confirmed", "engaged", "disengaged", "paused", "resumed", "preferences-updated",
                "changed-after-decline"}) {
            String check = f.text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'briefs'::regclass "
                    + "AND conname = 'briefs_operation_check'");
            assertTrue(check.contains("'" + op + "'"), op + " in " + check);
        }
        assertThrows(SQLException.class, () -> f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, "
                + "previous_brief_version, operation, content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, "
                + "command_id) VALUES (?, 'run-1', 'emp-1', 50, 49, 'made-up', '{}', '{}', repeat('a', 64), 'p', 'x', now(), 'c')",
                BriefFixture.ENV));
        assertThrows(SQLException.class, () -> f.update("UPDATE briefs SET post_decline_change = '[]'::jsonb"));
        assertNotEquals(null, f.text("SELECT column_name FROM information_schema.columns WHERE table_name = 'briefs' "
                + "AND column_name = 'post_decline_change' AND table_schema = '" + f.schema + "'"));
    }
}
