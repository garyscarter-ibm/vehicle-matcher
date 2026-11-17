package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.planning.DemandCohort.Excluded;
import gcsp.api.planning.DemandCohort.Failure;
import gcsp.api.planning.DemandCohort.Member;
import gcsp.api.planning.DemandCohort.Step;
import java.util.List;
import org.junit.jupiter.api.Test;

/** DemandCohort against the per-brief loop of server/gcsp/predict/plan/forecast.js, case by case. */
class DemandCohortTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String HORIZON = "2028-01-01T00:00:00.000Z";
    private static final String CONTRACT =
            ",'contract':{'manualContext':{'contracts':[{'status':'current','contractEndDate':'2027-03-31'}]}}";
    private static final String BRIEF = "{'employeeId':'e1','briefVersion':1,'status':'confirmed'}";
    private static final String EMPLOYEE = emp("e1", "s1", ",'renewalId':'r1'");
    private static final String SLOT = slot("s1", "e1", "r1");
    private static final String HOLD = "{'holdId':'h1','orderUuid':'o1','employeeId':'e1','entitlementSlotId':'s1',"
            + "'renewalId':'r1','state':'allocated'}";

    private static JsonNode json(String text) {
        try {
            return M.readTree(text.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static String emp(String id, String slotId, String renewal) {
        return "{'employeeId':'" + id + "','entitlementSlotId':'" + slotId + "'" + renewal + CONTRACT + "}";
    }

    private static String slot(String slotId, String employeeId, String renewalId) {
        return "{'entitlementSlotId':'" + slotId + "','employeeId':'" + employeeId + "','renewalId':'" + renewalId + "'}";
    }

    private static JsonNode rows(String briefs, String employees, String slots, String holds, String stock) {
        return json("{'briefs':[" + briefs + "],'employees':[" + employees + "],'entitlement_slots':[" + slots
                + "],'holds':[" + holds + "],'stock':[" + stock + "],'decisions':[],'offers':[]}");
    }

    private static JsonNode base() {
        return rows(BRIEF, EMPLOYEE, SLOT, "", "");
    }

    private static Member member(Step step) {
        assertTrue(step instanceof Member, String.valueOf(step));
        return (Member) step;
    }

    @Test
    void theLatestConfirmedBriefWins() {
        JsonNode r = rows("{'employeeId':'e1','briefVersion':1,'status':'confirmed'},"
                + "{'employeeId':'e1','briefVersion':3,'status':'confirmed'},"
                + "{'employeeId':'e1','briefVersion':2,'status':'confirmed'},"
                + "{'employeeId':'e1','briefVersion':9,'status':'draft'}", EMPLOYEE, SLOT, "", "");
        List<Step> steps = DemandCohort.steps(r, HORIZON);
        assertEquals(1, steps.size());
        assertEquals(3, member(steps.get(0)).brief().get("briefVersion").intValue());
    }

    @Test
    void aDraftOrOtherStatusIsIgnored() {
        JsonNode r = rows("{'employeeId':'e1','briefVersion':1,'status':'draft'},"
                + "{'employeeId':'e1','briefVersion':2,'status':'superseded'},{'employeeId':'e1','briefVersion':3}",
                EMPLOYEE, SLOT, "", "");
        assertEquals(List.of(), DemandCohort.steps(r, HORIZON));
    }

    @Test
    void equalVersionsKeepTheFirstBriefEvenWhenWrittenAsADouble() {
        JsonNode r = rows("{'employeeId':'e1','briefVersion':2,'status':'confirmed','tag':'first'},"
                + "{'employeeId':'e1','briefVersion':2.0,'status':'confirmed','tag':'second'}", EMPLOYEE, SLOT, "", "");
        assertEquals("first", member(DemandCohort.steps(r, HORIZON).get(0)).brief().get("tag").textValue());
    }

    @Test
    void stepsAreSortedByEmployeeIdAsStrings() {
        JsonNode r = rows("{'employeeId':'e2','briefVersion':1,'status':'confirmed'},"
                + "{'employeeId':'e10','briefVersion':1,'status':'confirmed'},"
                + "{'employeeId':'e1','briefVersion':1,'status':'confirmed'}",
                emp("e1", "s1", ",'renewalId':'r1'") + "," + emp("e2", "s2", ",'renewalId':'r2'") + ","
                        + emp("e10", "s10", ",'renewalId':'r10'"),
                slot("s1", "e1", "r1") + "," + slot("s2", "e2", "r2") + "," + slot("s10", "e10", "r10"), "", "");
        List<Step> steps = DemandCohort.steps(r, HORIZON);
        assertEquals(List.of("e1", "e10", "e2"),
                steps.stream().map(s -> member(s).employee().get("employeeId").textValue()).toList());
    }

    @Test
    void renewalIdComesFromTheLinkedSlotWhenTheRowHasNoneOrNull() {
        for (String renewal : new String[] {"", ",'renewalId':null"}) {
            JsonNode r = rows(BRIEF, emp("e1", "s1", renewal), SLOT, "", "");
            Member m = member(DemandCohort.steps(r, HORIZON).get(0));
            assertEquals("r1", m.employee().get("renewalId").textValue());
            assertEquals("2027-03-31T23:59:59.999Z", m.renewalAt());
        }
    }

    @Test
    void aRowRenewalIdWinsAndIsNotCopiedFromTheSlot() {
        JsonNode r = rows(BRIEF, emp("e1", "s1", ",'renewalId':'rX'"), SLOT, "", "");
        assertEquals(List.of(new Failure("planning-forecast-entitlement-mismatch")), DemandCohort.steps(r, HORIZON));
    }

    @Test
    void theSlotRenewalIsNotCopiedWhenTheSlotBelongsToAnotherEmployee() {
        JsonNode r = rows(BRIEF, emp("e1", "s1", ""), slot("s1", "e2", "r1"), "", "");
        assertEquals(List.of(new Failure("planning-forecast-entitlement-missing")), DemandCohort.steps(r, HORIZON));
    }

    @Test
    void missingWhenThereIsNoRowOrTheRowFieldsAreNotText() {
        String missing = "planning-forecast-entitlement-missing";
        assertEquals(List.of(new Failure(missing)), DemandCohort.steps(rows(BRIEF, "", SLOT, "", ""), HORIZON));
        assertEquals(List.of(new Failure(missing)),
                DemandCohort.steps(rows(BRIEF, emp("e1", "s1", ",'renewalId':''"), SLOT, "", ""), HORIZON));
        assertEquals(List.of(new Failure(missing)),
                DemandCohort.steps(rows(BRIEF, emp("e1", "s1", ",'renewalId':7"), SLOT, "", ""), HORIZON));
        assertEquals(List.of(new Failure(missing)), DemandCohort.steps(rows(BRIEF,
                "{'employeeId':'e1','renewalId':'r1'" + CONTRACT + "}", SLOT, "", ""), HORIZON));
        assertEquals(List.of(new Failure(missing)), DemandCohort.steps(rows(BRIEF,
                "{'employeeId':'e1','entitlementSlotId':5,'renewalId':'r1'" + CONTRACT + "}", SLOT, "", ""), HORIZON));
    }

    @Test
    void mismatchWhenTheSlotIsMissingOrDisagrees() {
        Failure mismatch = new Failure("planning-forecast-entitlement-mismatch");
        assertEquals(List.of(mismatch), DemandCohort.steps(rows(BRIEF, EMPLOYEE, "", "", ""), HORIZON));
        assertEquals(List.of(mismatch), DemandCohort.steps(rows(BRIEF, EMPLOYEE, slot("s1", "e2", "r1"), "", ""), HORIZON));
        assertEquals(List.of(mismatch), DemandCohort.steps(rows(BRIEF, EMPLOYEE, slot("s1", "e1", "r2"), "", ""), HORIZON));
    }

    @Test
    void aBriefRenewalIdOfNullOrAbsentIsFineAndADifferentOneIsAMismatch() {
        String head = "{'employeeId':'e1','briefVersion':1,'status':'confirmed'";
        assertTrue(DemandCohort.steps(rows(head + ",'renewalId':null}", EMPLOYEE, SLOT, "", ""), HORIZON).get(0) instanceof Member);
        assertTrue(DemandCohort.steps(rows(head + "}", EMPLOYEE, SLOT, "", ""), HORIZON).get(0) instanceof Member);
        assertTrue(DemandCohort.steps(rows(head + ",'renewalId':'r1'}", EMPLOYEE, SLOT, "", ""), HORIZON).get(0) instanceof Member);
        assertEquals(List.of(new Failure("planning-forecast-entitlement-mismatch")),
                DemandCohort.steps(rows(head + ",'renewalId':'r9'}", EMPLOYEE, SLOT, "", ""), HORIZON));
    }

    @Test
    void aBriefSlotIdIsOptionalButMustMatchWhenPresent() {
        String head = "{'employeeId':'e1','briefVersion':1,'status':'confirmed'";
        assertTrue(DemandCohort.steps(rows(head + "}", EMPLOYEE, SLOT, "", ""), HORIZON).get(0) instanceof Member);
        assertTrue(DemandCohort.steps(rows(head + ",'entitlementSlotId':'s1'}", EMPLOYEE, SLOT, "", ""), HORIZON)
                .get(0) instanceof Member);
        assertEquals(List.of(new Failure("planning-forecast-entitlement-mismatch")),
                DemandCohort.steps(rows(head + ",'entitlementSlotId':'s2'}", EMPLOYEE, SLOT, "", ""), HORIZON));
    }

    @Test
    void noContractDateIsRenewalUnconfirmed() {
        String bare = "{'employeeId':'e1','entitlementSlotId':'s1','renewalId':'r1'}";
        assertEquals(List.of(new Failure("planning-renewal-unconfirmed")),
                DemandCohort.steps(rows(BRIEF, bare, SLOT, "", ""), HORIZON));
    }

    @Test
    void theHorizonEndItselfIsIncludedAndOneMillisecondEarlierExcludes() {
        List<Step> equal = DemandCohort.steps(base(), "2027-03-31T23:59:59.999Z");
        assertEquals("2027-03-31T23:59:59.999Z", member(equal.get(0)).renewalAt());
        assertEquals(List.of(new Excluded("e1", "outside-horizon")),
                DemandCohort.steps(base(), "2027-03-31T23:59:59.998Z"));
    }

    @Test
    void anAllocatedHoldOnAllocatedStockIsAlreadySelected() {
        Excluded selected = new Excluded("e1", "already-selected");
        assertEquals(List.of(selected), DemandCohort.steps(
                rows(BRIEF, EMPLOYEE, SLOT, HOLD, "{'orderUuid':'o1','state':'allocated'}"), HORIZON));
        assertEquals(List.of(selected), DemandCohort.steps(
                rows(BRIEF, EMPLOYEE, SLOT, HOLD, "{'orderUuid':'o1','state':'x','allocated':true}"), HORIZON));
    }

    @Test
    void anActiveHoldOrReleasedStockOrAnyOtherMismatchLeavesTheMember() {
        String stock = "{'orderUuid':'o1','state':'allocated'}";
        List<JsonNode> notSelected = List.of(
                rows(BRIEF, EMPLOYEE, SLOT, HOLD.replace("allocated", "active"), stock),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD, "{'orderUuid':'o1','state':'released'}"),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD, "{'orderUuid':'o1','state':'released','allocated':'true'}"),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD, "{'orderUuid':'o2','state':'allocated'}"),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD.replace("'e1'", "'e2'"), stock),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD.replace("'s1'", "'s2'"), stock),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD.replace("'r1'", "'r2'"), stock),
                rows(BRIEF, EMPLOYEE, SLOT, HOLD.replace(",'renewalId':'r1'", ""), stock));
        for (JsonNode r : notSelected) {
            assertTrue(DemandCohort.steps(r, HORIZON).get(0) instanceof Member, r.toString());
        }
    }

    @Test
    void theListStopsRightAfterTheFirstFailure() {
        JsonNode r = rows("{'employeeId':'e1','briefVersion':1,'status':'confirmed'},"
                + "{'employeeId':'e2','briefVersion':1,'status':'confirmed'},"
                + "{'employeeId':'e3','briefVersion':1,'status':'confirmed'}",
                emp("e1", "s1", ",'renewalId':'r1'") + "," + emp("e2", "s2", ",'renewalId':'r2'") + ","
                        + emp("e3", "s3", ",'renewalId':'r3'"),
                slot("s1", "e1", "r1") + "," + slot("s2", "e2", "rBad") + "," + slot("s3", "e3", "r3"), "", "");
        List<Step> steps = DemandCohort.steps(r, HORIZON);
        assertEquals(2, steps.size());
        assertTrue(steps.get(0) instanceof Member);
        assertEquals(new Failure("planning-forecast-entitlement-mismatch"), steps.get(1));
    }

    @Test
    void theInputIsNeverMutated() {
        JsonNode r = rows(BRIEF, emp("e1", "s1", ""), SLOT, HOLD, "{'orderUuid':'o1','state':'released'}");
        JsonNode before = r.deepCopy();
        Member m = member(DemandCohort.steps(r, HORIZON).get(0));
        assertEquals(before, r);
        assertNotSame(r.get("employees").get(0), m.employee());
        m.employee().put("renewalId", "changed");
        assertEquals(before, r);
        assertTrue(r.get("employees").get(0).get("renewalId") == null);
    }

    @Test
    void malformedInputThrowsWhereNodeThrowsATypeError() {
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(null, HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(json("[]"), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(json("{'briefs':{}}"), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(rows("null", EMPLOYEE, SLOT, "", ""), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(rows(BRIEF, "null", SLOT, "", ""), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(rows(BRIEF, EMPLOYEE, "null", "", ""), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(
                json("{'briefs':[" + BRIEF + "],'employees':{},'entitlement_slots':[]}"), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(
                rows(BRIEF, "{'employeeId':'e1','entitlementSlotId':'s1','renewalId':'r1','contract':{'manualContext':"
                        + "{'contracts':5}}}", SLOT, "", ""), HORIZON));
    }

    @Test
    void holdsAndStockAreOnlyReadWhenTheSelectedCheckIsReached() {
        assertEquals(List.of(new Failure("planning-forecast-entitlement-missing")),
                DemandCohort.steps(json("{'briefs':[" + BRIEF + "],'employees':[],'entitlement_slots':[]}"), HORIZON));
        assertThrows(IllegalArgumentException.class, () -> DemandCohort.steps(
                json("{'briefs':[" + BRIEF + "],'employees':[" + EMPLOYEE + "],'entitlement_slots':[" + SLOT + "]}"), HORIZON));
    }
}
