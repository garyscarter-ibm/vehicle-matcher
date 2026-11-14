package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.manual;
import static gcsp.api.cases.CaseHarness.move;
import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.open;
import static gcsp.api.cases.CaseHarness.refused;
import static gcsp.api.cases.CaseHarness.update;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The scheme team's updates and remedies: transitions, version checks, remedy rules and the outbox. */
class CaseUpdateTest {

    CaseFixture f;

    @BeforeEach
    void setUp() throws SQLException {
        f = CaseFixture.create();
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void updateMatchesTheNodeFixtureAndWritesOneOutboxRow() throws SQLException {
        JsonNode c = open(f);
        long revision = f.count("SELECT revision FROM runs");
        long outbox = f.count("SELECT count(*) FROM outbox_events");
        JsonNode u = ok(f.service.update(f.greg, update(f, c, "in-progress"))).get("case");
        assertEquals("in-progress", u.get("status").asText());
        assertEquals("Review options with Paula.", u.get("nextAction").asText());
        assertEquals("2026-11-06T12:00:00.000Z", u.get("dueAt").asText());
        assertEquals("2026-11-05T09:00:00.000Z", u.get("lastUpdatedAt").asText());
        assertEquals(2, u.get("version").asLong());
        assertEquals("scheme-team", u.get("owner").get("role").asText());
        JsonNode h = u.get("history").get(1);
        assertEquals("scheme-team", h.get("actorRole").asText());
        assertEquals("principal-greg", h.get("actorId").asText());
        assertEquals("Scheme team reviewed the renewal.", h.get("reason").asText());
        assertFalse(h.has("trigger"));
        assertEquals(revision + 1, f.count("SELECT revision FROM runs"));
        assertEquals(outbox + 1, f.count("SELECT count(*) FROM outbox_events"));
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_id = ?", "case:" + c.get("caseId").asText() + ":update:2"));
    }

    @Test
    void outboxPayloadCarriesTheCaseUpdate() throws Exception {
        JsonNode c = open(f);
        ok(f.service.update(f.greg, update(f, c, "in-progress")));
        String payload = textOf("SELECT payload::text FROM outbox_events WHERE event_id LIKE '%:update:2'");
        JsonNode p = CaseJson.M.readTree(payload);
        assertEquals("renewal-case-update", p.get("messageKind").asText());
        assertEquals("1", p.get("messageVersion").asText());
        assertEquals("emp-paula", p.get("recipientId").asText());
        JsonNode u = p.get("caseUpdate");
        assertEquals(c.get("caseId"), u.get("caseId"));
        assertEquals("run-1", u.get("runId").asText());
        assertEquals("emp-paula", u.get("employeeId").asText());
        assertEquals(2, u.get("caseVersion").asLong());
        assertEquals("in-progress", u.get("status").asText());
        assertEquals("scheme-team", u.get("owner").get("role").asText());
        assertEquals("Review options with Paula.", u.get("nextAction").asText());
        assertEquals("2026-11-06T12:00:00.000Z", u.get("dueAt").asText());
        assertEquals("Scheme team reviewed the renewal.", u.get("reason").asText());
        assertEquals("2026-11-05T09:00:00.000Z", u.get("occurredAt").asText());
        assertTrue(u.get("remedy").isNull());
        assertTrue(u.get("fictional").booleanValue());
        assertEquals("renewal-case-update", textOf("SELECT event_type FROM outbox_events WHERE event_id LIKE '%:update:2'"));
    }

    private String textOf(String sql) throws SQLException {
        try (var c = f.pool().getConnection(); var rs = c.createStatement().executeQuery(sql)) {
            rs.next();
            return rs.getString(1);
        }
    }

    @Test
    void transitionsAreAllowedOrRefused() throws SQLException {
        JsonNode c = open(f);
        List<Long> before = f.snapshot();
        refused(f.service.update(f.greg, update(f, c, "resolved")), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "remedy-proposed")), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "open")), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "bogus")), 400, "invalid-case-command");
        assertEquals(before, f.snapshot());
        c = move(f, c, "in-progress");
        c = move(f, c, "remedy-proposed");
        c = move(f, c, "in-progress");
        c = move(f, c, "resolved");
        refused(f.service.update(f.greg, update(f, c, "in-progress")), 400, "invalid-case-command");
        c = move(f, c, "closed");
        for (String s : List.of("open", "in-progress", "remedy-proposed", "resolved", "closed")) {
            refused(f.service.update(f.greg, withRemedy(update(f, c, s))), 400, "invalid-case-command");
        }
        JsonNode options = ok(f.service.readOptions(f.greg, c.get("caseId").asText()));
        assertEquals(0, options.get("nextStatuses").size());
    }

    private static ObjectNode withRemedy(ObjectNode u) {
        u.set("remedy", manual("x"));
        return u;
    }

    @Test
    void staleVersionRefusesWithBothVersionsAndWritesNothing() throws SQLException {
        JsonNode c = open(f);
        ok(f.service.update(f.greg, update(f, c, "in-progress")));
        List<Long> before = f.snapshot();
        CaseResult.Refusal r = refused(f.service.update(f.greg, update(f, c, "closed")), 409, "stale-version");
        assertEquals(1, r.extra().get("expectedVersion").asLong());
        assertEquals(2, r.extra().get("currentVersion").asLong());
        assertEquals("refresh", r.extra().get("action").asText());
        assertEquals(before, f.snapshot());
    }

    @Test
    void invalidAndUnknownUpdatesAreRefused() throws SQLException {
        JsonNode c = open(f);
        List<Long> before = f.snapshot();
        ObjectNode past = update(f, c, "in-progress").put("dueAt", "2026-11-05T09:00:00.000Z");
        CaseResult.Refusal r = refused(f.service.update(f.greg, past), 400, "invalid-case-command");
        assertEquals("dueAt", r.extra().get("reasons").get(0).get("field").asText());
        refused(f.service.update(f.greg, update(f, c, "in-progress").put("dueAt", "tomorrow")), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "in-progress").put("expectedVersion", 0)), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "in-progress").put("surprise", 1)), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "in-progress").put("caseId", "renewal-nothing")), 404, "not-found");
        assertEquals(before, f.snapshot());
    }

    @Test
    void remedyIsRequiredForProposedAndResolved() throws SQLException {
        JsonNode c = move(f, open(f), "in-progress");
        List<Long> before = f.snapshot();
        refused(f.service.update(f.greg, update(f, c, "remedy-proposed")), 400, "invalid-case-command");
        refused(f.service.update(f.greg, update(f, c, "resolved")), 400, "invalid-case-command");
        assertEquals(before, f.snapshot());
        JsonNode proposed = ok(f.service.update(f.greg, withRemedy(update(f, c, "remedy-proposed")))).get("case");
        assertEquals("manual-decision", proposed.get("remedy").get("type").asText());
        // The stored remedy satisfies a later resolve without resubmitting it.
        JsonNode resolved = ok(f.service.update(f.greg, update(f, proposed, "resolved"))).get("case");
        assertEquals("manual-decision", resolved.get("remedy").get("type").asText());
        assertEquals("x", ok(f.service.readOwn(f.paula, java.util.Optional.empty())).get("cases").get(0).get("remedy").get("decision").asText());
    }

    @Test
    void manualDecisionNeedsADecision() throws SQLException {
        JsonNode c = move(f, open(f), "in-progress");
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", CaseJson.obj().put("type", "manual-decision"));
        CaseResult.Refusal r = refused(f.service.update(f.greg, u), 400, "invalid-case-command");
        assertEquals("remedy.decision", r.extra().get("reasons").get(0).get("field").asText());
        u.set("remedy", CaseJson.obj().put("type", "mystery"));
        assertEquals("remedy.type", refused(f.service.update(f.greg, u), 400, "invalid-case-command").extra().get("reasons").get(0).get("field").asText());
        u.set("remedy", CaseJson.obj().put("decision", "x"));
        refused(f.service.update(f.greg, u), 400, "invalid-case-command");
    }

    @Test
    void contractExtensionIsForbiddenUnderTheSeedPolicyAndDateCheckedWhenPermitted() throws SQLException {
        JsonNode c = move(f, open(f), "in-progress");
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", CaseJson.obj().put("type", "contract-extension").put("until", "2027-03-01"));
        List<Long> before = f.snapshot();
        refused(f.service.update(f.greg, u), 403, "forbidden");
        assertEquals(before, f.snapshot());
        f.policy.set("renewalCase.extension.permitted", BooleanNode.TRUE);
        ObjectNode ok = update(f, c, "remedy-proposed");
        ok.set("remedy", CaseJson.obj().put("type", "contract-extension").put("until", "2027-03-01"));
        JsonNode stored = ok(f.service.update(f.greg, ok)).get("case");
        assertEquals("2027-03-01", stored.get("remedy").get("until").asText());
        c = stored;
        for (String bad : List.of("2026-12-01", "2026-11-30", "2027-02-30", "soon")) {
            ObjectNode b = update(f, c, "resolved");
            b.set("remedy", CaseJson.obj().put("type", "contract-extension").put("until", bad));
            refused(f.service.update(f.greg, b), 400, "invalid-case-command");
        }
        // Unknown contract end: no extension can be checked against it.
        f.account.set("emp-paula", "Paula", "renewal:emp-paula", null);
        ObjectNode unknown = update(f, c, "resolved");
        unknown.set("remedy", CaseJson.obj().put("type", "contract-extension").put("until", "2027-03-01"));
        refused(f.service.update(f.greg, unknown), 400, "invalid-case-command");
    }

    @Test
    void laterReleaseIsValidatedAndStored() throws SQLException {
        JsonNode c = move(f, open(f), "in-progress");
        for (ObjectNode bad : List.of(
                CaseJson.obj().put("type", "later-release").put("releaseAt", "2026-11-05T09:00:00.000Z").put("source", "Plan"),
                CaseJson.obj().put("type", "later-release").put("releaseAt", "soon").put("source", "Plan"),
                CaseJson.obj().put("type", "later-release").put("releaseAt", "2026-12-05T09:00:00.000Z"),
                CaseJson.obj().put("type", "later-release").put("releaseAt", "2026-12-05T09:00:00.000Z").put("source", " "))) {
            ObjectNode u = update(f, c, "remedy-proposed");
            u.set("remedy", bad);
            refused(f.service.update(f.greg, u), 400, "invalid-case-command");
        }
        ObjectNode u = update(f, c, "remedy-proposed");
        u.set("remedy", CaseJson.obj().put("type", "later-release").put("releaseAt", "2026-12-05T09:00:00.000Z").put("source", "Plan"));
        assertEquals("Plan", ok(f.service.update(f.greg, u)).get("case").get("remedy").get("source").asText());
    }

    @Test
    void alternativeCarIsUnavailableAndPreferenceRelaxationIsForbidden() throws SQLException {
        JsonNode c = move(f, open(f), "in-progress");
        List<Long> before = f.snapshot();
        ObjectNode car = update(f, c, "remedy-proposed");
        car.set("remedy", CaseJson.obj().put("type", "alternative-car").put("orderUuid", "order-1"));
        refused(f.service.update(f.greg, car), 503, "case-unavailable");
        ObjectNode badCar = update(f, c, "remedy-proposed");
        badCar.set("remedy", CaseJson.obj().put("type", "alternative-car"));
        refused(f.service.update(f.greg, badCar), 400, "invalid-case-command");
        ObjectNode relax = update(f, c, "remedy-proposed");
        relax.set("remedy", CaseJson.obj().put("type", "preference-relaxation").put("decisionId", "d-1"));
        CaseResult.Refusal r = refused(f.service.update(f.greg, relax), 403, "forbidden");
        assertEquals("A recorded decline for this employee is required.", r.reason());
        assertEquals(before, f.snapshot());
    }

    @Test
    void renewalChangeAndUnavailableContextRefuseTheUpdate() throws SQLException {
        JsonNode c = open(f);
        List<Long> before = f.snapshot();
        f.account.set("emp-paula", "Paula", "renewal:next", "2026-12-01");
        refused(f.service.update(f.greg, update(f, c, "in-progress")), 409, "renewal-changed");
        f.account.set("emp-paula", "Paula", null, "2026-12-01");
        refused(f.service.update(f.greg, update(f, c, "in-progress")), 400, "renewal-context-required");
        f.account.unavailable = true;
        refused(f.service.update(f.greg, update(f, c, "in-progress")), 503, "case-unavailable");
        f.account.unavailable = false;
        f.policy.missing = true;
        refused(f.service.update(f.greg, update(f, c, "in-progress")), 503, "case-unavailable");
        assertEquals(before, f.snapshot());
    }

    @Test
    void updateReplaysAndRefusesChangedInput() throws SQLException {
        JsonNode c = open(f);
        ObjectNode u = update(f, c, "in-progress");
        JsonNode first = ok(f.service.update(f.greg, u));
        CaseResult again = f.service.update(f.greg, u);
        assertTrue(assertInstanceOf(CaseResult.Ok.class, again).replayed());
        assertEquals(gcsp.api.persistence.Canonical.json(first), gcsp.api.persistence.Canonical.json(((CaseResult.Ok) again).value()));
        long outbox = f.count("SELECT count(*) FROM outbox_events");
        ObjectNode changed = u.deepCopy().put("nextAction", "Something else");
        refused(f.service.update(f.greg, changed), 409, "command-input-changed");
        assertEquals(outbox, f.count("SELECT count(*) FROM outbox_events"));
    }

    @Test
    void historyIsImmutable() throws SQLException {
        open(f);
        assertThrows(SQLException.class, () -> f.update("UPDATE renewal_case_history SET reason = 'edited'"));
        assertThrows(SQLException.class, () -> f.update("DELETE FROM renewal_case_history"));
    }

    @Test
    void theDatabaseRefusesASecondActiveCaseForTheSameRenewal() throws SQLException {
        JsonNode c = open(f);
        String insert = "INSERT INTO renewal_cases (environment_id, run_id, case_id, employee_id, renewal_id, status, owner_role, "
                + "owner_name, reason, trigger, next_action, due_at, opened_at, last_updated_at, renewal_deadline_state, "
                + "policy_version) SELECT environment_id, run_id, 'dup', employee_id, renewal_id, ?, owner_role, owner_name, reason, "
                + "trigger, next_action, due_at, opened_at, last_updated_at, 'needs-confirmation', policy_version "
                + "FROM renewal_cases WHERE case_id = ?";
        assertThrows(SQLException.class, () -> f.update(insert, "open", c.get("caseId").asText()));
        f.update(insert, "closed", c.get("caseId").asText());
    }
}
