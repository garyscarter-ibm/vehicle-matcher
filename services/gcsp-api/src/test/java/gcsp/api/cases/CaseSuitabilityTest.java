package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.refused;
import static gcsp.api.cases.CaseHarness.update;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountScope;
import gcsp.api.account.SourceResult;
import gcsp.api.cases.CaseCarSuitabilityPort.Check;
import gcsp.api.cases.CaseCarSuitabilityPort.Options;
import gcsp.api.cases.CaseCarSuitabilityPort.Verdict;
import gcsp.api.clock.ClockReading;
import gcsp.api.policy.PolicyService;
import gcsp.api.policy.RetainedFilePolicySource;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The real recommendation calculation behind the alternative-car remedy, over native PG stock, holds and briefs. */
class CaseSuitabilityTest {

    private static final String EMP = "emp-paula";
    private static final String OK_CAR = "00000000-0000-4000-8000-000000000001";
    private static final String HELD_CAR = "00000000-0000-4000-8000-000000000004";
    private static final String HIDDEN_CAR = "00000000-0000-4000-8000-000000000005";
    private static final String BAD_CAR = "00000000-0000-4000-8000-000000000002";
    private static final PolicyService POLICY = new PolicyService(
            new RetainedFilePolicySource(Path.of("../../server/gcsp/policy/seed-v1.json"), List.of()));

    private CaseFixture f;
    private final Account records = new Account();
    private volatile boolean clockDown;
    private RecommendationCaseSuitability adapter;

