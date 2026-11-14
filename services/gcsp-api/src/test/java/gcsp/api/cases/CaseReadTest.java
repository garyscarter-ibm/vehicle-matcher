package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.open;
import static gcsp.api.cases.CaseHarness.refused;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Reads write nothing; the employee sees only their own cases; Greg sees names and the options as they stand. */
class CaseReadTest {

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
    void helpAndOwnReadsWriteNothing() throws SQLException {
        open(f);
        List<Long> before = f.snapshot();
        JsonNode help = ok(f.service.readHelp(f.paula));
        assertFalse(help.get("opensCase").booleanValue());
        assertEquals("scheme-team", help.get("ownerRole").asText());
        assertFalse(help.get("extensionPermitted").booleanValue());
        assertEquals("Ask for help to open an owned renewal case.", help.get("nextAction").asText());
        assertFalse(help.get("automaticRecoveryPriority").booleanValue());
        assertEquals(9, help.get("assumptions").size());
        assertEquals(1, ok(f.service.readOwn(f.paula, Optional.empty())).get("cases").size());
        ok(f.service.readOwn(f.paula, Optional.of(first(f.paula, f).get("caseId").asText())));
        assertEquals(before, f.snapshot());
    }

    private static JsonNode first(EmployeeScope s, CaseFixture f) {
        return ok(f.service.readOwn(s, Optional.empty())).get("cases").get(0);
    }

    @Test
    void employeeSeesOnlyOwnCasesAndOtherCaseIsForbidden() {
        JsonNode paulas = open(f);
        ok(f.service.requestHelp(f.alex, CaseHarness.request("a-1", "Late renewal")));
        JsonNode mine = ok(f.service.readOwn(f.paula, Optional.empty()));
        assertEquals(1, mine.get("cases").size());
        assertEquals("emp-paula", mine.get("cases").get(0).get("employeeId").asText());
        assertEquals("2026-11-05T09:00:00.000Z", mine.get("asOf").asText());
        assertEquals(paulas.get("caseId"), ok(f.service.readOwn(f.paula, Optional.of(paulas.get("caseId").asText()))).get("case").get("caseId"));
        CaseResult.Refusal r = refused(f.service.readOwn(f.alex, Optional.of(paulas.get("caseId").asText())), 403, "not-resource-owner");
        assertEquals("This renewal case belongs to another employee.", r.reason());
        refused(f.service.readOwn(f.paula, Optional.of("renewal-nothing")), 404, "not-found");
    }

    @Test
    void readsAreUnavailableWithoutPolicy() {
        f.policy.missing = true;
        refused(f.service.readHelp(f.paula), 503, "case-unavailable");
        refused(f.service.readOwn(f.paula, Optional.empty()), 503, "case-unavailable");
        refused(f.service.list(f.greg), 503, "case-unavailable");
    }

    @Test
    void gregListIncludesNamesHistoryAndFallsBackToId() throws SQLException {
        open(f);
        ok(f.service.requestHelp(f.alex, CaseHarness.request("a-1", "Late renewal")));
        f.account.set("emp-alex", null, "renewal:emp-alex", null);
        List<Long> before = f.snapshot();
        JsonNode list = ok(f.service.list(f.greg));
        assertEquals(2, list.get("cases").size());
        JsonNode first = list.get("cases").get(0);
        assertEquals("Paula", first.get("employeeName").asText());
        assertEquals(1, first.get("history").size());
        assertEquals("emp-alex", list.get("cases").get(1).get("employeeName").asText());
        assertEquals("gcsp-policy-v1", list.get("policyVersion").asText());
        assertEquals(before, f.snapshot());
    }

