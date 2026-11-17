package gcsp.api.cases;

import static gcsp.api.cases.CaseHarness.ok;
import static gcsp.api.cases.CaseHarness.open;
import static gcsp.api.cases.CaseHarness.refused;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountSelection;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The renewal-risk clock tick: deadline and lifecycle triggers, ownership, replay and unavailable inputs. */
class CaseRiskTickTest {

    static final String PAULA_RENEWAL = "renewal:emp-paula";
    static final String DIGEST = "0".repeat(64);
    static final RunContext SCOPE = new RunContext(CaseFixture.ENV, CaseFixture.RUN, "clock");

    CaseFixture f;
    int events;

    @BeforeEach
    void setUp() throws SQLException {
        f = CaseFixture.create();
        for (String e : List.of("emp-paula", "emp-alex")) {
            f.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?)", CaseFixture.ENV, CaseFixture.RUN, e);
        }
        slot("slot-paula", "emp-paula", PAULA_RENEWAL);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private void slot(String slotId, String employeeId, String renewalId) throws SQLException {
        f.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                + "VALUES (?, ?, ?, ?, 1, ?::jsonb)", CaseFixture.ENV, CaseFixture.RUN, slotId, employeeId,
                "{\"renewalId\":\"" + renewalId + "\"}");
    }

    private void event(String type, ObjectNode payload) throws SQLException {
        String id = "evt-" + (++events);
        f.update("INSERT INTO command_receipts (environment_id, run_id, actor_id, command_id, command_type, input_digest, result, "
                + "run_revision) VALUES (?, ?, 'test', ?, 'test', ?, '{}'::jsonb, 1)", CaseFixture.ENV, CaseFixture.RUN, id, DIGEST);
        f.update("INSERT INTO outbox_events (environment_id, run_id, event_id, actor_id, command_id, event_type, payload, "
                + "run_revision) VALUES (?, ?, ?, 'test', ?, ?, ?::jsonb, 1)", CaseFixture.ENV, CaseFixture.RUN, id, id, type,
                payload.toString());
    }

    private static ObjectNode payload(String employeeId, String renewalId, String slotId, Instant at) {
        ObjectNode p = CaseJson.obj().put("employeeId", employeeId).put("orderUuid", "order-1").put("occurredAt", CaseJson.iso(at));
        if (renewalId != null) p.put("renewalId", renewalId);
        if (slotId != null) p.put("entitlementSlotId", slotId);
        return p;
    }

    private JsonNode tick(Instant now) {
        return ok(f.service.tick(SCOPE, now, CaseFixture.POLICY));
    }

    private long cases() throws SQLException {
        return f.count("SELECT count(*) FROM renewal_cases");
    }

    @Test
    void aCloseDeadlineWithNoAcknowledgementOpensOneSystemCaseOnce() throws SQLException {
        f.account.set("emp-paula", "Paula", PAULA_RENEWAL, "2026-11-15");
        assertEquals(1, tick(CaseFixture.NOW).get("opened").asInt());
        assertFalse(tick(CaseFixture.NOW).has("unsupported"));
        JsonNode c = ok(f.service.readOwn(f.paula, java.util.Optional.empty())).get("cases").get(0);
        assertEquals("scheme-team", c.get("owner").get("role").asText());
        assertEquals("Scheme team", c.get("owner").get("name").asText());
        assertEquals("open", c.get("status").asText());
        assertEquals("renewal-deadline", c.get("trigger").get("type").asText());
        assertEquals("deadline:" + PAULA_RENEWAL, c.get("trigger").get("sourceId").asText());
        assertEquals("2026-11-06T09:00:00.000Z", c.get("dueAt").asText());
        assertEquals("system", c.get("history").get(0).get("actorRole").asText());
        assertEquals("renewal-risk-clock", c.get("history").get(0).get("actorId").asText());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'renewal-case-update'"));
        List<Long> before = f.snapshot();
        assertEquals(0, tick(CaseFixture.NOW).get("opened").asInt());
        assertEquals(0, tick(CaseFixture.NOW.plus(Duration.ofHours(2))).get("opened").asInt());
        assertEquals(before, f.snapshot());
    }

    @Test
    void aDistantDeadlineOpensNothingAndAnAcknowledgementOfTheCurrentRenewalSuppressesTheTrigger() throws SQLException {
        assertEquals(0, tick(CaseFixture.NOW).get("opened").asInt());
        f.account.set("emp-paula", "Paula", PAULA_RENEWAL, "2026-11-15");
        event("ordering.selection-acknowledged", payload("emp-paula", PAULA_RENEWAL, null, CaseFixture.NOW.minusSeconds(60)));
        assertEquals(0, tick(CaseFixture.NOW).get("opened").asInt());
        assertEquals(0, cases());
    }

    @Test
    void anAcknowledgementOfAnotherRenewalDoesNotSuppressAndTheUnprefixedTypeDoes() throws SQLException {
        f.account.set("emp-paula", "Paula", PAULA_RENEWAL, "2026-11-15");
        event("ordering.selection-acknowledged", payload("emp-paula", "renewal:other", null, CaseFixture.NOW.minusSeconds(60)));
        f.account.set("emp-alex", "Alex", "renewal:emp-alex", "2026-11-15");
        event("selection-acknowledged", payload("emp-alex", "renewal:emp-alex", null, CaseFixture.NOW.minusSeconds(60)));
        JsonNode r = tick(CaseFixture.NOW);
        assertEquals(1, r.get("opened").asInt());
        assertEquals(1, f.count("SELECT count(*) FROM renewal_cases WHERE employee_id = 'emp-paula'"));
        assertEquals(0, f.count("SELECT count(*) FROM renewal_cases WHERE employee_id = 'emp-alex'"));
    }

    @Test
    void aNoShowForTheCurrentRenewalOpensACaseWithItsConfiguredCopy() throws SQLException {
        event("appointment-no-show", payload("emp-paula", PAULA_RENEWAL, "slot-paula", CaseFixture.NOW.minusSeconds(60)));
        assertEquals(1, tick(CaseFixture.NOW).get("opened").asInt());
        JsonNode c = ok(f.service.readOwn(f.paula, java.util.Optional.empty())).get("cases").get(0);
        assertEquals("lifecycle-exception", c.get("trigger").get("type").asText());
        assertEquals("appointment-no-show", c.get("trigger").get("eventType").asText());
        assertEquals("Missed handover appointment", c.get("trigger").get("label").asText());
        assertEquals("The handover appointment was missed. The scheme team will check it is rebooked.", c.get("reason").asText());
        assertEquals("outbox:evt-1", c.get("trigger").get("sourceId").asText());
    }

    @Test
    void aReturnMissedWithoutRenewalResolvesThroughTheSlotAndAppendsToAnActiveCase() throws SQLException {
        JsonNode requested = open(f);
        event("return-missed", payload("emp-paula", null, "slot-paula", CaseFixture.NOW.minusSeconds(60)));
        assertEquals(1, tick(CaseFixture.NOW).get("opened").asInt());
        assertEquals(1, cases());
        JsonNode c = ok(f.service.readOwn(f.paula, java.util.Optional.of(requested.get("caseId").asText()))).get("case");
        assertEquals(2, c.get("history").size());
        assertEquals(2, c.get("version").asInt());
        assertEquals("system", c.get("history").get(1).get("actorRole").asText());
        assertEquals("Missed return of current car", c.get("history").get(1).get("trigger").get("label").asText());
        assertEquals("employee-request", c.get("trigger").get("type").asText());
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'renewal-case-update'"));
    }

    @Test
    void aLifecycleEventForAnotherRenewalIsUnsupportedAndAFutureEventIsIgnored() throws SQLException {
        slot("slot-old", "emp-paula", "renewal:old-paula");
        event("approval-declined", payload("emp-paula", "renewal:old-paula", "slot-old", CaseFixture.NOW.minusSeconds(60)));
        JsonNode r = tick(CaseFixture.NOW);
        assertEquals(0, r.get("opened").asInt());
        assertEquals(1, r.get("unsupported").asInt());
        assertEquals(0, cases());
        event("appointment-no-show", payload("emp-paula", PAULA_RENEWAL, "slot-paula", CaseFixture.NOW.plusSeconds(3600)));
        assertEquals(0, tick(CaseFixture.NOW).get("opened").asInt());
        assertEquals(1, tick(CaseFixture.NOW.plusSeconds(7200)).get("opened").asInt());
    }

    @Test
    void anUnavailablePolicyOrAccountLookupWritesNothing() throws SQLException {
        f.account.set("emp-paula", "Paula", PAULA_RENEWAL, "2026-11-15");
        List<Long> before = f.snapshot();
        f.policy.missing = true;
        refused(f.service.tick(SCOPE, CaseFixture.NOW, CaseFixture.POLICY), 503, "case-unavailable");
        f.policy.missing = false;
        f.account.unavailable = true;
        refused(f.service.tick(SCOPE, CaseFixture.NOW, CaseFixture.POLICY), 503, "case-unavailable");
        assertEquals(before, f.snapshot());
        assertEquals(new HandlerOutcome.Failed("unavailable", "renewal-cases-unavailable", true),
                RenewalRiskCasesTickHandler.map(f.service.tick(SCOPE, CaseFixture.NOW, CaseFixture.POLICY)));
    }

    @Test
    void caseTimeFollowsTheRunClockAndAnUnreadableClockIsUnavailable() throws SQLException {
        f.clock = Instant.parse("2026-11-10T08:00:00.123456Z");
        JsonNode c = open(f);
        assertEquals("2026-11-10T08:00:00.123Z", c.get("openedAt").asText());
        assertEquals("2026-11-11T08:00:00.123Z", c.get("dueAt").asText());
        f.clock = null;
        refused(f.service.readOwn(f.paula, java.util.Optional.empty()), 503, "case-unavailable");
        refused(f.service.requestHelp(f.paula, CaseHarness.request("again", "Still stuck.")), 503, "case-unavailable");
    }

    @Test
    void theHandlerIsEnabledOnlyWithPersistenceAndAnAccountProvider() {
        assertFalse(handler(true, false).enabled());
        assertFalse(handler(false, true).enabled());
        assertTrue(handler(true, true).enabled());
    }

    private static RenewalRiskCasesTickHandler handler(boolean active, boolean configured) {
        RenewalRiskCasesTickHandler h = new RenewalRiskCasesTickHandler();
        h.persistence = new Persistence() {
            @Override
            public boolean active() {
                return active;
            }
        };
        h.accountSelection = new AccountSelection() {
            @Override
            public boolean configured() {
                return configured;
            }
        };
        return h;
    }
}
