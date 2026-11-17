package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.nio.file.Path;
import java.util.List;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The Node createPolicyFutureTermsProvider port over the real PolicyService and the retained seed policy. Authored, unrun. */
class PolicyFutureTermsTest {

    private static final String RUN = PlanningFixtures.RUN;
    private static final String POLICY = PlanningFixtures.POLICY;
    private static final String AS_OF = "2026-11-06T00:00:00.000Z";
    private static final String HORIZON = "2027-02-04T00:00:00.000Z";
    private static final RunContext CONTEXT = new RunContext("env-1", RUN, "sub-greg");

    @TempDir
    Path dir;

    private PolicyService policy;
    private PolicyFutureTerms terms;

    @BeforeEach
    void policy() throws Exception {
        policy = new PolicyService(new PolicyFiles(dir, "future-terms").source(PlanningFixtures.M.createArrayNode()));
        terms = new PolicyFutureTerms(policy);
    }

    private static PlanningRead read() {
        return new PlanningRead(CONTEXT, AS_OF, POLICY, HORIZON);
    }

    private static PlanningRead read(String asOf, String policyVersion, String horizonEnd) {
        return new PlanningRead(CONTEXT, asOf, policyVersion, horizonEnd);
    }

    private static ObjectNode request() {
        return (ObjectNode) PlanningFixtures.json("""
                {"employee": {"employeeId": "emp-1", "renewalId": "ren-1", "companyId": "demo-bmw-fs-uk",
                    "schemeId": "choices-fs-uk", "gradeId": "G1-6", "entitlementSlotId": "slot-1"},
                 "brief": {"briefVersion": "brief-v3"},
                 "catalogVersion": "cat-v1",
                 "configuration": {"configurationId": "cfg-hatch",
                    "facts": {"eligibilityModelKey": {"status": "known", "value": "F70 Sports Hatch|120"},
                              "seats": {"status": "known", "value": 5},
                              "boot": {"status": "unknown", "value": null}}}}
                """);
    }

    private static ObjectNode with(UnaryOperator<ObjectNode> edit) {
        return edit.apply(request());
    }

    private static ObjectNode employee(ObjectNode request) {
        return (ObjectNode) request.get("employee");
    }

    private static ObjectNode configuration(ObjectNode request) {
        return (ObjectNode) request.get("configuration");
    }

    private static void assertUnavailable(String code, JsonNode outcome) {
        assertEquals("unavailable", outcome.get("status").textValue(), outcome.toString());
        assertEquals(code, outcome.get("code").textValue());
        assertEquals("1.0.0", outcome.get("contractVersion").textValue());
        assertFalse(outcome.has("value"));
    }

    @Test
    void quotesMonthlyPointsAndAllowanceAsEmployeeSchemeTerms() {
        ObjectNode outcome = terms.readFutureTerms(CONTEXT, read(), request());
        JsonNode expected = PlanningFixtures.json("""
                {"status": "ok", "value": {"runId": "run-1", "asOf": "2026-11-06T00:00:00.000Z",
                  "policyVersion": "gcsp-policy-v1", "employeeId": "emp-1", "renewalId": "ren-1",
                  "briefVersion": "brief-v3", "catalogVersion": "cat-v1", "configurationId": "cfg-hatch",
                  "version": "future-terms:gcsp-policy-v1:cfg-hatch",
                  "terms": {"termsVersion": "future-terms:gcsp-policy-v1:cfg-hatch",
                    "points": {"value": 800, "unit": "points"},
                    "allowanceInputs": {"allowance": {"value": 1000, "unit": "points"}},
                    "contribution": null,
                    "validFrom": "2026-11-06T00:00:00.000Z", "validUntil": "2027-02-04T00:00:00.000Z",
                    "provenance": {"sourceRef": "policy:choices-fs-uk-synthetic-monthly-v1", "version": "gcsp-policy-v1",
                      "observedAt": "2026-11-06T00:00:00.000Z", "assurance": "synthetic-scenario"},
                    "kind": "employee-scheme"}}}
                """);
        assertEquals(expected, outcome);
        assertEquals(List.of("runId", "asOf", "policyVersion", "employeeId", "renewalId", "briefVersion", "catalogVersion",
                "configurationId", "version", "terms"), fieldNames(outcome.get("value")));
        assertEquals(List.of("termsVersion", "points", "allowanceInputs", "contribution", "validFrom", "validUntil",
                "provenance", "kind"), fieldNames(outcome.get("value").get("terms")));
    }

