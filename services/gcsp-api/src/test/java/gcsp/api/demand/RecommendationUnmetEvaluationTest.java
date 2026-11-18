package gcsp.api.demand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.EligibleCandidates;
import gcsp.api.allocation.EligibleCandidates.Decision;
import gcsp.api.allocation.EligibleCandidates.Evaluated;
import gcsp.api.allocation.EligibleCandidates.Request;
import gcsp.api.allocation.EligibleCandidates.Result;
import gcsp.api.demand.UnmetEvaluationPort.BriefCandidate;
import gcsp.api.demand.UnmetEvaluationPort.CarCandidate;
import gcsp.api.demand.UnmetEvaluationPort.CarDecision;
import gcsp.api.demand.UnmetEvaluationPort.Evaluation;
import gcsp.api.demand.UnmetEvaluationPort.Gate;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/** The unmet evaluation over native PostgreSQL rows and a scripted candidates engine. */
class RecommendationUnmetEvaluationTest {

    private static final class Engine implements EligibleCandidates {
        final List<Request> requests = new ArrayList<>();
        Function<Request, Result> script;

        @Override
        public Result evaluate(Request request) {
            requests.add(request);
            return script.apply(request);
        }
    }

    private static Decision decision(String uuid, String gate, String blockers, String unknowns) {
        return new Decision(uuid, gate, 50.0, DemandFixture.M.createArrayNode(), DemandFixture.M.valueToTree(read(blockers)),
                DemandFixture.M.valueToTree(read(unknowns)), DemandFixture.M.createObjectNode(), DemandFixture.M.createObjectNode());
    }

