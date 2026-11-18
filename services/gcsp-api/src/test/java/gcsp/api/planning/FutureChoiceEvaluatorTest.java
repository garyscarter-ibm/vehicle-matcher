package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The Node createFutureChoiceEvaluator port over the real PolicyService and the retained seed policy.
 * Authored, unrun: fixture rows (F70 Sports Hatch|120 at 800 points, G20 Saloon|320i excluded and 1100 points for
 * grade G1-6, allowance 1000) are the ones PolicyFutureTermsTest relies on.
 */
class FutureChoiceEvaluatorTest {

    private static final String AS_OF = "2026-11-06T00:00:00.000Z";
    private static final String HORIZON = "2027-02-04T00:00:00.000Z";
    private static final Principal GREG = PlanningFixtures.principal("greg");

    @TempDir
    Path dir;

    private PolicyService policy;
    private FutureChoiceEvaluator evaluator;

    @BeforeEach
    void wire() throws Exception {
        policy = new PolicyService(new PolicyFiles(dir, "future-choices").source(PlanningFixtures.M.createArrayNode()));
        evaluator = new FutureChoiceEvaluator(policy, new PolicyFutureTerms(policy));
    }

    // ---- fixtures ----

    private static ObjectNode fact(String value, String unit) {
        String v = value == null ? "null" : value.startsWith("{") || value.matches("-?\\d+|true|false") ? value : "\"" + value + "\"";
        String u = unit == null ? "null" : "\"" + unit + "\"";
        return (ObjectNode) PlanningFixtures.json("{\"status\": \"known\", \"value\": " + v + ", \"unit\": " + u
                + ", \"provenance\": {\"sourceRef\": \"cfg-feed\", \"version\": \"f1\", \"observedAt\": \"2026-11-05T00:00:00.000Z\","
                + " \"assurance\": \"confirmed-listing\"}}");
    }

    private static ObjectNode configuration(String id, String derivativeId, String modelKey) {
        ObjectNode c = PlanningFixtures.M.createObjectNode();
        c.put("configurationId", id);
        c.put("derivativeId", derivativeId);
        c.put("version", "facts-" + id);
        c.putObject("display").put("name", "Car " + id);
        ObjectNode facts = c.putObject("facts");
        facts.set("eligibilityModelKey", fact(modelKey, null));
        facts.set("fuel", fact("petrol", null));
        facts.set("body", fact("hatchback", null));
        facts.set("seats", fact("5", "count"));
        return c;
    }

    private static ObjectNode derivative(String id, String... configurationIds) {
        ObjectNode d = PlanningFixtures.M.createObjectNode();
        d.put("derivativeId", id);
        ArrayNode ids = d.putArray("configurationIds");
        for (String c : configurationIds) {
            ids.add(c);
        }
        return d;
    }

    /** One eligible hatch for grade G1-6, renewal 2027-01-31, one derivative, no decline history. */
    private static ObjectNode input() {
        ObjectNode in = (ObjectNode) PlanningFixtures.json("""
                {"read": {"runId": "run-1", "asOf": "2026-11-06T00:00:00.000Z", "policyVersion": "gcsp-policy-v1",
                    "horizonEnd": "2027-02-04T00:00:00.000Z"},
                 "employee": {"runId": "run-1", "employeeId": "emp-1", "companyId": "demo-bmw-fs-uk",
                    "schemeId": "choices-fs-uk", "gradeId": "G1-6", "renewalId": "ren-1", "entitlementSlotId": "slot-1",
                    "contract": {"contractEndDate": "2027-01-31", "manualContext": {"employeeFacts": {
                        "essentials": {},
                        "driverEligible": {"status": "known", "value": true, "unit": null,
                            "provenance": {"sourceRef": "hr", "version": "h1", "observedAt": "2026-11-01T00:00:00.000Z",
                                "assurance": "confirmed-listing"}}}}}},
                 "brief": {"runId": "run-1", "employeeId": "emp-1", "status": "confirmed", "briefVersion": 1,
                    "schemaVersion": 1, "renewalId": "ren-1", "entitlementSlotId": "slot-1",
                    "confirmedAt": "2026-11-02T00:00:00.000Z",
                    "preferences": {"body": {"value": ["hatchback"], "importance": 50, "valueState": "confirmed",
                        "importanceState": "confirmed", "source": "test"}},
                    "essentials": {
                      "charging": {"value": "home", "operator": "equals", "unit": null, "state": "confirmed", "source": "test"},
                      "seats": {"value": 4, "operator": "gte", "unit": "count", "state": "confirmed", "source": "test"}}},
                 "catalog": {"runId": "run-1", "asOf": "2026-11-06T00:00:00.000Z", "policyVersion": "gcsp-policy-v1",
                    "version": "cat-v1", "derivatives": [], "configurations": []},
                 "history": {"decisions": [], "offers": [], "briefs": []}}
                """);
        ObjectNode catalog = (ObjectNode) in.get("catalog");
        ((ArrayNode) catalog.get("derivatives")).add(derivative("d-hatch", "cfg-hatch"));
        ((ArrayNode) catalog.get("configurations")).add(configuration("cfg-hatch", "d-hatch", "F70 Sports Hatch|120"));
        return in;
    }