    @Test
    void gradeAndConfigurationSelectTheirOwnPolicyRows() {
        ObjectNode other = with(r -> {
            employee(r).put("gradeId", "G7");
            ((ObjectNode) configuration(r).get("facts")).set("eligibilityModelKey",
                    PlanningFixtures.json("{\"status\": \"known\", \"value\": \"G20 Saloon|320i\"}"));
            return r;
        });
        JsonNode value = terms.readFutureTerms(CONTEXT, read(), other).get("value");
        assertEquals(1100, value.get("terms").get("points").get("value").intValue());
        assertEquals(1300, value.get("terms").get("allowanceInputs").get("allowance").get("value").intValue());
    }

    @Test
    void lineageFollowsTheRequestAndOmitsAbsentIdentifiers() {
        ObjectNode sparse = with(r -> {
            employee(r).remove("renewalId");
            ((ObjectNode) r.get("brief")).remove("briefVersion");
            return r;
        });
        JsonNode value = terms.readFutureTerms(CONTEXT, read(), sparse).get("value");
        assertFalse(value.has("renewalId"));
        assertFalse(value.has("briefVersion"));
        assertEquals("emp-1", value.get("employeeId").textValue());
        assertEquals("cat-v1", value.get("catalogVersion").textValue());
        assertEquals(AS_OF, value.get("terms").get("provenance").get("observedAt").textValue());
        assertEquals(HORIZON, value.get("terms").get("validUntil").textValue());
    }

    @Test
    void requestIsNotMutated() {
        ObjectNode input = request();
        ObjectNode before = input.deepCopy();
        terms.readFutureTerms(CONTEXT, read(), input);
        assertEquals(before, input);
    }

    @Test
    void missingPolicyServiceIsNotConfigured() {
        assertUnavailable("planning-future-terms-not-configured",
                new PolicyFutureTerms(null).readFutureTerms(CONTEXT, read(), request()));
    }

