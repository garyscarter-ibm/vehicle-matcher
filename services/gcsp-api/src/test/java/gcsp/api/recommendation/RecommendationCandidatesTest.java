package gcsp.api.recommendation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.EligibleCandidates.Car;
import gcsp.api.allocation.EligibleCandidates.Decision;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Request;
import gcsp.api.allocation.EligibleCandidates.Subject;
import gcsp.api.allocation.EligibleCandidates.Unavailable;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Frozen allocation inputs go through the retained policy and canonical calculation, without repository reads. */
class RecommendationCandidatesTest {

    @Test
    void frozenInputsProduceCanonicalQuotesForEligibleAndIneligibleCarsWithoutMutation() throws Exception {
        Request request = request();
        JsonNode accountBefore = request.subject().accountRecord().deepCopy();
        JsonNode briefBefore = request.subject().briefContent().deepCopy();
        JsonNode employeeBefore = request.subject().employeeAttributes().deepCopy();
        List<JsonNode> carsBefore = request.cars().stream().map(car -> (JsonNode) car.attributes().deepCopy()).toList();

        Evaluated result = evaluated(request);

        assertEquals(2, result.decisions().size());
        Decision yes = result.decisions().get(0);
        assertEquals("eligible", yes.gateStatus());
        assertEquals(Double.valueOf(100), yes.score());
        assertEquals("ineligible", result.decisions().get(1).gateStatus());
        assertTrue(hasCode(result.decisions().get(1).blockers(), "policy-exclude"));
        JsonNode quote = yes.quote();
        Set<String> fields = new java.util.HashSet<>();
        quote.fieldNames().forEachRemaining(fields::add);
        assertEquals(Set.of("orderUuid", "configurationId", "snapshot", "terms", "employeeFacts", "reasons",
                "tradeOffs", "versions"), fields);
        assertEquals(request.cars().get(0).orderUuid(), quote.path("orderUuid").asText());
        assertEquals(request.cars().get(0).configurationId(), quote.path("configurationId").asText());
        assertEquals(Vehicles.snapshot(request.cars().get(0).attributes().get("facts")), quote.get("snapshot"));
        assertEquals(yes.versions(), quote.get("versions"));
        assertEquals("gcsp-policy-v1", result.versions().path("policy").asText());
        assertEquals("7", result.versions().path("clock").asText());
        assertEquals("1", yes.versions().path("availability").asText());
        assertEquals(accountBefore, request.subject().accountRecord());
        assertEquals(briefBefore, request.subject().briefContent());
        assertEquals(employeeBefore, request.subject().employeeAttributes());
        assertEquals(carsBefore, request.cars().stream().map(Car::attributes).toList());
        ((ObjectNode) quote.get("employeeFacts")).removeAll();
        assertEquals(accountBefore, request.subject().accountRecord());
    }

    @Test
    void employeeDriverAndOneStockFactChangeComputedGates() throws Exception {
        Request driverChanged = request();
        ((ObjectNode) account(driverChanged).path("drivers").get(0).get("eligible")).put("value", false);
        Decision blockedDriver = evaluated(driverChanged).decisions().get(0);
        assertEquals("ineligible", blockedDriver.gateStatus());
        assertTrue(hasCode(blockedDriver.blockers(), "driver-ineligible"));

        Request stockChanged = request();
        ((ObjectNode) stockChanged.cars().get(0).attributes().path("facts").path("facts")
                .get("eligibilityModelKey")).put("value", "G21 Touring|M340i");
        Decision blockedStock = evaluated(stockChanged).decisions().get(0);
        assertEquals("ineligible", blockedStock.gateStatus());
        assertTrue(hasCode(blockedStock.blockers(), "policy-exclude"));
        assertEquals("eligible", evaluated(request()).decisions().get(0).gateStatus());
    }

    @Test
    void existingDriverFactWinsAndAnotherEmployeesDriverCannotSupplyEligibility() throws Exception {
        Request preserved = request();
        JsonNode original = account(preserved).path("drivers").get(0).get("eligible");
        ObjectNode explicit = original.deepCopy();
        explicit.put("value", false);
        ((ObjectNode) account(preserved).get("employeeFacts")).set("driverEligible", explicit);
        Decision blocked = evaluated(preserved).decisions().get(0);
        assertEquals("ineligible", blocked.gateStatus());
        assertEquals(explicit, blocked.quote().path("employeeFacts").get("driverEligible"));

        Request otherEmployee = request();
        ((ObjectNode) account(otherEmployee).path("drivers").get(0)).put("employeeId", "someone-else");
        Decision unknown = evaluated(otherEmployee).decisions().get(0);
        assertEquals("needs-confirmation", unknown.gateStatus());
        assertTrue(hasCode(unknown.unknowns(), "driver-unconfirmed"));
    }