    private static ObjectNode with(UnaryOperator<ObjectNode> edit) {
        return edit.apply(input());
    }

    private static ObjectNode node(ObjectNode in, String name) {
        return (ObjectNode) in.get(name);
    }

    private static ObjectNode facts(ObjectNode in, int configuration) {
        return (ObjectNode) in.get("catalog").get("configurations").get(configuration).get("facts");
    }

    private static List<String> names(JsonNode node) {
        List<String> out = new ArrayList<>();
        node.fieldNames().forEachRemaining(out::add);
        return out;
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(n -> out.add(n.textValue()));
        return out;
    }

    private static void assertUnavailable(String code, JsonNode outcome) {
        assertEquals("unavailable", outcome.get("status").textValue(), outcome.toString());
        assertEquals(code, outcome.get("code").textValue());
        assertEquals("1.0.0", outcome.get("contractVersion").textValue());
        assertFalse(outcome.has("value"));
    }

    private static JsonNode decision(JsonNode outcome, String configurationId) {
        for (JsonNode d : outcome.get("value").get("decisions")) {
            if (configurationId.equals(d.get("configurationId").textValue())) {
                return d;
            }
        }
        throw new AssertionError(configurationId);
    }

    private static List<String> codes(JsonNode list) {
        List<String> out = new ArrayList<>();
        list.forEach(n -> out.add(n.get("code").textValue()));
        return out;
    }

    private FutureChoiceEvaluator over(PolicyService service) {
        return new FutureChoiceEvaluator(service, new PolicyFutureTerms(service));
    }

    private FutureChoiceEvaluator over(String name, String ops) throws Exception {
        PolicyService edited = new PolicyService(new PolicyFiles(dir, name).source(PlanningFixtures.json(ops)));
        return over(edited);
    }

    // ---- the happy path ----

    @Test
    void eligibleConfigurationIsAcceptedWithNodeShape() {
        ObjectNode in = input();
        ObjectNode before = in.deepCopy();
        ObjectNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals("1.0.0", out.get("contractVersion").textValue());
        assertEquals(before, in);
        JsonNode value = out.get("value");
        assertEquals(List.of("runId", "policyVersion", "employeeId", "briefVersion", "catalogVersion", "version",
                "acceptableDerivativeIds", "excludedStockIds", "requiredBy", "gates", "decisions", "limitations"), names(value));
        assertEquals("run-1", value.get("runId").textValue());
        assertEquals("gcsp-policy-v1", value.get("policyVersion").textValue());
        assertEquals("emp-1", value.get("employeeId").textValue());
        assertEquals(1, value.get("briefVersion").intValue());
        assertEquals("cat-v1", value.get("catalogVersion").textValue());
        assertTrue(value.get("version").textValue().matches("[0-9a-f]{64}"));
        assertEquals(List.of("d-hatch"), texts(value.get("acceptableDerivativeIds")));
        assertEquals(0, value.get("excludedStockIds").size());
        assertEquals("2027-01-31T23:59:59.999Z", value.get("requiredBy").textValue());
        assertEquals(0, value.get("gates").size());
        assertEquals(List.of(
                "All represented configurations must pass before a derivative-only quantity can promise coverage.",
                "Preference fit is advisory; no acceptance threshold or acceptance probability is inferred.",
                "Exact declined stock exclusions do not exclude other vehicles or future configurations of that derivative."),
                texts(value.get("limitations")));
        JsonNode d = decision(out, "cfg-hatch");
        assertEquals(List.of("configurationId", "derivativeId", "gateStatus", "score", "components", "blockers", "unknowns",
                "reasons", "tradeOffs", "terms", "evidence"), names(d));
        assertEquals("eligible", d.get("gateStatus").textValue());
        assertTrue(d.get("score").isNumber(), d.toString());
        assertEquals(0, d.get("blockers").size());
        assertEquals(0, d.get("unknowns").size());
        assertTrue(codes(d.get("reasons")).containsAll(List.of("driver-eligible", "policy-include", "allowance-sufficient",
                "essential-met")), d.get("reasons").toString());
        assertEquals("employee-scheme", d.get("terms").get("kind").textValue());
        assertEquals(800, d.get("terms").get("points").get("value").intValue());
        assertEquals(List.of("eligibility", "points", "allowance", "factsVersion"), names(d.get("evidence")));
        assertEquals("facts-cfg-hatch", d.get("evidence").get("factsVersion").textValue());
        assertEquals(800, d.get("evidence").get("points").get("monthlyPoints").intValue());
    }