    @Test
    void runMismatchAndMissingReadAreInputInvalid() {
        PlanningRead other = new PlanningRead(new RunContext("env-1", "run-2", "sub-greg"), AS_OF, POLICY, HORIZON);
        assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(CONTEXT, other, request()));
        assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(null, read(), request()));
        assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(CONTEXT, null, request()));
        assertUnavailable("planning-future-terms-input-invalid",
                terms.readFutureTerms(CONTEXT, new PlanningRead(null, AS_OF, POLICY, HORIZON), request()));
    }

    @Test
    void malformedReadFieldsAreInputInvalid() {
        for (PlanningRead bad : List.of(read(AS_OF, null, HORIZON), read(AS_OF, "", HORIZON),
                read(AS_OF, "x".repeat(513), HORIZON), read(null, POLICY, HORIZON), read("2026-11-06", POLICY, HORIZON),
                read("2026-02-30T00:00:00.000Z", POLICY, HORIZON), read("2026-11-06T24:00:00.000Z", POLICY, HORIZON),
                read(AS_OF, POLICY, null), read(AS_OF, POLICY, "2027-02-04"), read(AS_OF, POLICY, "not-a-date"))) {
            assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(CONTEXT, bad, request()));
        }
    }

    @Test
    void missingOrEmptyRequestPartsAreInputInvalid() {
        assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(CONTEXT, read(), null));
        assertUnavailable("planning-future-terms-input-invalid",
                terms.readFutureTerms(CONTEXT, read(), PlanningFixtures.M.createObjectNode()));
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                r -> { r.remove("employee"); return r; },
                r -> { r.putNull("employee"); return r; },
                r -> { r.remove("brief"); return r; },
                r -> { r.put("brief", ""); return r; },
                r -> { r.remove("catalogVersion"); return r; },
                r -> { r.put("catalogVersion", ""); return r; },
                r -> { r.put("catalogVersion", 7); return r; },
                r -> { r.remove("configuration"); return r; },
                r -> { configuration(r).remove("configurationId"); return r; },
                r -> { configuration(r).put("configurationId", ""); return r; },
                r -> { configuration(r).put("configurationId", "c".repeat(513)); return r; },
                r -> { configuration(r).remove("facts"); return r; },
                r -> { configuration(r).putNull("facts"); return r; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-terms-input-invalid", terms.readFutureTerms(CONTEXT, read(), with(breaker)));
        }
    }

    @Test
    void wrongOrStalePolicyVersionFailsClosed() {
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read(AS_OF, "gcsp-policy-v0", HORIZON), request()));
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read(AS_OF, "gcsp-policy-v2", HORIZON), request()));
    }

    @Test
    void policyAnswerForAnotherVersionIsRefused() throws Exception {
        PolicyFutureTerms stale = new PolicyFutureTerms(new StalePolicy(policy, "points"));
        assertUnavailable("planning-future-terms-unavailable", stale.readFutureTerms(CONTEXT, read(), request()));
        PolicyFutureTerms staleAllowance = new PolicyFutureTerms(new StalePolicy(policy, "allowance"));
        assertUnavailable("planning-future-terms-unavailable", staleAllowance.readFutureTerms(CONTEXT, read(), request()));
    }

    @Test
    void unknownEmployeeContextFailsClosed() {
        List<UnaryOperator<ObjectNode>> breakers = List.of(
                r -> { employee(r).put("schemeId", "no-such-scheme"); return r; },
                r -> { employee(r).put("companyId", "demo-bmw-rr-production"); return r; },
                r -> { employee(r).put("gradeId", "G99"); return r; },
                r -> { employee(r).remove("schemeId"); return r; },
                r -> { employee(r).remove("companyId"); return r; },
                r -> { employee(r).remove("gradeId"); return r; },
                r -> { employee(r).put("gradeId", 3); return r; });
        for (UnaryOperator<ObjectNode> breaker : breakers) {
            assertUnavailable("planning-future-terms-unavailable", terms.readFutureTerms(CONTEXT, read(), with(breaker)));
        }
    }

    @Test
    void onlyKnownConfigurationFactsReachThePriceLookup() {
        ObjectNode unknownKey = with(r -> {
            ((ObjectNode) configuration(r).get("facts")).set("eligibilityModelKey",
                    PlanningFixtures.json("{\"status\": \"unknown\", \"value\": \"F70 Sports Hatch|120\"}"));
            return r;
        });
        assertUnavailable("planning-future-terms-unavailable", terms.readFutureTerms(CONTEXT, read(), unknownKey));
        ObjectNode noFacts = with(r -> { configuration(r).set("facts", PlanningFixtures.M.createObjectNode()); return r; });
        assertUnavailable("planning-future-terms-unavailable", terms.readFutureTerms(CONTEXT, read(), noFacts));
        ObjectNode unmatched = with(r -> {
            ((ObjectNode) configuration(r).get("facts")).set("eligibilityModelKey",
                    PlanningFixtures.json("{\"status\": \"known\", \"value\": \"No Such Model|000\"}"));
            return r;
        });
        assertUnavailable("planning-future-terms-unavailable", terms.readFutureTerms(CONTEXT, read(), unmatched));
    }

    @Test
    void aNullFactFailsClosedLikeNodeThrowing() {
        ObjectNode nullFact = with(r -> {
            ((ObjectNode) configuration(r).get("facts")).putNull("seats");
            return r;
        });
        assertUnavailable("planning-future-terms-unavailable", terms.readFutureTerms(CONTEXT, read(), nullFact));
    }

    @Test
    void termsValidityMustBeStrictAndForward() {
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read(AS_OF, POLICY, AS_OF), request()));
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read(AS_OF, POLICY, "2026-11-05T00:00:00.000Z"), request()));
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read("2026-11-06T01:00:00+01:00", POLICY, HORIZON), request()));
        assertUnavailable("planning-future-terms-unavailable",
                terms.readFutureTerms(CONTEXT, read(AS_OF, POLICY, "2027-02-04T00:00:00+00:00"), request()));
    }

    @Test
    void secondsPrecisionInstantsPassThroughUnchanged() {
        JsonNode value = terms.readFutureTerms(CONTEXT, read("2026-11-06T00:00:00Z", POLICY, "2027-02-04T00:00:00Z"),
                request()).get("value");
        assertEquals("2026-11-06T00:00:00Z", value.get("asOf").textValue());
        assertEquals("2027-02-04T00:00:00Z", value.get("terms").get("validUntil").textValue());
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new java.util.ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    /** A real service that answers one read under a different policy version, to prove the pin check. */
    private static final class StalePolicy extends PolicyService {

        private final PolicyService delegate;
        private final String which;

        StalePolicy(PolicyService delegate, String which) {
            super(null);
            this.delegate = delegate;
            this.which = which;
        }

        private static PolicyResult relabel(PolicyResult r) {
            ObjectNode body = r.body().deepCopy();
            body.put("policyVersion", "gcsp-policy-v0");
            return new PolicyResult(r.status(), "gcsp-policy-v0", body);
        }

        @Override
        public PolicyResult getPointsCost(PolicyContext context, JsonNode car, PolicyRead read) {
            PolicyResult r = delegate.getPointsCost(context, car, read);
            assertTrue(r.ok());
            return which.equals("points") ? relabel(r) : r;
        }

        @Override
        public PolicyResult getAllowance(PolicyContext context, PolicyRead read) {
            PolicyResult r = delegate.getAllowance(context, read);
            assertTrue(r.ok());
            return which.equals("allowance") ? relabel(r) : r;
        }
    }
}
