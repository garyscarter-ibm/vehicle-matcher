package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.move;
import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.open;
import static gcsp.api.cases.CaseHarness.refused;
import static gcsp.api.cases.CaseHarness.update;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The preference-relaxation remedy over recorded declines and the employee's one post-decline brief change. */
class CaseRelaxationTest {

    private static final String ESSENTIALS = "{\"seats\":{\"value\":5,\"operator\":\"gte\",\"state\":\"confirmed\"}}";
    private static final String PREFERENCES = "{\"body\":{\"value\":[\"hatchback\"]},\"fuel\":{\"value\":[\"petrol\",\"diesel\"]},"
            + "\"sportiness\":{\"value\":40}}";
    private static final String PATH = "preferences.body.value";

    CaseFixture f;

    @BeforeEach
    void setUp() throws SQLException {
        f = CaseFixture.create();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    /** Brief v1 confirmed for the employee, plus the head row. */
    private void brief1(String employee) throws SQLException {
        f.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 1)",
                CaseFixture.ENV, CaseFixture.RUN, employee);
        brief(employee, 1, "confirmed", PREFERENCES, "principal-" + employee.substring(4), null);
    }

    private void brief(String employee, int version, String operation, String preferences, String by, String change)
            throws SQLException {
        f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, "
                + "content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id, post_decline_change) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, '{}'::jsonb, repeat('a', 64), ?, ?, '2026-11-05T09:00:00Z', ?, ?::jsonb)",
                CaseFixture.ENV, CaseFixture.RUN, employee, version, version == 1 ? null : version - 1, operation,
                "{\"schemaVersion\":1,\"preferences\":" + preferences + ",\"essentials\":" + ESSENTIALS + "}",
                CaseFixture.POLICY, by, "brief-" + employee + version, change);
    }

    /** A recorded decision; replica mode skips the offer, hold and stock parents this feature does not read. */
    private void decision(String id, String employee, String kind, long briefVersion, String createdAt) throws SQLException {
        try (Connection c = f.pool().getConnection()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO offer_decisions (environment_id, run_id, offer_id, decision_id, "
                    + "command_id, input_digest, employee_id, hold_id, decision, reason_code, versions, outcome, decided_at, created_at) "
                    + "VALUES (?, ?, ?, ?, 'cmd', repeat('a', 64), ?, 'hold-1', ?, ?, ?::jsonb, '{}'::jsonb, now(), ?::timestamptz)")) {
                ps.setString(1, CaseFixture.ENV);
                ps.setString(2, CaseFixture.RUN);
                ps.setString(3, "offer-" + id);
                ps.setString(4, id);
                ps.setString(5, employee);
                ps.setString(6, kind);
                ps.setString(7, "decline".equals(kind) ? "body-style" : null);
                ps.setString(8, "{\"briefVersion\":" + briefVersion + "}");
                ps.setString(9, createdAt);
                ps.executeUpdate();
            }
        }
    }

    private static ObjectNode relax(String decisionId, long version, String path, JsonNode value) {
        return CaseJson.obj().put("type", "preference-relaxation").put("decisionId", decisionId)
                .put("expectedBriefVersion", version).put("path", path).set("value", value);
    }

    private static JsonNode body(String... values) {
        var a = CaseJson.arr();
        for (String v : values) a.add(v);
        return a;
    }

    private JsonNode propose(JsonNode c, ObjectNode remedy) {
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", remedy);
        return ok(f.service.update(f.greg, u)).get("case");
    }

    /** Paula's brief v2 as the employee's decline change writes it: same essentials, the one path changed. */
    private void confirmChange(String decisionId, JsonNode after) throws SQLException {
        ObjectNode change = CaseJson.obj().put("decisionId", decisionId).put("offerId", "offer-" + decisionId)
                .put("fromBriefVersion", 1).put("path", PATH).put("confirmedBy", "principal-paula")
                .put("confirmedAt", "2026-11-05T09:00:00.000Z");
        change.set("before", body("hatchback"));
        change.set("after", after);
        brief("emp-paula", 2, "changed-after-decline", PREFERENCES.replace("[\"hatchback\"]", after.toString()),
                "principal-paula", change.toString());
        f.update("UPDATE brief_heads SET brief_version = 2 WHERE employee_id = 'emp-paula'");
    }

    private JsonNode relaxations(JsonNode c) {
        return ok(f.service.readOptions(f.greg, c.get("caseId").asText())).get("options").get("preferenceRelaxations");
    }

    @Test
    void withoutADeclineOptionsAreEmptyAndTheRemedyIsForbidden() throws SQLException {
        brief1("emp-paula");
        JsonNode c = move(f, open(f), "in-progress");
        JsonNode r = relaxations(c);
        assertFalse(r.get("available").booleanValue());
        assertEquals(0, r.get("items").size());
        assertEquals("A current confirmed brief and an unused recorded decline are required.", r.get("reason").asText());
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", relax("d-1", 1, PATH, body("saloon")));
        CaseResult.Refusal x = refused(f.service.update(f.greg, u), 404, "not-found");
        assertTrue(x.reason().length() > 0);
        // An accept (not a decline) of this employee is refused as forbidden.
        decision("d-acc", "emp-paula", "accept", 1, "2026-11-04T09:00:00Z");
        u.set("remedy", relax("d-acc", 1, PATH, body("saloon")));
        assertEquals("A recorded decline for this employee is required.",
                refused(f.service.update(f.greg, u), 403, "forbidden").reason());
    }

    @Test
    void optionsListEnumAndSliderThenProposalNeedsConfirmationToResolve() throws SQLException {
        brief1("emp-paula");
        decision("d-old", "emp-paula", "decline", 1, "2026-11-03T09:00:00Z");
        decision("d-new", "emp-paula", "decline", 1, "2026-11-04T09:00:00Z");
        JsonNode c = move(f, open(f), "in-progress");
        JsonNode items = relaxations(c).get("items");
        assertEquals(3, items.size());
        JsonNode bodyItem = items.get(0);
        assertEquals("d-new", bodyItem.get("decisionId").asText());
        assertEquals(1, bodyItem.get("expectedBriefVersion").asLong());
        assertEquals(PATH, bodyItem.get("path").asText());
        assertEquals("enum", bodyItem.get("valueType").asText());
        assertEquals(body("hatchback"), bodyItem.get("before"));
        assertEquals(6, bodyItem.get("values").size());
        assertFalse(bodyItem.get("values").toString().contains("hatchback"));
        JsonNode slider = items.get(2);
        assertEquals("slider", slider.get("valueType").asText());
        assertEquals(0, slider.get("minimum").asInt());
        assertEquals(100, slider.get("maximum").asInt());
        assertEquals(40, slider.get("before").asInt());

        JsonNode proposed = propose(c, relax("d-new", 1, PATH, body("saloon")));
        JsonNode remedy = proposed.get("remedy");
        assertEquals("employee-confirmation-required", remedy.get("confirmationState").asText());
        assertFalse(remedy.has("confirmedBy"));
        assertEquals("remedy-proposed", proposed.get("status").asText());

        ObjectNode resolve = update(f, proposed, "resolved");
        CaseResult.Refusal x = refused(f.service.update(f.greg, resolve), 400, "employee-confirmation-required");
        assertTrue(x.reason().startsWith("Paula must confirm the single preference change"));
        ObjectNode explicit = update(f, proposed, "resolved");
        explicit.set("remedy", relax("d-new", 1, PATH, body("saloon")));
        refused(f.service.update(f.greg, explicit), 400, "employee-confirmation-required");
    }

    @Test
    void employeeConfirmationLetsAnUpdateWithoutRemedyResolveAndUsesUpTheDecline() throws SQLException {
        brief1("emp-paula");
        decision("d-1", "emp-paula", "decline", 1, "2026-11-04T09:00:00Z");
        JsonNode proposed = propose(move(f, open(f), "in-progress"), relax("d-1", 1, PATH, body("saloon")));
        confirmChange("d-1", body("saloon"));
        JsonNode resolved = ok(f.service.update(f.greg, update(f, proposed, "resolved"))).get("case");
        JsonNode remedy = resolved.get("remedy");
        assertEquals("resolved", resolved.get("status").asText());
        assertEquals("employee-confirmed", remedy.get("confirmationState").asText());
        assertEquals("principal-paula", remedy.get("confirmedBy").asText());
        assertEquals("2026-11-05T09:00:00.000Z", remedy.get("confirmedAt").asText());
        assertEquals(2, remedy.get("briefVersion").asLong());
        assertEquals(body("saloon"), remedy.get("value"));
        JsonNode r = relaxations(resolved);
        assertFalse(r.get("available").booleanValue());
        assertEquals(0, r.get("items").size());
    }

    @Test
    void aMismatchedChangeDoesNotCountAsConfirmed() throws SQLException {
        brief1("emp-paula");
        decision("d-1", "emp-paula", "decline", 1, "2026-11-04T09:00:00Z");
        JsonNode proposed = propose(move(f, open(f), "in-progress"), relax("d-1", 1, PATH, body("saloon")));
        confirmChange("d-1", body("estate"));
        refused(f.service.update(f.greg, update(f, proposed, "resolved")), 400, "employee-confirmation-required");
    }

    @Test
    void otherDeclinesUnknownDecisionsAndBadPathsAreRefused() throws SQLException {
        brief1("emp-paula");
        brief1("emp-alex");
        decision("d-alex", "emp-alex", "decline", 1, "2026-11-04T09:00:00Z");
        JsonNode c = move(f, open(f), "in-progress");
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", relax("d-alex", 1, PATH, body("saloon")));
        refused(f.service.update(f.greg, u), 403, "forbidden");
        u.set("remedy", relax("d-none", 1, PATH, body("saloon")));
        refused(f.service.update(f.greg, u), 404, "not-found");
        decision("d-1", "emp-paula", "decline", 1, "2026-11-04T09:00:00Z");
        for (String bad : new String[] {"preferences.body", "preferences..value", "preferences.a.b.value", "other.body.value"}) {
            u.set("remedy", relax("d-1", 1, bad, body("saloon")));
            CaseResult.Refusal x = refused(f.service.update(f.greg, u), 400, "invalid-case-command");
            assertEquals("Propose exactly one preference value. Essentials and allowance remain unchanged.", x.reason());
        }
        ObjectNode extra = relax("d-1", 1, PATH, body("saloon"));
        extra.put("surprise", true);
        u.set("remedy", extra);
        refused(f.service.update(f.greg, u), 400, "invalid-case-command");
        u.set("remedy", relax("d-1", 1, "preferences.roof.value", body("x")));
        CaseResult.Refusal x = refused(f.service.update(f.greg, u), 400, "invalid-case-command");
        assertEquals("Choose a preference in the confirmed employee brief.", x.reason());
        assertEquals("remedy.path", x.extra().get("reasons").get(0).get("field").asText());
    }

    @Test
    void readOwnProjectsTheBriefStateForBothStates() throws SQLException {
        brief1("emp-paula");
        decision("d-1", "emp-paula", "decline", 1, "2026-11-04T09:00:00Z");
        JsonNode proposed = propose(move(f, open(f), "in-progress"), relax("d-1", 1, PATH, body("saloon")));
        JsonNode before = ok(f.service.readOwn(f.paula, Optional.of(proposed.get("caseId").asText()))).get("case").get("relaxation");
        assertEquals(1, before.get("currentBriefVersion").asLong());
        assertEquals(body("hatchback"), before.get("before"));
        assertTrue(before.get("applicable").booleanValue());
        assertFalse(before.get("confirmed").booleanValue());
        confirmChange("d-1", body("saloon"));
        JsonNode after = ok(f.service.readOwn(f.paula, Optional.empty())).get("cases").get(0).get("relaxation");
        assertEquals(2, after.get("currentBriefVersion").asLong());
        assertEquals(body("saloon"), after.get("before"));
        assertFalse(after.get("applicable").booleanValue());
        assertTrue(after.get("confirmed").booleanValue());
    }

    @Test
    void casesWithoutARelaxationCarryNoProjection() throws SQLException {
        JsonNode c = move(f, move(f, open(f), "in-progress"), "remedy-proposed");
        assertFalse(ok(f.service.readOwn(f.paula, Optional.of(c.get("caseId").asText()))).get("case").has("relaxation"));
    }
}