    // ---- FUCQ-530: driver eligibility derived from the employee driver ----

    private static JsonNode eligibleFact(String json) {
        return PlanningFixtures.json(json);
    }

    private static ObjectNode driversOnly(ObjectNode in, String kind, String employeeId, JsonNode eligible) {
        ObjectNode context = (ObjectNode) in.get("employee").get("contract").get("manualContext");
        ((ObjectNode) context.get("employeeFacts")).remove("driverEligible");
        ObjectNode driver = context.putArray("drivers").addObject();
        driver.put("driverId", "drv-1").put("kind", kind).put("employeeId", employeeId);
        if (eligible != null) {
            driver.set("eligible", eligible);
        }
        return in;
    }

    private static final String KNOWN = """
            {"status": "known", "value": %s, "unit": null,
             "provenance": {"sourceRef": "hr", "version": "h1", "observedAt": "2026-11-01T00:00:00.000Z",
                "assurance": "confirmed-listing"}}""";

    @Test
    void fucq530EmployeeDriverEligibilityIsDerivedWhenTheStoredFactIsAbsent() {
        ObjectNode in = driversOnly(input(), "employee", "emp-1", eligibleFact(KNOWN.formatted("true")));
        JsonNode d = decision(evaluator.evaluateChoices(GREG, in), "cfg-hatch");
        assertTrue(codes(d.get("reasons")).contains("driver-eligible"), d.toString());
        assertFalse(codes(d.get("unknowns")).contains("driver-unconfirmed"), d.toString());
    }

    @Test
    void fucq530StoredDriverFactWinsOverTheEmployeeDriver() {
        ObjectNode in = input();
        ObjectNode context = (ObjectNode) in.get("employee").get("contract").get("manualContext");
        context.putArray("drivers").addObject().put("kind", "employee").put("employeeId", "emp-1")
                .set("eligible", eligibleFact(KNOWN.formatted("false")));
        JsonNode d = decision(evaluator.evaluateChoices(GREG, in), "cfg-hatch");
        assertTrue(codes(d.get("reasons")).contains("driver-eligible"), d.toString());
        assertFalse(codes(d.get("blockers")).contains("driver-ineligible"), d.toString());
    }

    @Test
    void fucq530NoEmployeeDriverStaysUnconfirmed() {
        ObjectNode none = input();
        ((ObjectNode) none.get("employee").get("contract").get("manualContext").get("employeeFacts")).remove("driverEligible");
        assertTrue(codes(decision(evaluator.evaluateChoices(GREG, none), "cfg-hatch").get("unknowns")).contains("driver-unconfirmed"));
        for (ObjectNode in : List.of(
                driversOnly(input(), "employee", "emp-2", eligibleFact(KNOWN.formatted("true"))),
                driversOnly(input(), "household", "emp-1", eligibleFact(KNOWN.formatted("true"))),
                driversOnly(input(), "employee", "emp-1", null),
                driversOnly(input(), "employee", "emp-1", eligibleFact(KNOWN.formatted("null").replace("\"known\"", "\"unknown\""))))) {
            JsonNode d = decision(evaluator.evaluateChoices(GREG, in), "cfg-hatch");
            assertTrue(codes(d.get("unknowns")).contains("driver-unconfirmed"), d.toString());
            assertFalse(codes(d.get("reasons")).contains("driver-eligible"), d.toString());
        }
    }

    @Test
    void fucq530IneligibleEmployeeDriverBlocks() {
        ObjectNode in = driversOnly(input(), "employee", "emp-1", eligibleFact(KNOWN.formatted("false")));
        JsonNode d = decision(evaluator.evaluateChoices(GREG, in), "cfg-hatch");
        assertTrue(codes(d.get("blockers")).contains("driver-ineligible"), d.toString());
        assertFalse(codes(d.get("unknowns")).contains("driver-unconfirmed"), d.toString());
    }