    private static JsonNode read(String json) {
        try {
            return DemandFixture.M.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private static Result evaluated(Request r, String gate) {
        return new Evaluated(DemandFixture.M.createObjectNode(), r.cars().stream().map(c -> decision(c.orderUuid(), gate, "[]", "[]")).toList());
    }

    private static RecommendationUnmetEvaluation adapter(DemandFixture f, Engine engine) throws Exception {
        RecommendationUnmetEvaluation a = new RecommendationUnmetEvaluation();
        a.candidates = engine;
        var ds = f.pool();
        a.source = () -> ds;
        return a;
    }

    private static void seed(DemandFixture f) throws Exception {
        f.employee("emp-1");
        f.setEmployee("emp-1", "{\"companyId\":\"co-1\",\"schemeId\":\"sch-1\",\"entitlementSlotId\":\"slot-emp-1\",\"k\":1}", 4);
        f.update("INSERT INTO employee_account_records (environment_id, run_id, employee_id, record_set_id, record) "
                + "VALUES (?, ?, 'emp-1', 'set', ?)", DemandFixture.ENV, DemandFixture.RUN, DemandFixture.json("{\"contracts\":[]}"));
        f.stock("car-a", "released", "{\"facts\":{\"x\":1}}");
        f.stock("car-b", "released", "{\"facts\":{\"x\":2}}");
        f.update("UPDATE stock_cars SET version = 3 WHERE environment_id = ? AND run_id = ? AND order_uuid = 'car-b'",
                DemandFixture.ENV, DemandFixture.RUN);
    }

    private static BriefCandidate brief(String... availability) {
        List<CarCandidate> cars = new ArrayList<>();
        for (int i = 0; i < availability.length; i++) cars.add(new CarCandidate(i == 0 ? "car-a" : "car-b", availability[i]));
        return new BriefCandidate("emp-1", 6, DemandFixture.brief("estate", null, null, null), "co-1", "sch-1", cars);
    }

    @Test
    void requestCarriesStoredVersionsSlotAttributesAndClockVersion() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seed(f);
            Engine e = new Engine();
            e.script = r -> evaluated(r, "eligible");
            Evaluation out = adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 9);
            assertEquals(1, e.requests.size());
            EligibleCandidates.Request r = e.requests.get(0);
            assertEquals(DemandFixture.NOW, r.asOf());
            assertEquals(9, r.clockVersion());
            assertEquals(DemandFixture.POLICY, r.policyVersion());
            assertEquals("slot-emp-1", r.subject().slotId());
            assertEquals(4, r.subject().employeeVersion());
            assertEquals(1, r.subject().employeeAttributes().get("k").asInt());
            assertEquals(0, r.subject().accountRecord().get("contracts").size());
            assertEquals(6, r.subject().briefVersion());
            assertEquals(2, r.cars().size());
            assertEquals(3, r.cars().stream().filter(c -> c.orderUuid().equals("car-b")).findFirst().orElseThrow().version());
            assertEquals(2, r.cars().stream().filter(c -> c.orderUuid().equals("car-b")).findFirst().orElseThrow().attributes().path("facts").path("x").asInt());
            assertTrue(out instanceof Evaluation.Ok);
            List<CarDecision> ds = ((Evaluation.Ok) out).byEmployee().get("emp-1");
            assertEquals(List.of("car-a", "car-b"), ds.stream().map(CarDecision::orderUuid).toList());
            assertEquals("eligible", ds.get(0).gateStatus());
        }
    }

    @Test
    void missingAccountRecordIsJsonNullAndGatesMapWithFields() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seed(f);
            f.update("DELETE FROM employee_account_records WHERE environment_id = ? AND run_id = ?", DemandFixture.ENV, DemandFixture.RUN);
            Engine e = new Engine();
            e.script = r -> new EligibleCandidates.Evaluated(DemandFixture.M.createObjectNode(), List.of(
                    decision("car-a", "ineligible", "[{\"code\":\"seats\",\"field\":\"seats\"}]", "[{\"code\":\"charging\"}]"),
                    decision("car-b", "eligible", "[]", "[]")));
            Evaluation out = adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 2);
            assertTrue(e.requests.get(0).subject().accountRecord().isNull());
            CarDecision a = ((Evaluation.Ok) out).byEmployee().get("emp-1").get(0);
            assertEquals(List.of(new Gate("seats", "seats")), a.blockers());
            assertEquals(List.of(new Gate("charging", null)), a.unknowns());
        }
    }

    @Test
    void unavailableCarBecomesIneligibleWithNotAvailableBlocker() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seed(f);
            Engine e = new Engine();
            e.script = r -> new EligibleCandidates.Evaluated(DemandFixture.M.createObjectNode(), List.of(
                    decision("car-a", "eligible", "[]", "[]"),
                    decision("car-b", "needs-confirmation", "[{\"code\":\"price\"}]", "[{\"code\":\"charging\"}]")));
            Evaluation out = adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "unavailable")), DemandFixture.NOW, 2);
            List<CarDecision> ds = ((Evaluation.Ok) out).byEmployee().get("emp-1");
            assertEquals("eligible", ds.get(0).gateStatus());
            assertEquals("ineligible", ds.get(1).gateStatus());
            assertEquals(List.of(new Gate("price", null), new Gate("not-available", null)), ds.get(1).blockers());
            assertEquals(List.of(new Gate("charging", null)), ds.get(1).unknowns());
        }
    }

    @Test
    void unavailableEngineGivesUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seed(f);
            Engine e = new Engine();
            e.script = r -> new EligibleCandidates.Unavailable("candidates-unavailable");
            assertSame(Evaluation.UNAVAILABLE, adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 2));
            e.script = r -> {
                throw new IllegalStateException("boom");
            };
            assertSame(Evaluation.UNAVAILABLE, adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 2));
        }
    }

    @Test
    void missingCarDecisionOrRowGivesUnavailable() throws Exception {
        try (DemandFixture f = DemandFixture.create()) {
            seed(f);
            Engine e = new Engine();
            e.script = r -> new EligibleCandidates.Evaluated(DemandFixture.M.createObjectNode(), List.of(decision("car-a", "eligible", "[]", "[]")));
            assertSame(Evaluation.UNAVAILABLE, adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 2));
            e.script = r -> evaluated(r, "eligible");
            f.update("DELETE FROM stock_cars WHERE environment_id = ? AND run_id = ? AND order_uuid = 'car-b'", DemandFixture.ENV, DemandFixture.RUN);
            assertSame(Evaluation.UNAVAILABLE, adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available", "available")), DemandFixture.NOW, 2));
            assertSame(Evaluation.UNAVAILABLE, adapter(f, e).evaluate(DemandFixture.SCOPE, List.of(brief("available")), DemandFixture.NOW, 0));
        }
    }
}
