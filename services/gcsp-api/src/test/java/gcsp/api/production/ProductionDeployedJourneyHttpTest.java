package gcsp.api.production;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningRead;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.planning.PostgresPlanningDemand;
import gcsp.api.planning.PostgresPlanningSupply;
import gcsp.api.planning.RunPlanningClock;
import gcsp.api.planning.SubmissionHistory;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyService;
import gcsp.api.supply.SupplyRelease;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jose4j.jwk.JsonWebKey;
import org.jose4j.jwk.RsaJsonWebKey;
import org.jose4j.jws.AlgorithmIdentifiers;
import org.jose4j.jws.JsonWebSignature;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.postgresql.ds.PGSimpleDataSource;

/**
 * FUCQ-478 acceptance on the started app: real RS256 tokens from the loopback JWKS, native PostgreSQL in a private schema,
 * the real planner inputs bound by FUCQ-477 and no test alternative bean. Plan inputs come only from the real brief,
 * tick and clock routes. Released stock covers Paula and Alex (FUCQ-530); Sam's plug-in need is the real plan's order (FUCQ-528).
 */
@QuarkusTest
@TestProfile(ProductionDeployedJourneyProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ProductionDeployedJourneyHttpTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String PLAN = API + "/greg/order-plan";
    private static final String PLAN_REQUESTS = API + "/greg/production/requests";
    private static final String ORDERS = API + "/greg/orders";
    private static final String STEP = API + "/presenter/production";
    private static final String ENV = "account-dev-env";
    private static final String RUN = "run-1";
    private static final String POLICY = "gcsp-policy-v1";
    private static final String SALOON_330E = "g20-saloon-330e";

    private static String ownedSchema;
    private static JsonNode firstPlan;
    private static JsonNode plan2;
    private static String touringId;
    private static String saloonId;
    private static String hatchId;
    private static String lostId;
    private static String lostBody;
    private static long ordersBefore;
    private static JsonNode samPlan;
    private static String samSubmission;
    private static String samRequest;
    private static String changesRequest;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    PlanningDemand demand;

    @Inject
    PlanningSupply supply;

    @Inject
    PlanningClock planningClock;

    @Inject
    PlanSnapshotPort plans;

    @Inject
    SubmissionHistory history;

    @Inject
    PolicyService policy;

    @Inject
    ProductionServiceHolder holder;

    @Inject
    ProductionStartup startup;

    @Inject
    SupplyRelease supplyRelease;

    private String greg;
    private String presenter;

    @BeforeEach
    void tokens() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        greg = token("sub-greg", "greg");
        presenter = token("sub-presenter", "presenter");
    }

    @AfterAll
    static void dropSchema() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_proddep_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(ProductionDeployedJourneyProfile.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- 0: the composition ----

    @Test
    @Order(0)
    void theStartedAppUsesTheRealBindingsAndNoTestAlternative() {
        assertTrue(new ProductionDeployedJourneyProfile().getEnabledAlternatives().isEmpty());
        assertInstanceOf(PostgresPlanningDemand.class, ClientProxy.unwrap(demand));
        assertInstanceOf(PostgresPlanningSupply.class, ClientProxy.unwrap(supply));
        assertInstanceOf(RunPlanningClock.class, ClientProxy.unwrap(planningClock));
        assertInstanceOf(PlanningPlanSnapshot.class, ClientProxy.unwrap(plans));
        assertInstanceOf(ProductionSubmissionHistory.class, ClientProxy.unwrap(history));
        assertInstanceOf(SyntheticProductionProvider.class, holder.provider());
    }

    // ---- 1: AC1, the plan-based submit over real inputs ----

    @Test
    @Order(1)
    void aRealPlanOrdersNothingSoThePlanSubmitIsRefusedAndWritesNothing() throws Exception {
        JsonNode clock = get(presenter, API + "/presenter/clock").body().get("value");
        Resp tick = post(presenter, API + "/presenter/controls/tick", "{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.get("clockVersion") + ",\"mode\":\"next-release\"}");
        assertEquals(200, tick.status(), tick.toString());
        confirmBrief("sub-paula");

        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        firstPlan = read.body().at("/value/plan").deepCopy();
        assertEquals("feasible", firstPlan.get("status").asText());
        assertEquals(0, firstPlan.get("orderQuantity").asInt());
        assertEquals("no-submission", read.body().at("/value/replan/status").asText());
        // Paula's driver is derived from her employee driver (FUCQ-530), so a released car covers her and nothing is ordered.
        assertEquals(0, firstPlan.get("unmetNeeds").size(), firstPlan.get("unmetNeeds").toString());
        assertEquals("slot-paula", firstPlan.at("/allocations/0/entitlementId").asText());
        assertTrue(firstPlan.at("/allocations/0/sourceId").asText().startsWith("stock:"), firstPlan.get("allocations").toString());
        assertNoWrites();

        Resp employee = post(token("sub-paula", "employee"), PLAN_REQUESTS, planBody(cmd(), firstPlan));
        assertEquals(403, employee.status(), employee.toString());
        assertNoWrites();

        Resp empty = post(greg, PLAN_REQUESTS, planBody(cmd(), firstPlan));
        assertEquals(400, empty.status(), empty.toString());
        assertEquals("invalid", empty.body().get("status").asText());
        assertEquals("plan-has-no-order", empty.body().get("code").asText());
        assertNoWrites();
    }

    @Test
    @Order(2)
    void aChangedInputMakesTheEarlierPlanStaleAndWritesNothing() throws Exception {
        confirmBrief("sub-alex");
        Resp stale = post(greg, PLAN_REQUESTS, planBody(cmd(), firstPlan));
        assertEquals(409, stale.status(), stale.toString());
        assertEquals("replan-needed", stale.body().get("code").asText());
        assertTrue(contains(stale.body().get("changedInputs"), "plan"), stale.body().toString());
        assertNotEquals(firstPlan.get("planId"), stale.body().at("/current/planId"));
        assertNoWrites();
    }

    // ---- 2: AC1, one supported request through Greg's manual path ----

    @Test
    @Order(3)
    void aWrongVersionIsRefusedAndAValidRequestIsDurableAndPending() throws Exception {
        JsonNode versions = get(greg, ORDERS).body().at("/value/versions");
        String stock = versions.get("stock").asText();
        assertEquals(POLICY, versions.get("policy").asText());

        Resp wrongStock = post(greg, ORDERS, manual(cmd(), "3 Series Touring", "320i", 2, POLICY, "stale-stock"));
        assertEquals(409, wrongStock.status(), wrongStock.toString());
        assertEquals("stale-version", wrongStock.body().get("code").asText());
        assertEquals("stock", wrongStock.body().get("resource").asText());
        Resp wrongPolicy = post(greg, ORDERS, manual(cmd(), "3 Series Touring", "320i", 2, "old-policy", stock));
        assertEquals(409, wrongPolicy.status(), wrongPolicy.toString());
        assertEquals("policy", wrongPolicy.body().get("resource").asText());
        assertNoWrites();

        String touringCmd = "cmd-proddep-touring";
        Resp touring = post(greg, ORDERS, manual(touringCmd, "3 Series Touring", "320i", 2, POLICY, stock));
        assertEquals(200, touring.status(), touring.toString());
        JsonNode line = touring.body().at("/value/requests/0");
        touringId = line.get("requestId").asText();
        assertEquals("requested", line.get("state").asText());
        assertEquals("synthetic-production:" + touringId, line.get("providerReference").asText());
        assertEquals("requested", text("SELECT state FROM production_requests WHERE request_id = ?", touringId));
        assertEquals(2, count("SELECT quantity FROM production_requests WHERE request_id = ?", touringId));
        assertEquals("3 Series Touring", text("SELECT model FROM production_requests WHERE request_id = ?", touringId));
        assertEquals("320i", text("SELECT derivative FROM production_requests WHERE request_id = ?", touringId));
        assertEquals("synthetic-production:" + touringId, text("SELECT provider_reference FROM production_requests WHERE request_id = ?", touringId));
        assertEquals(1, count("SELECT count(*) FROM production_synthetic_orders WHERE operation_id = ?", touringId));

        Resp saloon = post(greg, ORDERS, manual(cmd(), "3 Series Saloon", "330e", 1, POLICY, currentStock()));
        assertEquals(200, saloon.status(), saloon.toString());
        saloonId = saloon.body().at("/value/requests/0/requestId").asText();
        assertEquals("refused", saloon.body().at("/value/requests/0/state").asText(), "330e is not a supported choice");
        assertEquals("refused", text("SELECT state FROM production_requests WHERE request_id = ?", saloonId));

        Resp hatch = post(greg, ORDERS, manual(cmd(), "1 Series Sports Hatch", "120", 1, POLICY, currentStock()));
        assertEquals(200, hatch.status(), hatch.toString());
        hatchId = hatch.body().at("/value/requests/0/requestId").asText();
        assertEquals("requested", hatch.body().at("/value/requests/0/state").asText());
        Resp refuse = post(presenter, STEP, "{\"commandId\":\"" + cmd() + "\",\"requestId\":\"" + hatchId + "\",\"expectedVersion\":"
                + request(hatchId).get("version") + ",\"action\":\"refuse\",\"reason\":\"No capacity\"}");
        assertEquals(200, refuse.status(), refuse.toString());
        assertEquals("refused", request(hatchId).get("state").asText());
        assertEquals("production-refused", request(hatchId).get("code").asText());
    }

    // ---- 3: AC2, retry ----

    @Test
    @Order(4)
    void theSameCommandReplaysWithoutASecondProviderOrder() throws Exception {
        long orders = count("SELECT count(*) FROM production_synthetic_orders");
        long requests = count("SELECT count(*) FROM production_requests");
        Resp again = post(greg, ORDERS, manual("cmd-proddep-touring", "3 Series Touring", "320i", 2, POLICY, currentStock()));
        assertEquals(200, again.status(), again.toString());
        assertTrue(again.body().at("/value/replayed").asBoolean(), again.toString());
        assertEquals(touringId, again.body().at("/value/requests/0/requestId").asText());
        assertEquals(orders, count("SELECT count(*) FROM production_synthetic_orders"));
        assertEquals(requests, count("SELECT count(*) FROM production_requests"));
    }

    // ---- 4: AC2, a lost answer and a restart ----

    @Test
    @Order(5)
    void aLostProviderAnswerLeavesOneOrderAndStartupReconcileSettlesItWithoutSubmitting() throws Exception {
        // The wrapper only loses the first answer of the real provider; the order itself is recorded by the real provider.
        ProductionFixture.Wrapper wrapper = new ProductionFixture.Wrapper(holder.provider(),
                ProductionFixture.Wrapper.Mode.LOSE_RESPONSE, 1);
        ProductionService lossy = new ProductionService(dataSource.get(), wrapper, plans, holder.clock(),
                new StockReleaseSupplyQueue(supplyRelease.release()));
        RunContext scope = new RunContext(ENV, RUN, "sub-greg");
        Principal principal = new Principal("sub-greg", List.of("greg"), ENV, RUN, null, POLICY, List.of());
        String commandId = "cmd-proddep-lost";
        ProductionResult result = lossy.submitManual(scope, principal, new ProductionService.ManualInput(commandId, "i5 Touring",
                "eDrive40", 1, POLICY, currentStock(), null));
        assertInstanceOf(ProductionResult.Pending.class, result);
        lostId = ProductionFixture.value(result).at("/requests/0/requestId").asText();
        assertEquals("uncertain", text("SELECT state FROM production_requests WHERE request_id = ?", lostId));
        assertEquals(1, count("SELECT count(*) FROM production_synthetic_orders WHERE operation_id = ?", lostId));
        assertEquals(1, wrapper.submits.get());

        long orders = count("SELECT count(*) FROM production_synthetic_orders");
        int looked = startup.reconcileOnce();
        assertTrue(looked >= 1);
        assertEquals("reconciled:" + looked, startup.summary());
        assertEquals("requested", text("SELECT state FROM production_requests WHERE request_id = ?", lostId));
        assertEquals(orders, count("SELECT count(*) FROM production_synthetic_orders"), "reconcile never submits");
        assertEquals(1, wrapper.submits.get());

        lostBody = manual(commandId, "i5 Touring", "eDrive40", 1, POLICY, currentStock());
        Resp again = post(greg, ORDERS, lostBody);
        assertEquals(200, again.status(), again.toString());
        assertEquals(lostId, again.body().at("/value/requests/0/requestId").asText());
        assertEquals("requested", again.body().at("/value/requests/0/state").asText());
        assertEquals(1, count("SELECT count(*) FROM production_synthetic_orders WHERE operation_id = ?", lostId));
        assertEquals(orders, count("SELECT count(*) FROM production_synthetic_orders"));
    }

    // ---- 5: AC1 and AC2, Greg's real plan orders for Sam; its submission is durable, retried once and replanned ----

    @Test
    @Order(6)
    void samsBriefMakesTheRealPlanOrderAndItsSubmissionIsDurableRetriedAndReplanned() throws Exception {
        Resp before = get(greg, PLAN);
        assertEquals(200, before.status(), before.toString());
        JsonNode earlier = before.body().at("/value/plan").deepCopy();
        assertEquals(0, earlier.get("orderQuantity").asInt(), "released stock covers Paula and Alex");
        confirmBrief("sub-sam");

        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        samPlan = read.body().at("/value/plan").deepCopy();
        assertEquals("feasible", samPlan.get("status").asText());
        assertTrue(samPlan.get("orderQuantity").asInt() > 0, "the plan orders cars: " + samPlan.get("quantities"));
        assertEquals("new-order", allocationSource(samPlan, "slot-sam"), samPlan.get("allocations").toString());
        assertEquals("no-submission", read.body().at("/value/replan/status").asText());
        Map<String, Integer> ordered = new java.util.HashMap<>();
        for (JsonNode q : samPlan.get("quantities")) {
            if (q.get("quantity").asInt() > 0) ordered.put(q.get("derivativeId").asText(), q.get("quantity").asInt());
        }
        assertEquals(Map.of(SALOON_330E, 1), ordered, "only a new 330e meets Sam's plug-in essential");

        long subs = count("SELECT count(*) FROM production_submissions");
        long requests = count("SELECT count(*) FROM production_requests");
        long orders = count("SELECT count(*) FROM production_synthetic_orders");

        // The plan Greg saw before Sam's brief is stale: refused, nothing written.
        Resp stale = post(greg, PLAN_REQUESTS, planBody(cmd(), earlier));
        assertEquals(409, stale.status(), stale.toString());
        assertEquals("replan-needed", stale.body().get("code").asText());
        assertEquals(samPlan.get("planId"), stale.body().at("/current/planId"));
        assertEquals(subs, count("SELECT count(*) FROM production_submissions"));
        assertEquals(requests, count("SELECT count(*) FROM production_requests"));

        String command = "cmd-proddep-plan-sam";
        Resp sent = post(greg, PLAN_REQUESTS, planBody(command, samPlan));
        assertEquals(200, sent.status(), sent.toString());
        JsonNode value = sent.body().get("value");
        samSubmission = value.get("submissionId").asText();
        assertEquals(samPlan.get("planId").asText(), value.get("planId").asText());
        assertEquals(samPlan.get("planId").asText(), text("SELECT plan_id FROM production_submissions WHERE submission_id = ?", samSubmission));
        assertEquals(command, text("SELECT command_id FROM production_submissions WHERE submission_id = ?", samSubmission));
        assertEquals(1, value.get("requests").size(), value.toString());
        JsonNode line = value.at("/requests/0");
        samRequest = line.get("requestId").asText();
        assertEquals(SALOON_330E, line.get("lineId").asText());
        assertEquals("3 Series Saloon", text("SELECT model FROM production_requests WHERE request_id = ?", samRequest));
        assertEquals("330e", text("SELECT derivative FROM production_requests WHERE request_id = ?", samRequest));
        assertEquals(1, count("SELECT quantity FROM production_requests WHERE request_id = ?", samRequest));
        assertEquals(samSubmission, text("SELECT submission_id FROM production_requests WHERE request_id = ?", samRequest));
        assertEquals("synthetic-production:" + samRequest,
                text("SELECT provider_reference FROM production_synthetic_orders WHERE operation_id = ?", samRequest));
        // The synthetic Production builds only the four demo configurations (Node parity), so it refuses the 330e at once.
        assertEquals("refused", line.get("state").asText(), line.toString());
        assertEquals("unknown-production-choice", line.get("code").asText(), line.toString());
        assertEquals("refused", text("SELECT state FROM production_requests WHERE request_id = ?", samRequest));
        assertEquals(orders + 1, count("SELECT count(*) FROM production_synthetic_orders"));

        // The same command replays the submission without a second provider order.
        Resp again = post(greg, PLAN_REQUESTS, planBody(command, samPlan));
        assertEquals(200, again.status(), again.toString());
        assertTrue(again.body().at("/value/replayed").asBoolean(), again.toString());
        assertEquals(samSubmission, again.body().at("/value/submissionId").asText());
        assertEquals(orders + 1, count("SELECT count(*) FROM production_synthetic_orders"));
        assertEquals(subs + 1, count("SELECT count(*) FROM production_submissions"));

        // A new command for the submitted plan is refused: Production's answer already moved its supply input.
        Resp twice = post(greg, PLAN_REQUESTS, planBody(cmd(), samPlan));
        assertEquals(409, twice.status(), twice.toString());
        assertEquals("replan-needed", twice.body().get("code").asText(), twice.toString());
        assertTrue(contains(twice.body().get("changedInputs"), "supply"), twice.toString());
        assertEquals(subs + 1, count("SELECT count(*) FROM production_submissions"));
        assertEquals(orders + 1, count("SELECT count(*) FROM production_synthetic_orders"));

        // Production's answers after the submission put Greg's next read on the replan path.
        Resp next = get(greg, PLAN);
        assertEquals(200, next.status(), next.toString());
        JsonNode replan = next.body().at("/value/replan");
        assertEquals("replanned", replan.get("status").asText(), replan.toString());
        assertEquals(samPlan.get("planId").asText(), replan.get("submittedPlanId").asText());
        assertEquals(next.body().at("/value/plan/planId").asText(), replan.get("currentPlanId").asText());
        assertNotEquals(replan.get("submittedPlanId"), replan.get("currentPlanId"), "the refusal changed the plan inputs");
        assertEquals(samRequest, replan.at("/requests/0/requestId").asText(), replan.toString());
        assertEquals("refused", replan.at("/after/state").asText(), replan.toString());
        assertEquals(1, next.body().at("/value/plan/orderQuantity").asInt(), "Sam's need is still open, so the new plan orders again");
    }

    // ---- 6: AC2, real responses update supply and the plan ----

    @Test
    @Order(7)
    void realResponsesBecomeConfirmedSupplyTheNextPlanReadSees() throws Exception {
        Resp before = get(greg, PLAN);
        assertEquals(200, before.status(), before.toString());
        plan2 = before.body().at("/value/plan").deepCopy();
        ordersBefore = plan2.at("/unallocatedStockRisk/totalSupply").asLong();
        assertEquals(0, inbound().size(), "nothing is confirmed yet, so no inbound supply");

        JsonNode v1 = request(touringId);
        Resp half = post(presenter, STEP, step("cmd-proddep-c1", touringId, v1.get("version").asLong(), 1));
        assertEquals(200, half.status(), half.toString());
        assertEquals("partly-confirmed", request(touringId).get("state").asText());
        long scripted = count("SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", touringId);
        Resp same = post(presenter, STEP, step("cmd-proddep-c1", touringId, v1.get("version").asLong(), 1));
        assertEquals(200, same.status(), same.toString());
        assertEquals(scripted, count("SELECT count(*) FROM production_synthetic_responses WHERE operation_id = ?", touringId));
        Resp stale = post(presenter, STEP, step(cmd(), touringId, v1.get("version").asLong(), 1));
        assertEquals(409, stale.status(), stale.toString());
        assertEquals("stale-version", stale.body().get("code").asText());

        Resp rest = post(presenter, STEP, step(cmd(), touringId, request(touringId).get("version").asLong(), 1));
        assertEquals(200, rest.status(), rest.toString());
        JsonNode done = request(touringId);
        assertEquals("confirmed", done.get("state").asText());
        assertEquals(2, done.get("confirmedQuantity").asInt());
        assertEquals(2, done.get("queuedQuantity").asInt());
        assertEquals(0, done.get("releasedQuantity").asInt(), "confirmed is not released");
        assertEquals(2, done.get("quantity").asInt());

        assertEquals(2, count("SELECT count(*) FROM confirmed_supply_queue q JOIN production_confirmations p ON p.supply_id = q.supply_id "
                + "WHERE p.request_id = ?", touringId));
        assertEquals(2, count("SELECT count(*) FROM outbox_events WHERE event_type = 'production.supply-changed' "
                + "AND payload->>'requestId' = ?", touringId));

        Resp after = get(greg, PLAN);
        assertEquals(200, after.status(), after.toString());
        JsonNode plan3 = after.body().at("/value/plan");
        assertNotEquals(plan2.get("planId"), plan3.get("planId"));
        assertNotEquals(plan2.at("/versions/supply"), plan3.at("/versions/supply"));
        // Manual requests stay out of the plan-submission history, so the replan still points at Sam's submitted plan.
        JsonNode replan = after.body().at("/value/replan");
        assertEquals("replanned", replan.get("status").asText(), replan.toString());
        assertEquals(samPlan.get("planId").asText(), replan.get("submittedPlanId").asText());
        assertEquals(plan3.get("planId").asText(), replan.get("currentPlanId").asText());
        assertNotEquals(replan.get("submittedPlanId"), replan.get("currentPlanId"), "the confirmed supply moved the current plan");
        assertEquals(samRequest, replan.at("/after/requestId").asText(), "manual confirmations are not the plan's answers");
        JsonNode in = inbound();
        assertEquals(2, in.size(), in.toString());
        long confirmed = 0;
        for (JsonNode s : in) {
            assertEquals("confirmed", s.get("state").asText());
            assertEquals(0, s.get("releasedQuantity").asInt());
            confirmed += s.get("quantity").asLong();
        }
        assertEquals(2, confirmed);
        assertEquals(ordersBefore + 2, plan3.at("/unallocatedStockRisk/totalSupply").asLong(), "the confirmed cars are planned supply");
        assertEquals(0, count("SELECT count(*) FROM stock_cars WHERE attributes->'release'->>'supplyId' IS NOT NULL"));
    }

    // ---- 8: FUCQ-546, the replan reports the constraint changes the plan was submitted under ----

    @Test
    @Order(8)
    void aPlanSubmittedUnderDraftChangesReportsThoseChangesInTheReplanOnceSupplyMoves() throws Exception {
        JsonNode golden = M.readTree(getClass().getResourceAsStream("/order-plan-parity/submission-changes.json"));
        JsonNode input = golden.get("input");
        Resp preview = post(greg, API + "/greg/order-plan/preview", M.createObjectNode().set("changes", input).toString());
        assertEquals(200, preview.status(), preview.toString());
        JsonNode draft = preview.body().at("/value/plan");
        ObjectNode body = M.createObjectNode().put("commandId", "cmd-proddep-plan-changes").put("planId", draft.get("planId").asText());
        body.set("versions", draft.get("versions"));
        body.set("changes", input);
        Resp sent = post(greg, PLAN_REQUESTS, body.toString());
        assertEquals(200, sent.status(), sent.toString());
        String submission = sent.body().at("/value/submissionId").asText();
        JsonNode touring = null;
        for (JsonNode r : sent.body().at("/value/requests")) if ("g21-touring-320i".equals(r.get("lineId").asText())) touring = r;
        assertTrue(touring != null && touring.get("quantity").asInt() >= 2, sent.body().toString());
        changesRequest = touring.get("requestId").asText();
        assertEquals(golden.get("expected"), M.readTree(text("SELECT constraint_changes::text FROM production_submissions WHERE submission_id = ?", submission)));

        Resp step = post(presenter, STEP, step(cmd(), changesRequest, request(changesRequest).get("version").asLong(), 1));
        assertEquals(200, step.status(), step.toString());

        Resp after = get(greg, PLAN);
        assertEquals(200, after.status(), after.toString());
        JsonNode replan = after.body().at("/value/replan");
        assertEquals("replanned", replan.get("status").asText(), replan.toString());
        assertEquals(draft.get("planId").asText(), replan.get("submittedPlanId").asText());
        // The plan also orders Sam's 330e, which the synthetic Production refuses at once, so `after` may be that line.
        boolean answered = false;
        for (JsonNode h : replan.get("responses")) answered |= changesRequest.equals(h.get("requestId").asText()) && "partly-confirmed".equals(h.get("state").asText());
        assertTrue(answered, replan.toString());
        assertEquals(golden.get("expected"), replan.get("changes"));
    }

    // ---- helpers ----

    private JsonNode inbound() {
        RunContext context = new RunContext(ENV, RUN, "sub-greg");
        String asOf = PolicyClock.iso(planningClock.observe(context).now());
        PlanningRead read = new PlanningRead(context, asOf, POLICY, PolicyClock.iso(Instant.parse(asOf).plusSeconds(400L * 86_400)));
        ObjectNode out = supply.readSupply(read, policy);
        assertEquals("ok", out.get("status").asText(), out.toString());
        return out.at("/value/inbound");
    }

    private void assertNoWrites() throws Exception {
        assertEquals(0, count("SELECT count(*) FROM production_submissions"));
        assertEquals(0, count("SELECT count(*) FROM production_requests"));
    }

    private static String allocationSource(JsonNode plan, String entitlementId) {
        for (JsonNode a : plan.get("allocations")) {
            if (entitlementId.equals(a.get("entitlementId").asText())) return a.get("source").asText();
        }
        return null;
    }

    private static boolean contains(JsonNode list, String text) {
        for (JsonNode n : list) if (text.equals(n.asText())) return true;
        return false;
    }

    private static String planBody(String commandId, JsonNode plan) {
        ObjectNode body = M.createObjectNode().put("commandId", commandId).put("planId", plan.get("planId").asText());
        body.set("versions", plan.get("versions"));
        return body.toString();
    }

    private static String manual(String commandId, String model, String derivative, int quantity, String policyVersion, String stock) {
        return M.createObjectNode().put("commandId", commandId).put("model", model).put("derivative", derivative)
                .put("quantity", quantity).put("expectedPolicyVersion", policyVersion).put("expectedStockVersion", stock).toString();
    }

    private static String step(String commandId, String requestId, long version, int quantity) {
        return "{\"commandId\":\"" + commandId + "\",\"requestId\":\"" + requestId + "\",\"expectedVersion\":" + version
                + ",\"action\":\"confirm\",\"quantity\":" + quantity + "}";
    }

    private String currentStock() throws Exception {
        return get(greg, ORDERS).body().at("/value/versions/stock").asText();
    }

    private JsonNode request(String requestId) throws Exception {
        for (JsonNode r : get(greg, ORDERS).body().at("/value/requests")) {
            if (requestId.equals(r.get("requestId").asText())) return r;
        }
        throw new AssertionError("no such request: " + requestId);
    }

    /** An employee's brief through the real routes: three categories and Same again, then confirm with consent. */
    private void confirmBrief(String sub) throws Exception {
        String t = token(sub, "employee");
        String who = sub.substring(4);
        JsonNode initial = get(t, API + "/brief/editor").body().at("/value/initial");
        String contract = initial.at("/currentCarRating/contractId").asText();
        Resp prefs = post(t, API + "/brief/preferences", "{\"commandId\":\"" + cmd() + "\",\"expectedBriefVersion\":"
                + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + initial.get("draftVersion") + ",\"changes\":{"
                + "\"comfort\":{\"value\":50},\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50}},"
                + "\"sameAgain\":{\"contractId\":\"" + contract + "\",\"on\":true}}");
        assertEquals(200, prefs.status(), who + " " + prefs);
        Resp confirm = post(t, API + "/brief/confirm", "{\"commandId\":\"" + cmd() + "\",\"expectedBriefVersion\":"
                + initial.get("briefVersion") + ",\"expectedDraftVersion\":" + prefs.body().at("/value/draftVersion")
                + ",\"consent\":{\"search\":true,\"hold\":true}}");
        assertEquals(200, confirm.status(), who + " " + confirm);
    }

    record Resp(int status, JsonNode body) {
    }

    private Resp get(String token, String path) throws Exception {
        Response r = given().header("Authorization", "Bearer " + token).get(path);
        return new Resp(r.statusCode(), M.readTree(r.asString()));
    }

    private Resp post(String token, String path, String body) throws Exception {
        Response r = given().header("Authorization", "Bearer " + token).contentType(ContentType.JSON).body(body).post(path);
        return new Resp(r.statusCode(), M.readTree(r.asString()));
    }

    private static String cmd() {
        return "cmd-proddep-" + UUID.randomUUID();
    }

    private long count(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0;
            }
        }
    }

    private String text(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    private String token(String sub, String role) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(ProductionDeployedJourneyProfile.ISSUER);
        c.setAudience(ProductionDeployedJourneyProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", ProductionDeployedJourneyProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(jwk)).getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }
}