    @Test
    void decisionsAreSortedByConfigurationIdAndTheVersionIsStable() {
        ObjectNode in = with(i -> {
            ObjectNode catalog = node(i, "catalog");
            ((ArrayNode) catalog.get("configurations")).insert(0, configuration("cfg-b", "d-hatch", "F70 Sports Hatch|120"));
            ((ArrayNode) catalog.get("derivatives")).removeAll();
            ((ArrayNode) catalog.get("derivatives")).add(derivative("d-hatch", "cfg-hatch", "cfg-b"));
            return i;
        });
        JsonNode first = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", first.get("status").textValue(), first.toString());
        List<String> order = new ArrayList<>();
        first.get("value").get("decisions").forEach(d -> order.add(d.get("configurationId").textValue()));
        assertEquals(List.of("cfg-b", "cfg-hatch"), order);
        JsonNode again = evaluator.evaluateChoices(GREG, in);
        assertEquals(first.get("value").get("version"), again.get("value").get("version"));
        JsonNode other = evaluator.evaluateChoices(GREG, with(i -> {
            node(i, "catalog").put("version", "cat-v2");
            return i;
        }));
        assertNotEquals(first.get("value").get("version"), other.get("value").get("version"));
    }

    // ---- identity and configuration ----

    @Test
    void onlyGregMayEvaluate() {
        assertEquals("forbidden", evaluator.evaluateChoices(PlanningFixtures.principal("employee"), input())
                .get("status").textValue());
        assertEquals("forbidden", evaluator.evaluateChoices(null, input()).get("status").textValue());
    }

    @Test
    void missingPolicyOrTermsIsNotConfigured() {
        assertUnavailable("planning-future-evaluator-not-configured",
                new FutureChoiceEvaluator(null, new PolicyFutureTerms(policy)).evaluateChoices(GREG, input()));
        assertUnavailable("planning-future-evaluator-not-configured",
                new FutureChoiceEvaluator(policy, null).evaluateChoices(GREG, input()));
    }

    @Test
    void aNullInputFailsAsEvaluationUnavailable() {
        assertUnavailable("planning-future-evaluation-unavailable", evaluator.evaluateChoices(GREG, null));
        assertUnavailable("planning-future-evaluation-unavailable",
                evaluator.evaluateChoices(GREG, PlanningFixtures.M.createObjectNode()));
    }

    // ---- input ----

    @Test
    void inputFamiliesAreRefused() {
        Principal otherRun = new Principal("sub-greg", List.of("greg"), "env-1", "run-2", null, PlanningFixtures.POLICY, List.of());
        assertUnavailable("planning-future-input-invalid", evaluator.evaluateChoices(otherRun, input()));
        Principal otherPolicy = new Principal("sub-greg", List.of("greg"), "env-1", "run-1", null, "gcsp-policy-v2", List.of());
        assertUnavailable("planning-future-input-invalid", evaluator.evaluateChoices(otherPolicy, input()));
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                i -> { node(i, "brief").put("status", "draft"); return i; },
                i -> { node(i, "brief").put("briefVersion", 0); return i; },
                i -> { node(i, "brief").put("employeeId", "emp-2"); return i; },
                i -> { node(i, "brief").put("entitlementSlotId", "slot-9"); return i; },
                i -> { node(i, "brief").put("renewalId", "ren-9"); return i; },
                i -> { node(i, "employee").remove("gradeId"); return i; },
                i -> { node(i, "read").put("asOf", "2026-11-06"); return i; },
                i -> { node(i, "read").remove("horizonEnd"); return i; },
                i -> { ((ObjectNode) node(i, "employee").get("contract")).remove("contractEndDate"); return i; },
                i -> { ((ObjectNode) node(i, "employee").get("contract")).put("contractEndDate", "2027-03-01"); return i; },
                i -> { ((ObjectNode) node(i, "employee").get("contract")).put("contractEndDate", "2027-02-30"); return i; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-input-invalid", evaluator.evaluateChoices(GREG, with(breaker)));
        }
    }

    @Test
    void twoCurrentContractsAreAmbiguousAndRefused() {
        ObjectNode in = with(i -> {
            ObjectNode manual = (ObjectNode) node(i, "employee").get("contract").get("manualContext");
            ArrayNode contracts = manual.putArray("contracts");
            contracts.addObject().put("status", "current").put("contractEndDate", "2027-01-31");
            contracts.addObject().put("status", "current").put("contractEndDate", "2027-01-30");
            return i;
        });
        assertUnavailable("planning-future-input-invalid", evaluator.evaluateChoices(GREG, in));
    }

