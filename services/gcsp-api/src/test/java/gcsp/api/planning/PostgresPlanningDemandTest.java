package gcsp.api.planning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.IntFunction;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** PostgresPlanningDemand against forecast.js, over scripted rows, clock and evaluator and the real seed catalogue. */
class PostgresPlanningDemandTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String ENV = "planning-demand-env";
    private static final String RUN = PlanningFixtures.RUN;
    private static final String POLICY = PlanningFixtures.POLICY;
    private static final String TOURING = PlanningFixtures.TOURING;
    private static final String SALOON = PlanningFixtures.SALOON;
    private static final String AS_OF = "2026-11-06T00:00:00.000Z";
    private static final String HORIZON = "2027-06-30T00:00:00.000Z";
    private static final String NARROW = "2027-02-04T00:00:00.000Z";
    private static final String RENEWAL_1 = "2027-03-31T23:59:59.999Z";
    private static final String LIMIT_1 = "Saved confirmed briefs only; employees without a saved brief are not inferred.";
    private static final String LIMIT_2 = "Deterministic permitted joint choices are not calibrated acceptance probabilities.";
    private static final String UNAVAILABLE = "unavailable";
    private static final String EVAL_INVALID = "planning-future-choice-evaluation-invalid";
    private static final String CHANGED = "planning-forecast-changed";
    private static final String CRASHED = "planning-expressed-forecast-unavailable";

    private static final String CONTRACT_1 =
            ",'contract':{'manualContext':{'contracts':[{'status':'current','contractEndDate':'2027-03-31'}]}}";
    private static final String CONTRACT_2 =
            ",'contract':{'manualContext':{'contracts':[{'status':'current','contractEndDate':'2027-01-15'}]}}";
    private static final String E1 = "{'employeeId':'e1','entitlementSlotId':'s1','companyId':'c1','schemeId':'sch1'" + CONTRACT_1 + "}";
    private static final String E2 = "{'employeeId':'e2','entitlementSlotId':'s2','renewalId':'r2','companyId':'c2'" + CONTRACT_2 + "}";
    private static final String S1 = "{'entitlementSlotId':'s1','employeeId':'e1','renewalId':'r1'}";
    private static final String S2 = "{'entitlementSlotId':'s2','employeeId':'e2','renewalId':'r2'}";
    private static final String B1 = "{'employeeId':'e1','briefVersion':2,'status':'confirmed','note':'latest'}";
    private static final String B2 = "{'employeeId':'e2','briefVersion':1,'status':'confirmed'}";
    private static final String BRIEFS = "{'employeeId':'e1','briefVersion':1,'status':'confirmed'}," + B1
            + ",{'employeeId':'e2','briefVersion':5,'status':'draft'}," + B2;
    private static final String HOLD_2 = "{'holdId':'h1','orderUuid':'o1','employeeId':'e2','entitlementSlotId':'s2',"
            + "'renewalId':'r2','state':'allocated'}";

    @TempDir
    Path dir;

    private PolicyService policy;
    private JsonNode catalog;

    @BeforeEach
    void setUp() throws Exception {
        policy = new PolicyService(new PolicyFiles(dir, "planning-demand").source(M.createArrayNode()));
        ObjectNode read = new PlanningCatalog(policy).readCatalog(RUN, new PolicyRead(RUN, AS_OF, POLICY));
        assertTrue(Outcomes.isOk(read), read.toString());
        catalog = read.get("value");
    }

    private static JsonNode json(String text) {
        try {
            return M.readTree(text.replace('\'', '"'));
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static ObjectNode rows(String briefs, String employees, String slots, String holds, String stock, String decisions) {
        return (ObjectNode) json("{'briefs':[" + briefs + "],'employees':[" + employees + "],'entitlement_slots':[" + slots
                + "],'holds':[" + holds + "],'stock':[" + stock + "],'decisions':[" + decisions + "],'offers':[{'id':'o1'}]}");
    }

    private static ObjectNode base() {
        return rows(BRIEFS, E1 + "," + E2, S1 + "," + S2, "", "", "{'id':'d1'}");
    }

    private static List<String> keys(JsonNode n) {
        List<String> keys = new ArrayList<>();
        n.fieldNames().forEachRemaining(keys::add);
        return keys;
    }

    private static void assertCode(ObjectNode result, String status, String code) {
        assertEquals(status, result.path("status").textValue(), result.toString());
        assertEquals(code, result.path("code").textValue(), result.toString());
    }

    /** Scripted rows: the load number picks the result; a fixed table is copied afresh on every load. */
    private static final class Loads implements PostgresPlanningDemand.Rows {
        final AtomicInteger count = new AtomicInteger();
        private final IntFunction<ObjectNode> script;

        Loads(IntFunction<ObjectNode> script) {
            this.script = script;
        }

        static Loads of(ObjectNode rows) {
            return new Loads(n -> rows == null ? null : rows.deepCopy());
        }

        @Override
        public ObjectNode load(RunContext context) {
            return script.apply(count.incrementAndGet());
        }
    }

    /** Records every call and answers a valid evaluation; tweak and respond reshape it, tweak for e1 only. */
    private static final class Recorder implements PostgresPlanningDemand.Evaluator {
        final List<Principal> principals = new ArrayList<>();
        final List<JsonNode> inputs = new ArrayList<>();
        Consumer<ObjectNode> tweak = v -> { };
        Function<ObjectNode, ObjectNode> respond = Outcomes::ok;

        @Override
        public ObjectNode evaluate(Principal principal, JsonNode input, PolicyService policy) {
            principals.add(principal);
            inputs.add(input.deepCopy());
            String id = input.get("employee").get("employeeId").textValue();
            ObjectNode v = M.createObjectNode();
            v.set("runId", input.get("read").get("runId"));
            v.set("policyVersion", input.get("read").get("policyVersion"));
            v.set("employeeId", input.get("employee").get("employeeId"));
            v.set("briefVersion", input.get("brief").get("briefVersion"));
            v.set("catalogVersion", input.get("catalog").get("version"));
            v.put("version", "ev-" + id);
            boolean first = "e1".equals(id);
            ArrayNode acceptable = v.putArray("acceptableDerivativeIds").add(TOURING);
            if (first) {
                acceptable.add(SALOON);
                v.putArray("gates").add("b-gate").add("a-gate");
                v.putArray("limitations").add("x").add(LIMIT_1);
                v.putArray("excludedStockIds").add("s-b").add("s-a");
                v.put("requiredBy", "2027-03-01T00:00:00.000Z");
                tweak.accept(v);
            } else {
                v.putArray("gates");
                v.putArray("limitations").add("x").add("y");
            }
            return respond.apply(v);
        }
    }

    private static PlanningClock clock(String... versions) {
        AtomicInteger n = new AtomicInteger();
        return ctx -> new PlanningClock.Observation(Instant.parse(AS_OF), versions[Math.min(n.getAndIncrement(), versions.length - 1)]);
    }

    private static PostgresPlanningDemand demand(PostgresPlanningDemand.Rows rows, PostgresPlanningDemand.Evaluator evaluator) {
        return new PostgresPlanningDemand(rows, clock("v1"), evaluator);
    }

    private static PlanningRead planningRead(String asOf, String horizon) {
        return new PlanningRead(new RunContext(ENV, RUN, "sub-greg"), asOf, POLICY, horizon);
    }

    private ObjectNode read(PostgresPlanningDemand d) {
        return d.readForecast(planningRead(AS_OF, HORIZON), policy);
    }

    private ObjectNode run(ObjectNode rows, Recorder recorder) {
        return read(demand(Loads.of(rows), recorder));
    }

    private void assertInvalid(Consumer<ObjectNode> tweak) {
        Recorder recorder = new Recorder();
        recorder.tweak = tweak;
        ObjectNode result = run(base(), recorder);
        assertCode(result, UNAVAILABLE, EVAL_INVALID);
    }

    @Test
    void happyPathBuildsTheEntitlementsInNodeKeyOrder() {
        Recorder recorder = new Recorder();
        Loads loads = Loads.of(base());
        ObjectNode result = read(demand(loads, recorder));

        assertEquals("ok", result.get("status").textValue(), result.toString());
        assertEquals(2, loads.count.get());
        assertEquals(2, recorder.inputs.size());
        JsonNode value = result.get("value");
        assertEquals(List.of("runId", "asOf", "policyVersion", "version", "cohortVersion", "forecast", "provenance"), keys(value));
        assertEquals(RUN, value.get("runId").textValue());
        assertEquals(AS_OF, value.get("asOf").textValue());
        assertEquals(POLICY, value.get("policyVersion").textValue());
        assertTrue(value.get("version").textValue().matches("[0-9a-f]{64}"));
        assertTrue(value.get("cohortVersion").textValue().matches("[0-9a-f]{64}"));

        JsonNode forecast = value.get("forecast");
        assertEquals(List.of("basis", "horizonEnd", "entitlements", "limitations"), keys(forecast));
        assertEquals("expressed-saved-demand", forecast.get("basis").textValue());
        assertEquals(HORIZON, forecast.get("horizonEnd").textValue());
        JsonNode e1 = forecast.get("entitlements").get(0);
        assertEquals(2, forecast.get("entitlements").size());
        assertEquals(json("{'entitlementId':'s1','employeeId':'e1','renewalId':'r1','entitlementSlotId':'s1','companyId':'c1',"
                + "'schemeId':'sch1','renewalAt':'" + RENEWAL_1 + "','acceptableDerivativeIds':['" + SALOON + "','" + TOURING
                + "'],'gates':['a-gate','b-gate'],'excludedStockIds':['s-a','s-b'],'requiredBy':'2027-03-01T00:00:00.000Z'}"), e1);
        assertEquals(List.of("entitlementId", "employeeId", "renewalId", "entitlementSlotId", "companyId", "schemeId", "renewalAt",
                "acceptableDerivativeIds", "gates", "excludedStockIds", "requiredBy"), keys(e1));
        JsonNode e2 = forecast.get("entitlements").get(1);
        assertEquals(json("{'entitlementId':'s2','employeeId':'e2','renewalId':'r2','entitlementSlotId':'s2','companyId':'c2',"
                + "'renewalAt':'2027-01-15T23:59:59.999Z','acceptableDerivativeIds':['" + TOURING + "'],'gates':[]}"), e2);
        assertEquals(List.of("entitlementId", "employeeId", "renewalId", "entitlementSlotId", "companyId", "renewalAt",
                "acceptableDerivativeIds", "gates"), keys(e2));

        JsonNode provenance = value.get("provenance");
        assertEquals(List.of("source", "catalogVersion", "evaluationVersions", "excluded"), keys(provenance));
        assertEquals("F99-authoritative-saved-briefs-internal-extension", provenance.get("source").textValue());
        assertEquals(catalog.get("version"), provenance.get("catalogVersion"));
        assertTrue(catalog.get("version").textValue().startsWith(POLICY + ":"));
        assertEquals(json("['ev-e1','ev-e2']"), provenance.get("evaluationVersions"));
        assertEquals(json("[]"), provenance.get("excluded"));
    }

    @Test
    void limitationsKeepTheTwoFixedOnesFirstThenDeduplicatedEvaluatorOnes() {
        ObjectNode result = run(base(), new Recorder());
        assertEquals(json("['" + LIMIT_1 + "','" + LIMIT_2 + "','x','y']"), result.get("value").get("forecast").get("limitations"));
    }

    @Test
    void versionsAreStableAcrossCallsAndFollowTheRows() {
        ObjectNode first = run(base(), new Recorder());
        ObjectNode second = run(base(), new Recorder());
        assertEquals(first.get("value").get("version"), second.get("value").get("version"));
        assertEquals(first.get("value").get("cohortVersion"), second.get("value").get("cohortVersion"));

        ObjectNode otherHistory = rows(BRIEFS, E1 + "," + E2, S1 + "," + S2, "", "", "{'id':'d2'}");
        ObjectNode third = run(otherHistory, new Recorder());
        assertNotEquals(first.get("value").get("version"), third.get("value").get("version"));
        assertEquals(first.get("value").get("cohortVersion"), third.get("value").get("cohortVersion"));
    }

    @Test
    void theEvaluatorReceivesTheReadEmployeeBriefCatalogueAndHistory() {
        Recorder recorder = new Recorder();
        ObjectNode rows = base();
        run(rows, recorder);

        JsonNode in = recorder.inputs.get(0);
        assertEquals(List.of("read", "employee", "brief", "catalog", "history"), keys(in));
        assertEquals(json("{'runId':'" + RUN + "','asOf':'" + AS_OF + "','policyVersion':'" + POLICY + "','horizonEnd':'" + HORIZON
                + "'}"), in.get("read"));
        assertEquals(((ObjectNode) json(E1)).put("renewalId", "r1"), in.get("employee"));
        assertEquals(json(B1), in.get("brief"));
        assertEquals(catalog, in.get("catalog"));
        assertEquals(List.of("decisions", "offers", "briefs"), keys(in.get("history")));
        assertEquals(rows.get("decisions"), in.get("history").get("decisions"));
        assertEquals(rows.get("offers"), in.get("history").get("offers"));
        assertEquals(rows.get("briefs"), in.get("history").get("briefs"));
        assertEquals("e2", recorder.inputs.get(1).get("employee").get("employeeId").textValue());
        assertEquals(json(B2), recorder.inputs.get(1).get("brief"));
    }

    @Test
    void theEvaluatorPrincipalIsGregOnTheRunAndPolicy() {
        Recorder recorder = new Recorder();
        run(base(), recorder);
        Principal p = recorder.principals.get(0);
        assertEquals("sub-greg", p.subject());
        assertEquals(List.of("greg"), p.roles());
        assertEquals(ENV, p.environmentId());
        assertEquals(RUN, p.runId());
        assertEquals(POLICY, p.policyVersion());
        assertNull(p.employeeId());
        assertEquals(List.of(), p.capabilities());
    }

    @Test
    void anUnconfiguredPortOrPolicyIsNotConfigured() {
        Recorder recorder = new Recorder();
        Loads loads = Loads.of(base());
        String code = "planning-future-choice-evaluator-not-configured";
        assertCode(read(new PostgresPlanningDemand(null, clock("v1"), recorder)), UNAVAILABLE, code);
        assertCode(read(new PostgresPlanningDemand(loads, null, recorder)), UNAVAILABLE, code);
        assertCode(read(new PostgresPlanningDemand(loads, clock("v1"), null)), UNAVAILABLE, code);
        assertCode(demand(loads, recorder).readForecast(planningRead(AS_OF, HORIZON), null), UNAVAILABLE, code);
        assertEquals(0, loads.count.get());
        assertEquals(0, recorder.inputs.size());
    }

    @Test
    void aBadReadIsReadInvalid() {
        PostgresPlanningDemand d = demand(Loads.of(base()), new Recorder());
        String code = "planning-forecast-read-invalid";
        assertCode(d.readForecast(null, policy), UNAVAILABLE, code);
        assertCode(d.readForecast(new PlanningRead(null, AS_OF, POLICY, HORIZON), policy), UNAVAILABLE, code);
        assertCode(d.readForecast(planningRead("not-a-date", HORIZON), policy), UNAVAILABLE, code);
        assertCode(d.readForecast(planningRead(null, HORIZON), policy), UNAVAILABLE, code);
        assertCode(d.readForecast(planningRead(AS_OF, "2027-13-45T00:00:00.000Z"), policy), UNAVAILABLE, code);
        assertCode(d.readForecast(planningRead(AS_OF, null), policy), UNAVAILABLE, code);
        assertCode(d.readForecast(new PlanningRead(new RunContext(ENV, "", "sub-greg"), AS_OF, POLICY, HORIZON), policy),
                UNAVAILABLE, code);
        assertCode(d.readForecast(new PlanningRead(new RunContext(ENV, RUN, "sub-greg"), AS_OF, "", HORIZON), policy),
                UNAVAILABLE, code);
    }

    @Test
    void anInactiveRunWithNoRowsIsReadInvalid() {
        Recorder recorder = new Recorder();
        assertCode(run(null, recorder), UNAVAILABLE, "planning-forecast-read-invalid");
        assertEquals(0, recorder.inputs.size());
    }

    @Test
    void aClockInstantThatDiffersFromAsOfIsAMismatchBeforeAnyRead() {
        Loads loads = Loads.of(base());
        PlanningClock later = ctx -> new PlanningClock.Observation(Instant.parse("2026-11-07T00:00:00.000Z"), "v1");
        ObjectNode result = read(new PostgresPlanningDemand(loads, later, new Recorder()));
        assertCode(result, UNAVAILABLE, "planning-forecast-clock-mismatch");
        assertEquals(0, loads.count.get());
    }

    @Test
    void cohortFailuresPassThroughAndStopTheLoop() {
        Recorder none = new Recorder();
        ObjectNode noRowForE1 = rows(BRIEFS, E2, S1 + "," + S2, "", "", "");
        assertCode(run(noRowForE1, none), UNAVAILABLE, "planning-forecast-entitlement-missing");
        assertEquals(0, none.inputs.size());

        Recorder one = new Recorder();
        ObjectNode badSlotForE2 = rows(BRIEFS, E1 + "," + E2, S1 + ",{'entitlementSlotId':'s2','employeeId':'e2','renewalId':'rBad'}",
                "", "", "");
        assertCode(run(badSlotForE2, one), UNAVAILABLE, "planning-forecast-entitlement-mismatch");
        assertEquals(1, one.inputs.size());

        ObjectNode noContract = rows(BRIEFS, "{'employeeId':'e1','entitlementSlotId':'s1'}," + E2, S1 + "," + S2, "", "", "");
        assertCode(run(noContract, new Recorder()), UNAVAILABLE, "planning-renewal-unconfirmed");
    }

    @Test
    void outsideHorizonAndAlreadySelectedGoToProvenanceExcludedAndAreNotEvaluated() {
        Recorder narrow = new Recorder();
        ObjectNode r = demand(Loads.of(base()), narrow).readForecast(planningRead(AS_OF, NARROW), policy);
        assertEquals("ok", r.get("status").textValue(), r.toString());
        assertEquals(1, narrow.inputs.size());
        assertEquals("e2", narrow.inputs.get(0).get("employee").get("employeeId").textValue());
        assertEquals(json("[{'employeeId':'e1','reason':'outside-horizon'}]"), r.get("value").get("provenance").get("excluded"));
        assertEquals(1, r.get("value").get("forecast").get("entitlements").size());

        Recorder selected = new Recorder();
        ObjectNode held = rows(BRIEFS, E1 + "," + E2, S1 + "," + S2, HOLD_2, "{'orderUuid':'o1','state':'allocated'}", "");
        ObjectNode s = run(held, selected);
        assertEquals("ok", s.get("status").textValue(), s.toString());
        assertEquals(1, selected.inputs.size());
        assertEquals("e1", selected.inputs.get(0).get("employee").get("employeeId").textValue());
        assertEquals(json("[{'employeeId':'e2','reason':'already-selected'}]"), s.get("value").get("provenance").get("excluded"));

        Recorder all = new Recorder();
        ObjectNode early = demand(Loads.of(base()), all).readForecast(planningRead(AS_OF, "2026-12-01T00:00:00.000Z"), policy);
        assertEquals(0, all.inputs.size());
        assertEquals(json("[]"), early.get("value").get("forecast").get("entitlements"));
        assertEquals(json("['" + LIMIT_1 + "','" + LIMIT_2 + "']"), early.get("value").get("forecast").get("limitations"));
        assertEquals(json("[]"), early.get("value").get("provenance").get("evaluationVersions"));
        assertEquals(json("[{'employeeId':'e1','reason':'outside-horizon'},{'employeeId':'e2','reason':'outside-horizon'}]"),
                early.get("value").get("provenance").get("excluded"));
    }

    @Test
    void aRefusalFromTheEvaluatorIsReturnedAsIs() {
        Recorder forbidden = new Recorder();
        forbidden.respond = v -> Outcomes.forbidden();
        assertEquals(Outcomes.forbidden(), run(base(), forbidden));

        Recorder down = new Recorder();
        down.respond = v -> Outcomes.unavailable("some-evaluator-code");
        assertEquals(Outcomes.unavailable("some-evaluator-code"), run(base(), down));
        assertEquals(1, down.inputs.size());
    }

    @Test
    void aNullOrStatuslessEvaluationIsEvaluationUnavailable() {
        String code = "planning-future-choice-evaluation-unavailable";
        Recorder nothing = new Recorder();
        nothing.respond = v -> null;
        assertCode(run(base(), nothing), UNAVAILABLE, code);

        Recorder empty = new Recorder();
        empty.respond = v -> M.createObjectNode();
        assertCode(run(base(), empty), UNAVAILABLE, code);

        Recorder nullStatus = new Recorder();
        nullStatus.respond = v -> {
            ObjectNode n = M.createObjectNode();
            n.putNull("status");
            n.set("value", v);
            return n;
        };
        assertCode(run(base(), nullStatus), UNAVAILABLE, code);
    }

    @Test
    void aWrongIdentityOrVersionIsEvaluationInvalid() {
        assertInvalid(v -> v.put("employeeId", "other"));
        assertInvalid(v -> v.put("briefVersion", 99));
        assertInvalid(v -> v.put("catalogVersion", "other"));
        assertInvalid(v -> v.remove("briefVersion"));
        assertInvalid(v -> v.put("runId", "other-run"));
        assertInvalid(v -> v.put("policyVersion", "other-policy"));
        assertInvalid(v -> v.remove("version"));
        assertInvalid(v -> v.put("version", ""));
        assertInvalid(v -> v.put("version", 5));
    }

    @Test
    void anOkEvaluationWithNoObjectValueIsEvaluationInvalid() {
        Recorder nullValue = new Recorder();
        nullValue.respond = v -> Outcomes.ok(null);
        assertCode(run(base(), nullValue), UNAVAILABLE, EVAL_INVALID);

        Recorder arrayValue = new Recorder();
        arrayValue.respond = v -> Outcomes.ok(M.createArrayNode());
        assertCode(run(base(), arrayValue), UNAVAILABLE, EVAL_INVALID);
    }

    @Test
    void derivativeAndGateShapesAreChecked() {
        assertInvalid(v -> v.putArray("acceptableDerivativeIds").add("no-such-derivative"));
        assertInvalid(v -> v.putArray("acceptableDerivativeIds").add(TOURING).add(TOURING));
        assertInvalid(v -> v.put("acceptableDerivativeIds", TOURING));
        assertInvalid(v -> v.remove("acceptableDerivativeIds"));
        assertInvalid(v -> v.putArray("gates").add("ok").add(5));
        assertInvalid(v -> v.putArray("gates").add(""));
        assertInvalid(v -> v.put("gates", "a-gate"));
        assertInvalid(v -> v.remove("gates"));
    }

    @Test
    void excludedStockAndRequiredByAreChecked() {
        assertInvalid(v -> v.putArray("excludedStockIds").add("a").add("a"));
        assertInvalid(v -> v.putArray("excludedStockIds").add("a").add(3));
        assertInvalid(v -> v.put("excludedStockIds", "a"));
        assertInvalid(v -> v.putNull("excludedStockIds"));
        assertInvalid(v -> v.put("requiredBy", "2027-04-01T00:00:00.000Z"));
        assertInvalid(v -> v.put("requiredBy", "not-a-date"));
        assertInvalid(v -> v.put("requiredBy", 5));
        assertInvalid(v -> v.putNull("requiredBy"));

        Recorder equal = new Recorder();
        equal.tweak = v -> v.put("requiredBy", RENEWAL_1);
        ObjectNode r = run(base(), equal);
        assertEquals("ok", r.get("status").textValue(), r.toString());
        assertEquals(RENEWAL_1, r.get("value").get("forecast").get("entitlements").get(0).get("requiredBy").textValue());
    }

    @Test
    void limitationsMustBeAnArrayOfText() {
        assertInvalid(v -> v.remove("limitations"));
        assertInvalid(v -> v.put("limitations", "x"));
        assertInvalid(v -> v.putArray("limitations").add("x").add(5));
        assertInvalid(v -> v.putArray("limitations").add(""));
    }

    @Test
    void aSecondRowsReadThatDiffersIsAConflict() {
        Loads changed = new Loads(n -> n == 1 ? base() : rows(BRIEFS, E1 + "," + E2, S1 + "," + S2, "", "", "{'id':'d2'}"));
        assertCode(read(demand(changed, new Recorder())), "conflict", CHANGED);
        assertEquals(2, changed.count.get());

        Loads vanished = new Loads(n -> n == 1 ? base() : null);
        assertCode(read(demand(vanished, new Recorder())), "conflict", CHANGED);
    }

    @Test
    void aClockVersionChangeBetweenObservationsIsAConflict() {
        Loads loads = Loads.of(base());
        ObjectNode result = read(new PostgresPlanningDemand(loads, clock("v1", "v2"), new Recorder()));
        assertCode(result, "conflict", CHANGED);
    }

    @Test
    void aClockInstantThatMovesBetweenObservationsIsAConflictEvenWithTheSameVersion() {
        AtomicInteger n = new AtomicInteger();
        PlanningClock moving = ctx -> new PlanningClock.Observation(
                Instant.parse(AS_OF).plusMillis(n.getAndIncrement() == 0 ? 0 : 1), "v1");
        assertCode(read(new PostgresPlanningDemand(Loads.of(base()), moving, new Recorder())), "conflict", CHANGED);
    }

    @Test
    void exceptionsBecomeExpressedForecastUnavailable() {
        PostgresPlanningDemand.Rows sql = ctx -> {
            throw new SQLException("boom");
        };
        assertCode(read(demand(sql, new Recorder())), UNAVAILABLE, CRASHED);

        PostgresPlanningDemand.Rows runtime = ctx -> {
            throw new IllegalStateException("boom");
        };
        assertCode(read(demand(runtime, new Recorder())), UNAVAILABLE, CRASHED);

        AtomicInteger n = new AtomicInteger();
        PostgresPlanningDemand.Rows secondFails = ctx -> {
            if (n.incrementAndGet() > 1) {
                throw new SQLException("boom");
            }
            return base();
        };
        assertCode(read(demand(secondFails, new Recorder())), UNAVAILABLE, CRASHED);

        PostgresPlanningDemand.Evaluator throwing = (principal, input, p) -> {
            throw new IllegalStateException("boom");
        };
        assertCode(read(demand(Loads.of(base()), throwing)), UNAVAILABLE, CRASHED);

        PlanningClock brokenClock = ctx -> {
            throw new IllegalStateException("no clock");
        };
        assertCode(read(new PostgresPlanningDemand(Loads.of(base()), brokenClock, new Recorder())), UNAVAILABLE, CRASHED);

        ObjectNode malformed = (ObjectNode) json("{'briefs':{}}");
        assertCode(run(malformed, new Recorder()), UNAVAILABLE, CRASHED);
    }
}