    @BeforeEach
    void setUp() throws Exception {
        f = CaseFixture.create();
        adapter = new RecommendationCaseSuitability(f.pool(), records, POLICY, (env, run) -> clockDown ? Optional.empty()
                : Optional.of(new ClockReading(CaseFixture.NOW, 3)));
        JsonNode golden = resource("/account/node-baseline/paula.json");
        records.golden = CaseJson.M.readTree(golden.path("input").path("manualContext").toString()
                .replace("employee-paula", EMP));
        records.version = golden.path("input").path("employeeVersion").asLong();
        ObjectNode attributes = CaseJson.obj();
        for (String key : List.of("companyId", "schemeId", "gradeId", "entitlementSlotId")) {
            attributes.set(key, golden.path("context").get(key));
        }
        f.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes, version) VALUES (?, ?, ?, ?::jsonb, ?)",
                CaseFixture.ENV, CaseFixture.RUN, EMP, attributes.toString(), records.version);
        f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes, version) "
                + "VALUES (?, ?, 'slot-paula', ?, 1, '{}'::jsonb, 1)", CaseFixture.ENV, CaseFixture.RUN, EMP);
        JsonNode rows = resource("/recommendation-source/source-cases.json").path("cases").get(0).path("rows");
        car(rows.get(0), null);
        car(rows.get(1), null);
        car(rows.get(3), null);
        car(rows.get(4), v -> ((ObjectNode) v).putArray("schemeIds").add("another-scheme"));
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    @Test
    void onlyAnEligibleReleasedVisibleUnoccupiedCarIsOffered() throws Exception {
        brief();
        hold(HELD_CAR);
        Options o = adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY);
        assertTrue(o.connected());
        assertEquals(List.of(OK_CAR), o.items().stream().map(i -> i.get("orderUuid").asText()).toList());
        ObjectNode item = o.items().get(0);
        assertEquals("alternative-car", item.get("type").asText());
        assertTrue(item.has("configurationId") && item.get("snapshot").isObject());
        assertTrue(o.needsConfirmation().isEmpty());
    }

    @Test
    void checkAcceptsTheEligibleCarWithAServerDerivedNameAndRefusesTheRest() throws Exception {
        brief();
        hold(HELD_CAR);
        Check yes = adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR);
        assertEquals(Verdict.SUITABLE, yes.verdict());
        assertEquals(OK_CAR, yes.remedy().get("orderUuid").asText());
        String name = adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY).items().get(0)
                .path("snapshot").path("display").path("name").asText(null);
        assertFalse(name == null || name.isBlank(), "the fixture snapshot carries a display name");
        assertEquals(name.trim(), yes.remedy().path("carName").asText());
        for (String other : List.of(HELD_CAR, HIDDEN_CAR, BAD_CAR, "no-such-car")) {
            Check no = adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, other);
            assertEquals(Verdict.UNSUITABLE, no.verdict(), other);
        }
    }

    @Test
    void noConfirmedBriefIsConnectedAndEmptyWithAReasonAndCheckIsUnavailable() {
        Options o = adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY);
        assertTrue(o.connected());
        assertTrue(o.items().isEmpty() && o.needsConfirmation().isEmpty());
        assertEquals("A confirmed brief is required to evaluate suitable available cars.", o.reason());
        assertEquals(Verdict.UNAVAILABLE, adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR).verdict());
    }

    @Test
    void anUnavailableAccountOrClockMakesBothReadsUnavailable() throws Exception {
        brief();
        records.down = true;
        assertFalse(adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY).connected());
        assertEquals(Verdict.UNAVAILABLE, adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR).verdict());
        records.down = false;
        clockDown = true;
        assertFalse(adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY).connected());
        assertEquals(Verdict.UNAVAILABLE, adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR).verdict());
    }

    @Test
    void anUnconfirmedChargingAnswerListsTheCarForConfirmationAndNeverAsSuitable() throws Exception {
        brief(b -> b.with("essentials").putObject("charging").put("operator", "includes").putNull("unit")
                .put("source", "employee").put("state", "needs-confirmation").putNull("value"));
        f.update("UPDATE stock_cars SET attributes = jsonb_set(attributes, '{facts,facts,fuel,value}', '\"ev\"') "
                + "WHERE order_uuid = ?", OK_CAR);
        Options o = adapter.options(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY);
        assertFalse(o.items().stream().anyMatch(i -> i.get("orderUuid").asText().equals(OK_CAR)));
        ObjectNode row = o.needsConfirmation().stream().filter(i -> i.get("orderUuid").asText().equals(OK_CAR)).findFirst()
                .orElseThrow();
        assertEquals(List.of("charging-unconfirmed"), List.of(row.get("unknowns").get(0).asText()));
        assertEquals(Verdict.UNSUITABLE, adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR).verdict());
    }

    @Test
    void gregProposesTheEligibleCarWithItsNameAndTheHeldCarIsRefused() throws Exception {
        brief();
        hold(HELD_CAR);
        CaseService service = new CaseService(f.pool(), f.policy, f.account, new OutboxCaseNotifications(), adapter,
                (env, run) -> Optional.of(CaseFixture.NOW));
        JsonNode c = ok(service.requestHelp(f.paula, CaseHarness.request(f.nextId(), "My replacement may miss my contract end.")))
                .get("case");
        c = ok(service.update(f.greg, update(f, c, "in-progress"))).get("case");
        List<Long> before = f.snapshot();
        ObjectNode held = update(f, c, "remedy-proposed");
        held.set("remedy", CaseJson.obj().put("type", "alternative-car").put("orderUuid", HELD_CAR));
        CaseResult.Refusal r = refused(service.update(f.greg, held), 400, "invalid-case-command");
        assertTrue(r.toString().contains("remedy.orderUuid"), r.toString());
        assertEquals(before, f.snapshot());
        ObjectNode good = update(f, c, "remedy-proposed");
        good.set("remedy", CaseJson.obj().put("type", "alternative-car").put("orderUuid", OK_CAR).put("carName", "Client name"));
        refused(service.update(f.greg, good), 400, "invalid-case-command");
        good.set("remedy", CaseJson.obj().put("type", "alternative-car").put("orderUuid", OK_CAR));
        JsonNode stored = ok(service.update(f.greg, good)).get("case").get("remedy");
        assertEquals("alternative-car", stored.get("type").asText());
        assertEquals(OK_CAR, stored.get("orderUuid").asText());
        assertEquals(adapter.check(CaseFixture.ENV, CaseFixture.RUN, EMP, CaseFixture.POLICY, OK_CAR).remedy(), stored);
    }

    private void brief() throws SQLException {
        brief(b -> {});
    }

    private void brief(java.util.function.Consumer<ObjectNode> edit) throws SQLException {
        ObjectNode brief = CaseJson.obj().put("schemaVersion", 1);
        brief.putObject("preferences").putObject("body").put("value", "estate").put("importance", 100)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee")
                .put("confirmedAt", "2026-11-05T09:00:00.000Z");
        brief.putObject("essentials");
        edit.accept(brief);
        f.update("INSERT INTO brief_heads (environment_id, run_id, employee_id, brief_version) VALUES (?, ?, ?, 1)",
                CaseFixture.ENV, CaseFixture.RUN, EMP);
        f.update("INSERT INTO briefs (environment_id, run_id, employee_id, brief_version, previous_brief_version, operation, "
                + "content, buddy, semantic_digest, policy_version, confirmed_by, confirmed_at, command_id) VALUES "
                + "(?, ?, ?, 1, NULL, 'confirmed', ?::jsonb, '{}'::jsonb, ?, ?, 'suitability-test', ?::timestamptz, 'brief-1')",
                CaseFixture.ENV, CaseFixture.RUN, EMP, brief.toString(), "a".repeat(64), CaseFixture.POLICY,
                "2026-11-05T09:00:00.000Z");
    }

    private void car(JsonNode row, java.util.function.Consumer<JsonNode> visibility) throws SQLException {
        ObjectNode attributes = row.deepCopy();
        attributes.remove(List.of("orderUuid", "configurationId", "state", "available", "held", "allocated", "version"));
        if (visibility != null) visibility.accept(attributes.get("visibility"));
        f.update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes, version) "
                + "VALUES (?, ?, ?, ?, 'released', ?::jsonb, 1)", CaseFixture.ENV, CaseFixture.RUN,
                row.get("orderUuid").asText(), row.get("configurationId").asText(), attributes.toString());
    }

    private void hold(String orderUuid) throws SQLException {
        f.update("INSERT INTO custody_holds (environment_id, run_id, hold_id, order_uuid, employee_id, slot_id, slot_unit, "
                + "hold_type, state, expires_at) VALUES (?, ?, ?, ?, ?, 'slot-paula', 1, 'cart', 'active', now() + interval '1 day')",
                CaseFixture.ENV, CaseFixture.RUN, "hold-" + orderUuid, orderUuid, EMP);
    }

    private static JsonNode resource(String name) throws IOException {
        try (InputStream in = CaseSuitabilityTest.class.getResourceAsStream(name)) {
            if (in == null) throw new IOException("Missing retained fixture " + name);
            return CaseJson.M.readTree(in);
        }
    }

    /** Serves Paula's golden record, scoped to the asked employee, run and environment. */
    private static final class Account implements AccountRecordsPort {
        JsonNode golden;
        long version;
        volatile boolean down;

        @Override
        public SourceResult readEmployeeContract(AccountScope s) {
            if (down) return SourceResult.unavailable("repository-unavailable");
            ObjectNode v = base(s);
            v.setAll((ObjectNode) golden.deepCopy());
            v.remove(List.of("drivers", "employeeFacts"));
            return SourceResult.ok(v);
        }

        @Override
        public SourceResult readDrivers(AccountScope s) {
            if (down) return SourceResult.unavailable("repository-unavailable");
            ObjectNode v = base(s);
            for (String key : List.of("recordSetId", "source", "drivers", "employeeFacts")) v.set(key, golden.get(key).deepCopy());
            return SourceResult.ok(v);
        }

        @Override
        public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
            throw new AssertionError("suitability must not read employment");
        }

        private ObjectNode base(AccountScope s) {
            ObjectNode v = CaseJson.obj();
            v.put("runId", s.runId()).put("environmentId", s.environmentId()).put("employeeId", s.employeeId());
            v.put("repositoryVersion", version);
            return v;
        }
    }
}