    @Test
    void chargingUsesSavedConfirmationAndNeverInventsAnObservationTime() throws Exception {
        for (String state : List.of("confirmed", "unresolved", "placeholder", "missing-time")) {
            Request request = request();
            ((ObjectNode) request.cars().get(0).attributes().path("facts").path("facts").get("fuel")).put("value", "ev");
            ObjectNode answer = charging(request);
            if (state.equals("placeholder")) {
                answer.put("source", "policy:brief.editor.v1").put("state", "needs-confirmation").putNull("value");
            } else if (state.equals("unresolved")) {
                answer.put("source", "employee").put("state", "needs-confirmation").putNull("value");
            } else {
                answer.put("source", "employee").put("state", "confirmed").put("value", "work");
                if (state.equals("confirmed")) answer.put("confirmedAt", "2026-11-05T08:30:00.000Z");
            }
            Decision decision = evaluated(request).decisions().get(0);
            JsonNode fact = decision.quote().path("employeeFacts").get("charging");
            if (state.equals("placeholder")) {
                assertEquals("eligible", decision.gateStatus());
                assertEquals(account(request).path("employeeFacts").get("charging"), fact);
            } else if (state.equals("confirmed")) {
                assertEquals("eligible", decision.gateStatus());
                assertEquals("work", fact.path("value").asText());
                assertEquals("employee", fact.path("provenance").path("sourceRef").asText());
                assertEquals("1", fact.path("provenance").path("version").asText());
                assertEquals(answer.get("confirmedAt"), fact.path("provenance").get("observedAt"));
                assertNotEquals(SourceFixture.NOW, fact.path("provenance").path("observedAt").asText());
            } else {
                assertEquals("needs-confirmation", decision.gateStatus());
                assertEquals("unknown", fact.path("status").asText());
                assertTrue(fact.path("provenance").path("observedAt").isNull());
                assertTrue(hasCode(decision.unknowns(), "charging-unconfirmed"));
            }
        }
    }

    @Test
    void typedFeedbackRequiresOneScopedBaselineAndLegacyFeedbackDoesNotBecomeTypedInput() throws Exception {
        Request valid = request();
        sameAgain(valid);
        Evaluated withBaseline = evaluated(valid);
        assertTrue(withBaseline.versions().path("feedback").asText().contains("manual-records-v1"));

        Request ambiguous = request();
        sameAgain(ambiguous);
        ArrayNode contracts = (ArrayNode) account(ambiguous).get("contracts");
        contracts.add(contracts.get(0).deepCopy());
        assertInstanceOf(Unavailable.class, adapter().evaluate(ambiguous));

        Request wrongSlot = request();
        sameAgain(wrongSlot);
        ((ObjectNode) account(wrongSlot).path("contracts").get(0)).put("slotId", "another-slot");
        assertInstanceOf(Unavailable.class, adapter().evaluate(wrongSlot));

        Request legacy = request();
        brief(legacy).putObject("currentCarFeedback").put("source", "employee").put("state", "confirmed");
        assertEquals(evaluated(request()), evaluated(legacy));
    }

    @Test
    void malformedIdentityMissingFactsAndUnavailableOrWrongPolicyNeverProduceSyntheticDecisions() throws Exception {
        Request malformed = request();
        ((ObjectNode) malformed.cars().get(0).attributes().path("facts").get("sourceKeys"))
                .put("stockId", malformed.cars().get(1).orderUuid());
        assertInstanceOf(Unavailable.class, adapter().evaluate(malformed));

        Request duplicate = request();
        assertInstanceOf(Unavailable.class, adapter().evaluate(with(duplicate, duplicate.asOf(), duplicate.policyVersion(),
                List.of(duplicate.cars().get(0), duplicate.cars().get(0)))));
        Request missingFacts = request();
        account(missingFacts).remove("employeeFacts");
        assertInstanceOf(Unavailable.class, adapter().evaluate(missingFacts));
        Request badBrief = request();
        brief(badBrief).remove("essentials");
        assertInstanceOf(Unavailable.class, adapter().evaluate(badBrief));
        assertInstanceOf(Unavailable.class, adapter().evaluate(null));
        assertInstanceOf(Unavailable.class, new RecommendationCandidates(new PolicyService(run -> {
            throw new IllegalStateException("source unavailable");
        })).evaluate(request()));
        Request pinned = request();
        assertInstanceOf(Unavailable.class, adapter().evaluate(with(pinned, pinned.asOf(), "missing-policy", pinned.cars())));
    }

