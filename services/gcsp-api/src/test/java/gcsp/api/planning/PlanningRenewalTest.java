package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** PlanningRenewal against server/gcsp/predict/plan/renewal.js, case by case. */
class PlanningRenewalTest {

    private static final ObjectMapper M = new ObjectMapper();

    private static JsonNode json(String text) {
        try {
            return M.readTree(text.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    @Test
    void theContractEndDateIsTheUtcEndOfThatDay() {
        assertEquals("2027-03-31T23:59:59.999Z",
                PlanningRenewal.renewalInstant(json("{'contract':{'contractEndDate':'2027-03-31'}}")));
    }

    @Test
    void theOneCurrentManualContractWinsOverTheTopLevelDate() {
        JsonNode e = json("{'contract':{'contractEndDate':'2027-03-31','manualContext':{'contracts':["
                + "{'status':'ended','contractEndDate':'2025-01-31'},{'status':'current','contractEndDate':'2027-06-30'}]}}}");
        assertEquals("2027-06-30T23:59:59.999Z", PlanningRenewal.renewalInstant(e));
    }

    @Test
    void twoCurrentContractsAreAmbiguous() {
        JsonNode e = json("{'contract':{'contractEndDate':'2027-03-31','manualContext':{'contracts':["
                + "{'status':'current','contractEndDate':'2027-06-30'},{'status':'current','contractEndDate':'2027-06-30'}]}}}");
        assertNull(PlanningRenewal.renewalInstant(e));
    }

    @Test
    void noCurrentContractFallsBackToTheTopLevelDate() {
        JsonNode e = json("{'contract':{'contractEndDate':'2027-03-31','manualContext':{'contracts':["
                + "{'status':'ended','contractEndDate':'2025-01-31'}],'other':1}}}");
        assertEquals("2027-03-31T23:59:59.999Z", PlanningRenewal.renewalInstant(e));
        assertEquals("2027-03-31T23:59:59.999Z",
                PlanningRenewal.renewalInstant(json("{'contract':{'contractEndDate':'2027-03-31','manualContext':{'contracts':null}}}")));
    }

    @Test
    void aCurrentContractWithoutADateDoesNotFallBack() {
        JsonNode e = json("{'contract':{'contractEndDate':'2027-03-31','manualContext':{'contracts':[{'status':'current'}]}}}");
        assertNull(PlanningRenewal.renewalInstant(e));
    }

    @Test
    void onlyAPlainCalendarDayIsAccepted() {
        for (String bad : new String[] {"2027-3-31", "2027-03-31T00:00:00Z", " 2027-03-31", "2027-03-31\\n", "27-03-31",
                "2027-02-30", "2027-13-01", "2027-00-10"}) {
            assertNull(PlanningRenewal.renewalInstant(json("{'contract':{'contractEndDate':'" + bad + "'}}")), bad);
        }
        assertEquals("2028-02-29T23:59:59.999Z",
                PlanningRenewal.renewalInstant(json("{'contract':{'contractEndDate':'2028-02-29'}}")));
        assertNull(PlanningRenewal.renewalInstant(json("{'contract':{'contractEndDate':20270331}}")));
    }

    @Test
    void aMissingContractOrDateIsNull() {
        assertNull(PlanningRenewal.renewalInstant(json("{}")));
        assertNull(PlanningRenewal.renewalInstant(json("{'contract':null}")));
        assertNull(PlanningRenewal.renewalInstant(json("{'contract':'2027-03-31'}")));
        assertNull(PlanningRenewal.renewalInstant(json("{'contract':{}}")));
    }

    @Test
    void inputsNodeWouldThrowOnAlsoThrow() {
        assertThrows(RuntimeException.class, () -> PlanningRenewal.renewalInstant(null));
        assertThrows(RuntimeException.class, () -> PlanningRenewal.renewalInstant(
                json("{'contract':{'manualContext':{'contracts':{'status':'current'}}}}")));
        assertThrows(RuntimeException.class, () -> PlanningRenewal.renewalInstant(
                json("{'contract':{'manualContext':{'contracts':[null]}}}")));
    }
}
