package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountPolicyPort.PolicyOutcome;
import org.junit.jupiter.api.Test;

class AccountServiceTest {

    private static final com.fasterxml.jackson.databind.node.JsonNodeFactory F = GoldenFixture.JSON.getNodeFactory();

    private static void refused(AccountOutcome o, String source) {
        assertEquals("unavailable", o.status());
        assertNull(o.value());
        assertEquals(source, o.refusal().get("source").asText(), o.refusal().toString());
        assertEquals("manual-source-unavailable", o.refusal().get("code").asText());
        assertTrue(o.refusal().get("retryable").asBoolean());
        assertFalse(o.refusal().has("contractVersion"));
    }

    @Test
    void unknownGradeFromAllowanceBecomesTheState() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.allowance = new PolicyOutcome("invalid", "unknown-grade", null, null);
        AccountOutcome o = fx.read();
        assertTrue(o.isOk());
        assertEquals("unknown-grade", o.value().get("state").asText());
        assertTrue(o.value().get("choices").isNull());
        assertTrue(o.value().get("contextVersion").isNull());
        assertTrue(o.value().get("assumptions").isEmpty());
    }

    @Test
    void policyUnavailableIsSchemeCollection() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.allowance = new PolicyOutcome("unavailable", "policy-source-unavailable", null, null);
        refused(fx.read(), "scheme-collection");
        fx = new GoldenFixture("paula");
        fx.manualRules = new PolicyOutcome("unavailable", null, null, null);
        refused(fx.read(), "scheme-collection");
    }

    @Test
    void policyVersionMismatchIsSchemeCollection() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.allowance = new PolicyOutcome("ok", null, "other-version", fx.allowance.value());
        refused(fx.read(), "scheme-collection");
    }

    @Test
    void invalidRulesAreRefused() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.rulesPayload().put("minimumLeadDays", 1.5);
        refused(fx.read(), "manual-policy-invalid");
    }

    @Test
    void wholeNumberDecimalsCountAsIntegers() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.rulesPayload().put("maximumLeadDays", 180.0);
        assertEquals("ready", fx.read().value().get("state").asText());
    }

    @Test
    void clockFailureIsUnavailableClock() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.clock = s -> {
            throw new ClockUnavailableException("down");
        };
        refused(fx.read(), "clock");
        fx.clock = s -> new AccountClockPort.ClockReading("2026-11-05 09:00", "1");
        refused(fx.read(), "clock");
    }

    @Test
    void currentCarFailureIsUnavailableCurrentCar() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.cars = SourceResult.unavailable("down");
        refused(fx.read(), "current-car");
    }

    @Test
    void currentCarRelationshipsAppearOnlyWhenPresent() {
        GoldenFixture fx = new GoldenFixture("paula");
        assertFalse(fx.read().value().has("currentCarRelationships"));
        ObjectNode rel = F.objectNode().put("relationshipId", "rel-1");
        fx.cars = SourceResult.ok(GoldenFixture.array(rel));
        assertEquals(GoldenFixture.array(rel), fx.read().value().get("currentCarRelationships"));
    }

    @Test
    void sourceNotYetEffectiveIsRefused() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.manual().with("source").put("effectiveFrom", "2026-11-05T09:00:00.001Z");
        refused(fx.read(), "employee-not-effective");
    }

    @Test
    void driverRecordSetMismatchIsRefused() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.driverReader = in -> {
            ObjectNode v = fx.driverFacts(in).value().deepCopy();
            v.put("recordSetId", "other");
            return SourceResult.ok(v);
        };
        refused(fx.read(), "driver");
    }

    @Test
    void driverRepositoryVersionMismatchIsRefused() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.driverReader = in -> {
            ObjectNode v = fx.driverFacts(in).value().deepCopy();
            v.put("repositoryVersion", 99);
            return SourceResult.ok(v);
        };
        refused(fx.read(), "driver");
    }

    @Test
    void portExceptionIsInvalidSource() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.contractReader = in -> {
            throw new IllegalStateException("boom");
        };
        refused(fx.read(), "invalid-source");
        fx = new GoldenFixture("paula");
        fx.manual().with("account").put("employeeId", fx.scope.employeeId());
        ((com.fasterxml.jackson.databind.node.ArrayNode) fx.manual().get("contracts")).add(F.nullNode());
        refused(fx.read(), "invalid-source");
    }

    @Test
    void missingEmploymentIsAbsentHrAccount() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.employment = SourceResult.notFound();
        AccountOutcome o = fx.read();
        assertEquals("absent-hr-account", o.value().get("state").asText());
        assertTrue(o.value().get("account").isNull());
    }

    @Test
    void employmentOutageIsUnavailable() {
        GoldenFixture fx = new GoldenFixture("paula");
        fx.employment = SourceResult.unavailable("down");
        refused(fx.read(), "employee-contract");
    }

    @Test
    void malformedDisplayNamesLeaveNoLabel() {
        GoldenFixture fx = new GoldenFixture("paula");
        JsonNode with = fx.read().value();
        assertTrue(with.get("histories").findValue("label") != null);
        fx.schemeNames = new PolicyOutcome("ok", null, null, F.objectNode().set("value", F.objectNode().put("names", "x")));
        assertTrue(fx.read().value().get("histories").findValue("label") == null);
        fx.schemeNames = new PolicyOutcome("unavailable", null, null, null);
        assertTrue(fx.read().value().get("histories").findValue("label") == null);
    }

    @Test
    void dateRules() {
        assertTrue(Js.validInstant(F.textNode("2026-11-05T09:00:00Z")));
        assertTrue(Js.validInstant(F.textNode("2026-11-05T09:00:00.5+01:00")));
        assertFalse(Js.validInstant(F.textNode("2026-02-30T09:00:00Z")));
        assertFalse(Js.validInstant(F.textNode("2026-11-05T24:00:00Z")));
        assertFalse(Js.validInstant(F.textNode("2026-11-05T09:00:00+24:00")));
        assertFalse(Js.validInstant(F.textNode("2026-11-05")));
        assertTrue(Js.calendarDate(F.textNode("2028-02-29")));
        assertFalse(Js.calendarDate(F.textNode("2027-02-29")));
        assertFalse(Js.calendarDate(F.textNode("2027-1-01")));
        assertTrue(Js.safeInt(F.numberNode(1.0)));
        assertFalse(Js.safeInt(F.numberNode(1.5)));
        assertFalse(Js.safeInt(F.numberNode(9007199254740992L)));
    }
}