    @Test
    void canonicalTermsRepeatAtTheSameInstantAndChangeAtALaterInstant() throws Exception {
        Request request = request();
        Decision original = evaluated(request).decisions().get(0);
        assertEquals(original.quote(), evaluated(request).decisions().get(0).quote());
        Decision later = evaluated(with(request, request.asOf().plusSeconds(1), request.policyVersion(), request.cars()))
                .decisions().get(0);
        assertEquals("eligible", later.gateStatus());
        assertNotEquals(original.quote().get("terms"), later.quote().get("terms"));
        assertNotEquals(original.quote().path("terms").get("termsVersion"), later.quote().path("terms").get("termsVersion"));
        assertNotEquals(original.quote().path("terms").get("validUntil"), later.quote().path("terms").get("validUntil"));
        assertEquals(original.quote().get("snapshot"), later.quote().get("snapshot"));
    }

    @Test
    void availabilityUsesOnlyTheActualReleaseDateFallbackAndVersion() throws Exception {
        Request request = request();
        ObjectNode release = (ObjectNode) request.cars().get(0).attributes().get("release");
        ((ObjectNode) release.get("availability")).remove("availableFrom");
        release.put("releasedAt", "2026-11-05T08:00:00.000Z");
        Decision yes = evaluated(request).decisions().get(0);
        assertEquals("eligible", yes.gateStatus());
        assertEquals("1", yes.versions().path("availability").asText());
        release.remove("releasedAt");
        EligibleCandidates.Result missingDate = adapter().evaluate(request);
        if (missingDate instanceof Evaluated evaluated) {
            assertNotEquals("eligible", evaluated.decisions().get(0).gateStatus());
        } else {
            assertInstanceOf(Unavailable.class, missingDate);
        }
    }

    static Request request() throws IOException {
        JsonNode golden = RecommendationDb.golden("paula");
        JsonNode context = golden.get("context");
        ObjectNode attributes = Js.obj();
        for (String key : List.of("companyId", "schemeId", "gradeId", "entitlementSlotId")) attributes.set(key, context.get(key));
        ObjectNode brief = Js.obj().put("schemaVersion", 1);
        brief.putObject("preferences").putObject("body").put("value", "estate").put("importance", 100)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee")
                .put("confirmedAt", SourceFixture.NOW);
        brief.putObject("essentials");
        List<Car> cars = new ArrayList<>();
        JsonNode rows = RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows");
        for (int i : List.of(0, 1)) {
            JsonNode row = rows.get(i);
            ObjectNode attrs = row.deepCopy();
            attrs.remove(List.of("orderUuid", "configurationId", "version", "state", "available", "held", "allocated"));
            cars.add(new Car(row.get("orderUuid").asText(), row.get("configurationId").asText(), row.get("version").asLong(), attrs));
        }
        Subject subject = new Subject(context.get("employeeId").asText(), context.get("entitlementSlotId").asText(),
                golden.get("input").get("employeeVersion").asLong(), attributes,
                golden.get("input").get("manualContext").deepCopy(), 1, brief);
        return new Request(SourceFixture.ENV, SourceFixture.RUN, context.get("policyVersion").asText(),
                Instant.parse(SourceFixture.NOW), 7, subject, List.copyOf(cars));
    }

    private static Request with(Request request, Instant asOf, String policy, List<Car> cars) {
        return new Request(request.environmentId(), request.runId(), policy, asOf, request.clockVersion(), request.subject(), cars);
    }

    private static RecommendationCandidates adapter() {
        return new RecommendationCandidates(SourceFixture.policy());
    }

    private static Evaluated evaluated(Request request) {
        return assertInstanceOf(Evaluated.class, adapter().evaluate(request));
    }

    private static ObjectNode account(Request request) {
        return (ObjectNode) request.subject().accountRecord();
    }

    private static ObjectNode brief(Request request) {
        return (ObjectNode) request.subject().briefContent();
    }

    private static ObjectNode charging(Request request) {
        return ((ObjectNode) brief(request).get("essentials")).putObject("charging").put("operator", "includes").putNull("unit");
    }

    private static void sameAgain(Request request) {
        brief(request).putObject("sameAgain").put("on", true).put("contractId", "current:employee-paula")
                .put("source", "employee").put("setAt", SourceFixture.NOW);
    }

    private static boolean hasCode(JsonNode rows, String code) {
        for (JsonNode row : rows) if (code.equals(row.path("code").asText())) return true;
        return false;
    }
}