    @Test
    void optionsWriteNothingAndShowTheUnavailableRemedies() throws SQLException {
        JsonNode c = open(f);
        List<Long> before = f.snapshot();
        JsonNode r = ok(f.service.readOptions(f.greg, c.get("caseId").asText()));
        assertEquals(before, f.snapshot());
        assertEquals("Paula", r.get("case").get("employeeName").asText());
        assertEquals(List.of("in-progress", "closed"), strings(r.get("nextStatuses")));
        assertFalse(r.get("automaticRecoveryPriority").booleanValue());
        JsonNode o = r.get("options");
        assertFalse(o.get("contractExtension").get("available").booleanValue());
        assertEquals("The current policy does not permit a contract extension.", o.get("contractExtension").get("reason").asText());
        assertEquals("2026-12-01", o.get("contractExtension").get("contractEndDate").asText());
        assertTrue(o.get("contractExtension").get("requiresUntil").booleanValue());
        assertFalse(o.get("alternativeCars").get("available").booleanValue());
        assertEquals(0, o.get("alternativeCars").get("items").size());
        assertEquals(0, o.get("alternativeCars").get("needsConfirmation").size());
        assertEquals("Checking available cars for suitability is not connected yet, so none can be proposed.",
                o.get("alternativeCars").get("reason").asText());
        assertFalse(o.get("preferenceRelaxations").get("available").booleanValue());
        assertEquals("A current confirmed brief and an unused recorded decline are required.",
                o.get("preferenceRelaxations").get("reason").asText());
        assertEquals("No reviewed future release date and source are recorded for this case.",
                o.get("laterRelease").get("reason").asText());
        assertTrue(o.get("manualDecision").get("available").booleanValue());
        refused(f.service.readOptions(f.greg, "renewal-nothing"), 404, "not-found");
    }

    @Test
    void extensionIsAvailableWhenPolicyPermitsAndTheEndDateIsKnown() {
        f.policy.set("renewalCase.extension.permitted", com.fasterxml.jackson.databind.node.BooleanNode.TRUE);
        JsonNode c = open(f);
        JsonNode e = ok(f.service.readOptions(f.greg, c.get("caseId").asText())).get("options").get("contractExtension");
        assertTrue(e.get("available").booleanValue());
        assertFalse(e.has("reason"));
        f.account.set("emp-paula", "Paula", "renewal:emp-paula", null);
        JsonNode unknown = ok(f.service.readOptions(f.greg, c.get("caseId").asText())).get("options").get("contractExtension");
        assertFalse(unknown.get("available").booleanValue());
        assertEquals("The actual contract end date needs confirmation.", unknown.get("reason").asText());
        assertTrue(unknown.get("contractEndDate").isNull());
    }

    @Test
    void optionsRefuseWhenTheRenewalChangedOrContextIsUnavailable() {
        JsonNode c = open(f);
        f.account.set("emp-paula", "Paula", "renewal:other", "2026-12-01");
        CaseResult.Refusal r = refused(f.service.readOptions(f.greg, c.get("caseId").asText()), 409, "renewal-changed");
        assertEquals("The current renewal differs from this case. Review the employee contract.", r.reason());
        f.account.unavailable = true;
        refused(f.service.readOptions(f.greg, c.get("caseId").asText()), 503, "case-unavailable");
    }

    @Test
    void laterReleaseAppearsOnlyAfterItIsRecordedAndWhileFuture() throws SQLException {
        JsonNode c = open(f);
        c = CaseHarness.move(f, c, "in-progress");
        ObjectNode u = CaseHarness.update(f, c, "remedy-proposed");
        ObjectNode remedy = u.putObject("remedy");
        remedy.put("type", "later-release").put("releaseAt", "2026-11-20T10:00:00.000Z").put("source", "Reviewed supply plan");
        c = ok(f.service.update(f.greg, u)).get("case");
        JsonNode later = ok(f.service.readOptions(f.greg, c.get("caseId").asText())).get("options").get("laterRelease");
        assertTrue(later.get("available").booleanValue());
        assertEquals(1, later.get("items").size());
        assertEquals("Reviewed supply plan", later.get("items").get(0).get("source").asText());
        // Move the recorded release into the past: it no longer counts.
        f.update("UPDATE renewal_cases SET remedy = jsonb_set(remedy, '{releaseAt}', '\"2026-11-04T10:00:00.000Z\"')");
        f.update("ALTER TABLE renewal_case_history DISABLE TRIGGER renewal_case_history_immutable");
        f.update("UPDATE renewal_case_history SET remedy = jsonb_set(remedy, '{releaseAt}', '\"2026-11-04T10:00:00.000Z\"') "
                + "WHERE remedy IS NOT NULL");
        JsonNode past = ok(f.service.readOptions(f.greg, c.get("caseId").asText())).get("options").get("laterRelease");
        assertFalse(past.get("available").booleanValue());
    }

    private static List<String> strings(JsonNode array) {
        java.util.ArrayList<String> out = new java.util.ArrayList<>();
        array.forEach(n -> out.add(n.asText()));
        return out;
    }
}