    // ---- catalogue ----

    @Test
    void catalogueFamiliesAreRefused() {
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                i -> { node(i, "catalog").put("asOf", "2026-11-05T00:00:00.000Z"); return i; },
                i -> { node(i, "catalog").put("version", ""); return i; },
                i -> { node(i, "catalog").putArray("derivatives"); return i; },
                i -> { ((ArrayNode) node(i, "catalog").get("configurations")).add(
                        configuration("cfg-hatch", "d-hatch", "F70 Sports Hatch|120")); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("configurations").get(0)).put("stockId", "s-1"); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("configurations").get(0)).put("vin", "V"); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("configurations").get(0)).put("derivativeId", "d-other"); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("derivatives").get(0)).putArray("configurationIds").add("cfg-ghost"); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("configurations").get(0)).remove("display"); return i; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-catalog-invalid", evaluator.evaluateChoices(GREG, with(breaker)));
        }
    }

    @Test
    void badConfigurationFactsAreCatalogInvalid() {
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                i -> { facts(i, 0).putNull("seats"); return i; },
                i -> { ((ObjectNode) facts(i, 0).get("seats")).put("status", "maybe"); return i; },
                i -> { ((ObjectNode) facts(i, 0).get("seats")).put("unit", "L"); return i; },
                i -> { ((ObjectNode) facts(i, 0).get("seats").get("provenance")).put("observedAt", "2026-11-07T00:00:00.000Z"); return i; },
                i -> { ((ObjectNode) facts(i, 0).get("fuel")).put("status", "unknown"); return i; },
                i -> { ((ObjectNode) facts(i, 0).get("seats").get("provenance")).remove("sourceRef"); return i; },
                i -> { ((ObjectNode) node(i, "catalog").get("configurations").get(0)).put("facts", "none"); return i; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-catalog-invalid", evaluator.evaluateChoices(GREG, with(breaker)));
        }
    }

    // ---- policy ----

    @Test
    void missingAssumptionIsPolicyUnavailable() throws Exception {
        FutureChoiceEvaluator removed = over("no-decline",
                "[{\"op\": \"remove\", \"prefix\": \"offer.declinedCar.exclusion\"}]");
        assertUnavailable("planning-future-policy-unavailable", removed.evaluateChoices(GREG, input()));
    }

    @Test
    void unknownPolicyVersionPinIsPolicyUnavailable() {
        Principal pinned = new Principal("sub-greg", List.of("greg"), "env-1", "run-1", null, "gcsp-policy-v0", List.of());
        ObjectNode in = with(i -> {
            node(i, "read").put("policyVersion", "gcsp-policy-v0");
            node(i, "catalog").put("policyVersion", "gcsp-policy-v0");
            return i;
        });
        assertUnavailable("planning-future-policy-unavailable", evaluator.evaluateChoices(pinned, in));
    }

    @Test
    void invalidPolicyValuesAreRefused() throws Exception {
        List<String> ops = List.of(
                "[{\"op\": \"set\", \"key\": \"brief.slider.minimum\", \"value\": 5}]",
                "[{\"op\": \"set\", \"key\": \"brief.slider.maximum\", \"value\": 90}]",
                "[{\"op\": \"set\", \"key\": \"offer.declinedCar.exclusion\", \"value\": \"never\"}]",
                "[{\"op\": \"set\", \"key\": \"eligibility.homeCharging.requiredForPlugIn\", \"value\": \"yes\"}]",
                "[{\"op\": \"patch\", \"key\": \"employee.recommendation.v1\", \"path\": [\"retailBudgetEnabled\"], \"value\": true}]");
        int n = 0;
        for (String edit : ops) {
            assertUnavailable("planning-future-policy-invalid", over("invalid-" + n++, edit).evaluateChoices(GREG, input()));
        }
    }

    @Test
    void aPolicyAnswerForAnotherVersionIsPolicyUnavailable() {
        for (String which : List.of("allowance", "eligibility", "assumption")) {
            Scripted scripted = new Scripted(policy, which);
            assertUnavailable("planning-future-policy-unavailable", over(scripted).evaluateChoices(GREG, input()));
        }
    }

    @Test
    void unknownGradeFailsTheAllowanceRead() {
        ObjectNode in = with(i -> { node(i, "employee").put("gradeId", "G99"); return i; });
        assertUnavailable("planning-future-policy-unavailable", evaluator.evaluateChoices(GREG, in));
    }

    // ---- brief and employee facts ----

    @Test
    void invalidBriefContentIsBriefInvalid() {
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                i -> { node(i, "brief").put("schemaVersion", 2); return i; },
                i -> { ((ObjectNode) node(i, "brief").get("preferences")).putObject("nonsense"); return i; },
                i -> { ((ObjectNode) node(i, "brief").get("essentials").get("seats")).put("operator", "equals"); return i; },
                i -> { node(i, "brief").put("requiredBy", "tomorrow"); return i; },
                i -> { ((ObjectNode) node(i, "brief").get("essentials").get("charging")).put("value", "garage"); return i; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-brief-invalid", evaluator.evaluateChoices(GREG, with(breaker)));
        }
    }

    @Test
    void missingEmployeeFactsAreUnavailableAndBadEssentialsInvalid() {
        ObjectNode none = with(i -> {
            ((ObjectNode) node(i, "employee").get("contract").get("manualContext")).remove("employeeFacts");
            return i;
        });
        assertUnavailable("planning-future-employee-facts-unavailable", evaluator.evaluateChoices(GREG, none));
        ObjectNode notObject = with(i -> {
            ((ObjectNode) node(i, "employee").get("contract").get("manualContext")).put("employeeFacts", "x");
            return i;
        });
        assertUnavailable("planning-future-employee-facts-unavailable", evaluator.evaluateChoices(GREG, notObject));
        ObjectNode bad = with(i -> {
            ObjectNode essentials = (ObjectNode) node(i, "employee").get("contract").get("manualContext")
                    .get("employeeFacts").get("essentials");
            essentials.putObject("seats").put("value", "many");
            return i;
        });
        assertUnavailable("planning-future-employee-facts-invalid", evaluator.evaluateChoices(GREG, bad));
    }

    @Test
    void absentEmployeeEssentialsAreUnconfirmedNotInvalid() {
        ObjectNode in = with(i -> {
            ((ObjectNode) node(i, "employee").get("contract").get("manualContext").get("employeeFacts")).remove("essentials");
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        JsonNode d = decision(out, "cfg-hatch");
        assertEquals("needs-confirmation", d.get("gateStatus").textValue());
        assertTrue(codes(d.get("unknowns")).contains("employee-essentials-unconfirmed"));
        assertTrue(d.get("score").isNull());
        assertTrue(texts(out.get("value").get("gates")).contains("derivative-representation-not-fully-eligible:d-hatch"));
        assertTrue(texts(out.get("value").get("gates")).contains("employee-essentials-unconfirmed"));
    }

    // ---- decline history ----

    private static ObjectNode decline(ObjectNode in, boolean withOffer, boolean samePreferences) {
        ObjectNode history = node(in, "history");
        ((ArrayNode) history.get("decisions")).add(PlanningFixtures.json(
                "{\"employeeId\": \"emp-1\", \"decision\": \"decline\", \"offerId\": \"o-1\", \"versions\": {\"brief\": 1}}"));
        if (withOffer) {
            ((ArrayNode) history.get("offers")).add(PlanningFixtures.json(
                    "{\"offerId\": \"o-1\", \"employeeId\": \"emp-1\", \"orderUuid\": \"order-9\"}"));
        }
        ObjectNode previous = ((ObjectNode) in.get("brief")).deepCopy();
        previous.put("briefVersion", 1);
        if (!samePreferences) {
            ((ObjectNode) previous.get("preferences").get("body")).put("importance", 10);
            ((ObjectNode) previous.get("preferences").get("body")).put("valueState", "draft");
        }
        ((ArrayNode) history.get("briefs")).add(previous);
        return in;
    }

    @Test
    void anIncompleteDeclineHistoryIsRefused() {
        assertUnavailable("planning-future-decline-history-incomplete",
                evaluator.evaluateChoices(GREG, decline(input(), false, true)));
        ObjectNode noHistory = with(i -> { i.remove("history"); return i; });
        assertUnavailable("planning-future-decline-history-incomplete", evaluator.evaluateChoices(GREG, noHistory));
        ObjectNode missingList = with(i -> { node(i, "history").remove("briefs"); return i; });
        assertUnavailable("planning-future-decline-history-incomplete", evaluator.evaluateChoices(GREG, missingList));
    }

    @Test
    void anExactDeclinedCarStaysExcludedWhileTheConfirmedIntentIsUnchanged() {
        JsonNode out = evaluator.evaluateChoices(GREG, decline(input(), true, true));
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals(List.of("order-9"), texts(out.get("value").get("excludedStockIds")));
        assertEquals("eligible", decision(out, "cfg-hatch").get("gateStatus").textValue());
    }

    @Test
    void aChangedConfirmedIntentReopensTheDeclinedCar() {
        JsonNode out = evaluator.evaluateChoices(GREG, decline(input(), true, false));
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals(0, out.get("value").get("excludedStockIds").size());
    }

    // ---- points and allowance ----

    @Test
    void pointsNotFoundIsPointsUnavailableAndNeedsConfirmation() {
        ObjectNode in = with(i -> {
            facts(i, 0).set("eligibilityModelKey", fact("No Such Model|000", null));
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        JsonNode d = decision(out, "cfg-hatch");
        assertEquals("needs-confirmation", d.get("gateStatus").textValue());
        assertTrue(codes(d.get("unknowns")).contains("points-unavailable"));
        assertTrue(codes(d.get("unknowns")).contains("eligibility-unconfirmed"));
        assertTrue(d.get("terms").isNull());
        assertTrue(d.get("evidence").get("points").isNull());
    }

    @Test
    void allowanceExceededAndPolicyExcludeAreBlockersAndRollIntoGates() {
        ObjectNode in = with(i -> {
            ObjectNode catalog = node(i, "catalog");
            ((ArrayNode) catalog.get("configurations")).add(configuration("cfg-saloon", "d-saloon", "G20 Saloon|320i"));
            ((ArrayNode) catalog.get("derivatives")).add(derivative("d-saloon", "cfg-saloon"));
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        JsonNode d = decision(out, "cfg-saloon");
        assertEquals("ineligible", d.get("gateStatus").textValue());
        assertTrue(d.get("score").isNull());
        assertTrue(codes(d.get("blockers")).containsAll(List.of("policy-exclude", "allowance-exceeded")), d.toString());
        assertEquals(List.of("d-hatch"), texts(out.get("value").get("acceptableDerivativeIds")));
        List<String> gates = texts(out.get("value").get("gates"));
        assertEquals(List.of("allowance-exceeded", "derivative-representation-not-fully-eligible:d-saloon",
                "policy-exclude"), gates);
    }

    @Test
    void aDerivativeWithAnyIneligibleConfigurationIsNotAcceptable() {
        ObjectNode in = with(i -> {
            ObjectNode catalog = node(i, "catalog");
            ((ArrayNode) catalog.get("configurations")).add(configuration("cfg-mixed", "d-mixed", "F70 Sports Hatch|120"));
            ((ArrayNode) catalog.get("configurations")).add(configuration("cfg-saloon", "d-mixed", "G20 Saloon|320i"));
            ((ArrayNode) catalog.get("derivatives")).add(derivative("d-mixed", "cfg-mixed", "cfg-saloon"));
            return i;
        });
        JsonNode value = evaluator.evaluateChoices(GREG, in).get("value");
        assertEquals(List.of("d-hatch"), texts(value.get("acceptableDerivativeIds")));
        assertTrue(texts(value.get("gates")).contains("derivative-representation-not-fully-eligible:d-mixed"));
        assertEquals(3, value.get("decisions").size());
    }

    // ---- future terms ----

    @Test
    void termsThatDoNotOutliveTheRenewalAreTermsInvalid() {
        ObjectNode in = with(i -> {
            node(i, "read").put("horizonEnd", "2027-01-31T23:59:59.999Z");
            return i;
        });
        assertUnavailable("planning-future-terms-invalid", evaluator.evaluateChoices(GREG, in));
    }

    @Test
    void termsPointsThatDisagreeWithThePolicyReadAreTermsInvalid() {
        Scripted scripted = new Scripted(policy, "terms-points-differ");
        assertUnavailable("planning-future-terms-invalid", over(scripted).evaluateChoices(GREG, input()));
    }

    @Test
    void aTermsProviderFailureIsTermsUnavailable() {
        Scripted scripted = new Scripted(policy, "terms-fail");
        assertUnavailable("planning-future-terms-unavailable", over(scripted).evaluateChoices(GREG, input()));
    }

    @Test
    void anAssuranceOutsideTheConfirmedListIsTermsInvalid() throws Exception {
        FutureChoiceEvaluator narrowed = over("narrow-assurance", "[{\"op\": \"patch\", \"key\": \"employee.recommendation.v1\","
                + " \"path\": [\"confirmedAssurances\", 2], \"value\": \"derived\"}]");
        assertUnavailable("planning-future-terms-invalid", narrowed.evaluateChoices(GREG, input()));
    }

    // ---- required by ----

    @Test
    void aRenewalAlreadyPassedIsABlocker() {
        ObjectNode in = with(i -> {
            ((ObjectNode) node(i, "employee").get("contract")).put("contractEndDate", "2026-11-05");
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals("2026-11-05T23:59:59.999Z", out.get("value").get("requiredBy").textValue());
        JsonNode d = decision(out, "cfg-hatch");
        assertEquals("ineligible", d.get("gateStatus").textValue());
        assertTrue(codes(d.get("blockers")).contains("renewal-already-passed"));
        assertTrue(texts(out.get("value").get("gates")).contains("renewal-already-passed"));
        assertEquals(0, out.get("value").get("acceptableDerivativeIds").size());
    }

    @Test
    void aBriefDeadlineAlreadyPassedIsARequiredByBlocker() {
        ObjectNode in = with(i -> {
            node(i, "brief").put("requiredBy", "2026-11-05T00:00:00.000Z");
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, in);
        assertEquals("ok", out.get("status").textValue(), out.toString());
        assertEquals("2026-11-05T00:00:00.000Z", out.get("value").get("requiredBy").textValue());
        assertTrue(codes(decision(out, "cfg-hatch").get("blockers")).contains("required-by-already-passed"));
    }

    @Test
    void anEarlierConfirmedStatedDeadlineWinsAndAnUnconfirmedOneIsUnknown() {
        ObjectNode confirmed = with(i -> {
            ObjectNode f = (ObjectNode) node(i, "employee").get("contract").get("manualContext").get("employeeFacts");
            f.set("requiredBy", fact("2027-01-10T00:00:00.000Z", null));
            return i;
        });
        JsonNode out = evaluator.evaluateChoices(GREG, confirmed);
        assertEquals("2027-01-10T00:00:00.000Z", out.get("value").get("requiredBy").textValue());
        ObjectNode unconfirmed = with(i -> {
            ObjectNode f = (ObjectNode) node(i, "employee").get("contract").get("manualContext").get("employeeFacts");
            ObjectNode stated = fact("2027-01-10T00:00:00.000Z", null);
            ((ObjectNode) stated.get("provenance")).put("assurance", "derived");
            f.set("requiredBy", stated);
            return i;
        });
        JsonNode other = evaluator.evaluateChoices(GREG, unconfirmed);
        assertEquals("2027-01-31T23:59:59.999Z", other.get("value").get("requiredBy").textValue());
        assertTrue(codes(decision(other, "cfg-hatch").get("unknowns")).contains("required-by-unconfirmed"));
    }

    // ---- scripted policy ----

    /** A real service with one scripted deviation, to reach refusals the real seed cannot produce. */
    private static final class Scripted extends PolicyService {

        private final PolicyService delegate;
        private final String mode;
        private final AtomicInteger pointsReads = new AtomicInteger();

        Scripted(PolicyService delegate, String mode) {
            super(null);
            this.delegate = delegate;
            this.mode = mode;
        }

        private static PolicyResult relabel(PolicyResult r) {
            ObjectNode body = r.body().deepCopy();
            body.put("policyVersion", "gcsp-policy-v0");
            return new PolicyResult(r.status(), "gcsp-policy-v0", body);
        }

        @Override
        public PolicyResult getAssumption(String key, PolicyRead read) {
            PolicyResult r = delegate.getAssumption(key, read);
            return mode.equals("assumption") && key.equals("brief.slider.minimum") ? relabel(r) : r;
        }

        @Override
        public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
            PolicyResult r = delegate.getAllowance(context, read);
            return mode.equals("allowance") ? relabel(r) : r;
        }

        @Override
        public PolicyResult getEligibility(PolicyContext context, JsonNode car, PolicyRead read) {
            PolicyResult r = delegate.getEligibility(context, car, read);
            return mode.equals("eligibility") ? relabel(r) : r;
        }

        /** The evaluator reads first; the terms provider reads second and is the one altered. */
        @Override
        public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
            PolicyResult r = delegate.getPointsCost(context, car, read);
            if (pointsReads.incrementAndGet() < 2) {
                return r;
            }
            if (mode.equals("terms-fail")) {
                return new PolicyResult("invalid", r.policyVersion(), r.body());
            }
            if (mode.equals("terms-points-differ")) {
                ObjectNode body = r.body().deepCopy();
                ObjectNode value = (ObjectNode) body.get("value");
                value.put("monthlyPoints", value.get("monthlyPoints").intValue() + 1);
                return new PolicyResult(r.status(), r.policyVersion(), body);
            }
            return r;
        }
    }
}
