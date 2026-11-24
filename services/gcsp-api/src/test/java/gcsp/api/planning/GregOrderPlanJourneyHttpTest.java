package gcsp.api.planning;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.StockDbFixture;
import gcsp.api.appointments.ReturnJourneySteps;
import gcsp.api.claims.ClaimClock;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
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
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
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
 * FUCQ-477 acceptance and the FUCQ-515 producer-to-consumer regression on the started app: real RS256 tokens from the
 * loopback JWKS, native PostgreSQL in a private schema, and no test alternative, mock or stand-in bean.
 * Demand is two employees' briefs saved and confirmed through the real brief routes. Supply is the demo provider's
 * release, delivered by the presenter's next-release tick. The cart hold is a real POST /manual/claim.
 * Config knobs used: the dev composition (oidc accounts, demo scenario, synthetic ordering and production, local claim
 * stock, demo supply) and long sweep and drain intervals so no background pass touches the rows. No fixed account
 * clock is set, because the released cars are available from the run clock's date and a fixed earlier account clock
 * would call them not-yet-available. The ahead-of-wall case temporarily changes only its private Paula collection
 * window; the packaged account, renewal date and Sam inputs stay unchanged.
 */
@QuarkusTest
@TestProfile(GregOrderPlanJourneyProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class GregOrderPlanJourneyHttpTest {

    private static final ObjectMapper M = new ObjectMapper();
    private static final String API = "/api/gcsp/v1";
    private static final String PLAN = API + "/greg/order-plan";
    private static final String REQUESTS = API + "/greg/production/requests";
    private static final String ENV = "account-dev-env";
    private static final String RUN = "run-1";
    private static final String POLICY = "gcsp-policy-v1";
    private static final String TOURING = "g21-touring-320i";
    private static final List<String> DECISION_FIELDS = List.of("planId", "versions", "status", "quantities", "modelQuantities",
            "allocations", "expectedAcceptableCoverage", "unallocatedStockRisk", "spendMinor", "currency", "orderQuantity",
            "objective", "bindingConstraints", "unmetNeeds", "alternatives");

    private static String ownedSchema;
    private static JsonNode firstPlan;
    private static String heldCar;
    private static String holdId;

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
    PolicyService policy;

    @Inject
    ClaimClock claimClock;

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
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_s_planj_")) return;
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(GregOrderPlanJourneyProfile.URL);
        try (Connection c = ds.getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    // ---- 0: the composition ----

    @Test
    @Order(0)
    void theStartedAppUsesTheRealBindingsAndNoTestAlternative() {
        assertTrue(new GregOrderPlanJourneyProfile().getEnabledAlternatives().isEmpty());
        assertInstanceOf(PostgresPlanningDemand.class, ClientProxy.unwrap(demand));
        assertInstanceOf(PostgresPlanningSupply.class, ClientProxy.unwrap(supply));
        assertInstanceOf(RunPlanningClock.class, ClientProxy.unwrap(planningClock));
    }

    // ---- 1: inputs through the real writers ----

    @Test
    @Order(1)
    void demandIsASavedConfirmedBriefAndSupplyIsTheDemoProvidersRealRelease() throws Exception {
        JsonNode clock = get(presenter, API + "/presenter/clock").body().get("value");
        Resp tick = post(presenter, API + "/presenter/controls/tick", "{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.get("clockVersion") + ",\"mode\":\"next-release\"}");
        assertEquals(200, tick.status(), tick.toString());
        assertEquals("completed", tick.body().at("/value/tick/state").asText());
        assertEquals(6, count("SELECT count(*) FROM stock_cars WHERE state = 'released'"));
        assertEquals(1, count("SELECT count(*) FROM stock_releases"));

        confirmBrief("sub-paula");
        assertEquals(1, count("SELECT count(*) FROM briefs WHERE employee_id = 'employee-paula' AND brief_version = 1"));
        assertEquals(0, count("SELECT count(*) FROM production_submissions"));
    }

    // ---- 2: AC1 ----

    @Test
    @Order(2)
    void gregsPlanComesFromTheRealAdaptersAndEqualsTheSolverOverTheSamePortReadings() throws Exception {
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        assertEquals("ok", read.body().get("status").asText());
        JsonNode value = read.body().get("value");
        JsonNode plan = value.get("plan");
        firstPlan = plan.deepCopy();
        assertEquals("current", value.get("mode").asText());
        assertEquals("feasible", plan.get("status").asText());
        assertEquals("no-submission", value.get("replan").get("status").asText());
        assertEquals(POLICY, plan.at("/versions/policy").asText());

        // Demand and supply are non-empty, from the saved brief and the released cars.
        assertEquals(1, plan.at("/expectedAcceptableCoverage/total").asInt());
        assertEquals(6, plan.at("/unallocatedStockRisk/totalSupply").asInt());
        assertEquals(5, plan.at("/unallocatedStockRisk/bySource").size());
        assertEquals(1, plan.at("/expectedAcceptableCoverage/covered").asInt());
        assertFalse(plan.at("/unboundStock").isMissingNode());

        // Supported quantities, coverage and risk, alternatives and explanations are all present.
        assertEquals(5, plan.get("quantities").size());
        assertEquals(4, plan.get("modelQuantities").size());
        assertTrue(plan.get("expectedAcceptableCoverage").has("covered"));
        assertTrue(plan.get("unallocatedStockRisk").has("quantity"));
        assertEquals(List.of("zero-new-orders-baseline", "next-best-distinct-feasible"), kinds(plan.get("alternatives")));
        assertTrue(plan.get("bindingConstraints").size() > 0);
        assertTrue(plan.at("/objective/tradeOff").asText().length() > 0);
        assertEquals(0, plan.get("unmetNeeds").size(), "Paula's confirmed driver lets released stock cover her (FUCQ-530)");
        assertEquals("slot-paula", plan.at("/allocations/0/entitlementId").asText());
        assertTrue(plan.at("/allocations/0/sourceId").asText().startsWith("stock:"), plan.get("allocations").toString());
        assertTrue(plan.at("/solver/complete").asBoolean());

        // Equivalent decision outcomes: the same solver over the same port readings gives the same decisions.
        Principal principal = new Principal("sub-greg", List.of("greg"), ENV, RUN, null, POLICY, List.of());
        ObjectNode again = new OrderPlanService(policy, demand, supply, planningClock).readPlan(principal, POLICY);
        assertEquals("feasible", again.get("status").asText(), again.toString());
        // Compared as JSON text: the in-process tree holds doubles where the parsed HTTP body holds ints.
        JsonNode recomputed = M.readTree(again.toString());
        for (String field : DECISION_FIELDS) {
            assertEquals(recomputed.get(field), plan.get(field), field);
        }
    }

    // ---- 3: AC2, changed constraints ----

    @Test
    @Order(3)
    void aChangedConstraintChangesTheOutcomeTruthfullyAndPreviewWritesNothing() throws Exception {
        long before = count("SELECT count(*) FROM production_submissions") + count("SELECT count(*) FROM production_requests");
        ArrayNode bounds = withBound("orderPlan.derivativeBounds", "derivativeId", TOURING, "min", 2);
        Resp preview = post(greg, PLAN + "/preview", changes(change("orderPlan.derivativeBounds", bounds)));
        assertEquals(200, preview.status(), preview.toString());
        JsonNode v = preview.body().get("value");
        assertEquals("preview", v.get("mode").asText());
        assertEquals("none", v.get("writes").asText());
        assertEquals(POLICY, v.get("activePolicyVersion").asText());
        assertTrue(v.get("draftPolicyVersion").asText().startsWith("preview-"));
        assertEquals(firstPlan.get("planId"), v.at("/activePlan/planId"), "the active plan is the one already read");
        JsonNode plan = v.get("plan");
        assertEquals("feasible", plan.get("status").asText());
        assertNotEquals(firstPlan.get("planId"), plan.get("planId"));
        assertEquals(v.get("draftPolicyVersion").asText(), plan.at("/versions/policy").asText());
        assertEquals(0, firstPlan.get("orderQuantity").asInt());
        assertTrue(plan.get("orderQuantity").asInt() >= 2, "the new minimum is honoured: " + plan.get("quantities"));
        assertTrue(quantity(plan, TOURING) >= 2);
        assertTrue(plan.get("spendMinor").asLong() > 0);

        assertEquals(before, count("SELECT count(*) FROM production_submissions") + count("SELECT count(*) FROM production_requests"));
        Resp after = get(greg, PLAN);
        assertEquals(firstPlan.get("planId"), after.body().at("/value/plan/planId"), "preview did not change the active plan");
        assertEquals(POLICY, after.body().at("/value/plan/versions/policy").asText());
    }

    // ---- 4: AC2, infeasible ----

    @Test
    @Order(4)
    void anInfeasibleConstraintSetAnswersWithConflictsNotAFabricatedPlan() throws Exception {
        ArrayNode bounds = withBound("orderPlan.derivativeBounds", "derivativeId", TOURING, "min", 3);
        ObjectNode budget = change("orderPlan.budgetMinor", M.getNodeFactory().numberNode(0));
        Resp preview = post(greg, PLAN + "/preview", changes(change("orderPlan.derivativeBounds", bounds), budget));
        assertEquals(200, preview.status(), preview.toString());
        JsonNode v = preview.body().get("value");
        JsonNode plan = v.get("plan");
        assertEquals("infeasible", plan.get("status").asText());
        assertTrue(plan.get("conflicts").size() > 0, "the conflict is named");
        assertEquals(0, plan.get("quantities").size(), "no plan quantities are invented");
        assertEquals(0, plan.get("alternatives").size());
        assertEquals("feasible", v.at("/activePlan/status").asText(), "the active plan is untouched");
        assertEquals(0, count("SELECT count(*) FROM production_submissions"));
    }

    // ---- 5: AC2, stale inputs and recomputation ----

    @Test
    @Order(5)
    void aChangedInputRecomputesTheNextReadAndMakesTheEarlierPlanStale() throws Exception {
        confirmBrief("sub-alex");

        Resp fresh = get(greg, PLAN);
        assertEquals(200, fresh.status(), fresh.toString());
        JsonNode plan = fresh.body().at("/value/plan");
        assertNotEquals(firstPlan.get("planId"), plan.get("planId"));
        assertNotEquals(firstPlan.at("/versions/forecast"), plan.at("/versions/forecast"));
        assertEquals(firstPlan.at("/versions/cohort"), plan.at("/versions/cohort"), "the cohort is employees and slots, not briefs");
        assertEquals(1, firstPlan.at("/expectedAcceptableCoverage/total").asInt());
        assertEquals(2, plan.at("/expectedAcceptableCoverage/total").asInt(), "the second brief is now demand");
        assertEquals(2, plan.at("/expectedAcceptableCoverage/covered").asInt());
        assertEquals(0, plan.get("unmetNeeds").size(), "both briefs are met by released stock (FUCQ-530)");

        ObjectNode submit = M.createObjectNode().put("commandId", cmd()).put("planId", firstPlan.get("planId").asText());
        submit.set("versions", firstPlan.get("versions"));
        Resp stale = post(greg, REQUESTS, submit.toString());
        assertEquals(409, stale.status(), stale.toString());
        assertEquals("replan-needed", stale.body().get("code").asText());
        assertEquals(plan.get("planId"), stale.body().at("/current/planId"));
        List<String> changed = M.convertValue(stale.body().get("changedInputs"), M.getTypeFactory().constructCollectionType(List.class, String.class));
        assertTrue(changed.containsAll(List.of("plan", "forecast")), changed.toString());
        assertEquals(0, count("SELECT count(*) FROM production_submissions"));
        assertEquals(0, count("SELECT count(*) FROM production_requests"));
    }

    // ---- 6: FUCQ-515, the cart hold and the run clock ----

    @Test
    @Order(6)
    void aRealCartHoldStaysHeldInThePlanWhenTheRunClockRunsTwoDaysAheadOfWallTime() throws Exception {
        String paula = token("sub-paula", "employee");
        AccountInput originalPaula = accountInput("employee-paula");
        AccountInput originalSam = accountInput("employee-sam");
        assertEquals(0, count("SELECT count(*) FROM manual_claims WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", ENV, RUN, "employee-paula"), "advance before creating any Paula quote or hold");
        assertEquals(0, count("SELECT count(*) FROM custody_holds WHERE environment_id = ? AND run_id = ? "
                + "AND employee_id = ?", ENV, RUN, "employee-paula"));

        // Advance the real authority first; never rebase a business timestamp or rewind a clock after claiming.
        Instant beforeAdvance = runClockNow();
        JsonNode clock = get(presenter, API + "/presenter/clock").body().get("value");
        Resp advance = post(presenter, API + "/presenter/clock/advance", "{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.get("clockVersion") + ",\"bySeconds\":172800}");
        assertEquals(200, advance.status(), advance.toString());
        Instant runNow = runClockNow();
        assertEquals(beforeAdvance.plusSeconds(172800), runNow, "the real presenter advanced the persisted authority by exactly two days");
        assertTrue(runNow.isAfter(Instant.now().plusSeconds(86_400)), "the run clock is ahead of wall time");
        assertEquals(runNow, claimClock.now(new RunContext(ENV, RUN, "sub-paula")));

        JsonNode hold = null;
        boolean inputOwned = false;
        Throwable primaryFailure = null;
        try {
            Resp before = get(paula, API + "/manual/account");
            assertEquals(200, before.status(), before.toString());
            JsonNode account = before.body().get("value");
            assertEquals(PolicyClock.iso(runNow), account.get("asOf").asText());
            String collection = smallestCollectionDate(account);
            ObjectNode varied = originalPaula.record().deepCopy();
            List<ObjectNode> windows = paulaCollectionWindows(varied);
            for (ObjectNode window : windows) {
                assertTrue(LocalDate.parse(collection).isAfter(LocalDate.parse(window.get("latestCollectionDate").asText())));
                window.put("latestCollectionDate", collection);
            }
            ObjectNode roundTrip = varied.deepCopy();
            List<ObjectNode> originalWindows = paulaCollectionWindows(originalPaula.record());
            List<ObjectNode> restoredWindows = paulaCollectionWindows(roundTrip);
            for (int i = 0; i < windows.size(); i++) {
                restoredWindows.get(i).set("latestCollectionDate", originalWindows.get(i).get("latestCollectionDate"));
            }
            assertEquals(originalPaula.record(), roundTrip, "only the two identified collection-window paths differ");
            inputOwned = true;
            replacePaulaRecord(varied, originalPaula.version());
            assertEquals(new AccountInput(varied, originalPaula.version() + 1), accountInput("employee-paula"));
            Resp ready = get(paula, API + "/manual/account");
            assertEquals(200, ready.status(), ready.toString());
            assertEquals("ready", ready.body().at("/value/state").asText(), ready.toString());
            assertEquals("current:employee-paula", ready.body().at("/value/currentContract/contractId").asText());
            assertEquals(collection, ready.body().at("/value/currentContract/latestCollectionDate").asText());
            saveDraft(paula, ready.body().get("value"), collection);

            JsonNode eligible = null;
            Resp stock = get(paula, API + "/manual/stock");
            assertEquals(200, stock.status(), stock.toString());
            for (JsonNode d : stock.body().at("/value/decisions")) {
                if ("eligible".equals(d.get("gateStatus").asText())) {
                    eligible = d;
                    break;
                }
            }
            assertNotNull(eligible, "the real release has a car Paula may claim");
            heldCar = eligible.get("orderUuid").asText();
            ObjectNode claimInput = ((ObjectNode) eligible.get("claimInput")).deepCopy();
            claimInput.put("commandId", cmd());
            Resp claim = post(paula, API + "/manual/claim", claimInput.toString());
            assertEquals(200, claim.status(), claim.toString());
            hold = claim.body().at("/value/hold");
            holdId = hold.get("holdId").asText();
            assertEquals("cart", text("SELECT hold_type FROM custody_holds WHERE hold_id = ?", holdId));
            JsonNode quote = claim.body().at("/value/quote");
            assertEquals(heldCar, quote.get("orderUuid").asText());
            assertEquals("employee-paula", quote.get("employeeId").asText());
            assertEquals("slot-paula", quote.get("entitlementSlotId").asText());
            assertEquals(claimInput.get("expectedDraftVersion"), quote.get("draftVersion"));
            assertEquals(claimInput.get("expectedContextVersion"), quote.get("contextVersion"));
            assertEquals(claimInput.get("expectedTermsDigest"), quote.get("termsDigest"));
            assertEquals(claimInput.get("expectedStockVersion").asLong() + 1, quote.get("stockVersion").asLong());
            assertEquals(POLICY, quote.get("policyVersion").asText());
            ObjectNode storedQuote = ((ObjectNode) quote).deepCopy();
            assertFalse(storedQuote.remove("quoteId").asText().isBlank());
            assertEquals(storedQuote, M.readTree(text("SELECT quote::text FROM manual_claims WHERE hold_id = ?", holdId)));
            Instant quotedAt = instant("SELECT quoted_at FROM manual_claims WHERE hold_id = ?", holdId);
            assertEquals(runNow, quotedAt);
            assertEquals(PolicyClock.iso(quotedAt), quote.get("quotedAt").asText());
            long previewSeconds = policy.getAssumption("hold.cart.durationSeconds",
                    new PolicyRead(RUN, PolicyClock.iso(runNow), POLICY)).value().get("value").asLong();
            assertTrue(previewSeconds > 0);
            assertEquals(previewSeconds, quote.at("/timing/previewSeconds").asLong());
            Instant expires = instant("SELECT expires_at FROM custody_holds WHERE hold_id = ?", holdId);
            assertEquals(quotedAt.plusSeconds(previewSeconds), expires);
            assertTrue(expires.isAfter(claimClock.now(new RunContext(ENV, RUN, "sub-paula"))), "the actual cart authority is live");
            String stockBefore = firstPlanVersion("stock");

            Resp held = get(greg, PLAN);
            assertEquals(200, held.status(), held.toString());
            assertNotEquals(stockBefore, held.body().at("/value/plan/versions/stock").asText(), "the hold is part of the stock version");
            assertEquals("slot-paula", heldFor(heldCar));
            Resp after = get(greg, PLAN);
            assertEquals(200, after.status(), "the read must not be refused as planning-held-stock-unresolved: " + after);
            assertEquals("ok", after.body().get("status").asText());
            assertEquals(PolicyClock.iso(runNow), after.body().at("/value/plan/asOf").asText());
            assertEquals("slot-paula", heldFor(heldCar), "the car is still held for the claimant's slot");
            System.out.println("F589 live private Paula window=" + collection + " run=" + runNow + " hold=" + holdId
                    + " quotedAt=" + quotedAt + " expires=" + expires + " previewSeconds=" + previewSeconds);
        } catch (Throwable failure) {
            primaryFailure = failure;
            throw failure;
        } finally {
            Throwable cleanupFailure = null;
            try {
                if (hold != null) {
                    // The case owns the public release before restoring its account and before Sam runs.
                    Resp release = post(paula, API + "/manual/claim/release", M.createObjectNode().put("commandId", cmd()).put("holdId", holdId)
                            .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1).put("reason", "cancel").toString());
                    assertEquals(200, release.status(), release.toString());
                    assertEquals(200, get(greg, PLAN).status());
                    assertNull(heldFor(heldCar), "a released car is no longer held");
                    System.out.println("F589 released owned hold=" + holdId + " through public route; no heldFor");
                }
            } catch (Throwable failure) {
                cleanupFailure = failure;
            }
            try {
                if (inputOwned) {
                    long restoreVersion = accountInput("employee-paula").version();
                    replacePaulaRecord(originalPaula.record(), restoreVersion);
                    assertEquals(new AccountInput(originalPaula.record(), restoreVersion + 1), accountInput("employee-paula"));
                    assertTrue(restoreVersion > originalPaula.version(), "the override was a monotonic source transition");
                    System.out.println("F589 exact Paula record restored; versions=" + originalPaula.version() + "->"
                            + restoreVersion + "->" + (restoreVersion + 1));
                }
                assertEquals(originalSam, accountInput("employee-sam"), "Sam input and repository version stay unchanged before Order7");
            } catch (Throwable failure) {
                if (cleanupFailure == null) cleanupFailure = failure; else cleanupFailure.addSuppressed(failure);
            }
            if (cleanupFailure != null) {
                if (primaryFailure != null) primaryFailure.addSuppressed(cleanupFailure);
                else if (cleanupFailure instanceof Exception failure) throw failure;
                else if (cleanupFailure instanceof Error failure) throw failure;
                else throw new AssertionError(cleanupFailure);
            }
        }
    }

    // ---- 7: FUCQ-528, a confirmed driver lets the plan order for Sam ----

    @Test
    @Order(7)
    void gregsPlanOrdersA330eForSamAndTheSubmissionIsAccepted() throws Exception {
        confirmBrief("sub-sam");

        // Only a new 330e meets Sam's need; before the fix every configuration was driver-unconfirmed.
        JsonNode plan = readPlan();
        assertTrue(plan.get("orderQuantity").asInt() > 0, "the plan orders cars: " + plan.get("quantities"));
        assertTrue(quantity(plan, "g20-saloon-330e") >= 1, plan.get("quantities").toString());
        assertNull(unmet(plan, "slot-sam"), "Sam's need is met: " + plan.get("unmetNeeds"));
        String source = null;
        for (JsonNode a : plan.get("allocations")) {
            if ("slot-sam".equals(a.get("entitlementId").asText())) source = a.get("source").asText();
        }
        assertEquals("new-order", source, plan.get("allocations").toString());

        ObjectNode submit = M.createObjectNode().put("commandId", cmd()).put("planId", plan.get("planId").asText());
        submit.set("versions", plan.get("versions"));
        Resp accepted = post(greg, REQUESTS, submit.toString());
        assertEquals(200, accepted.status(), accepted.toString());
        assertTrue(accepted.body().at("/value/requests").size() > 0, accepted.toString());
        assertEquals(1, count("SELECT count(*) FROM production_submissions"));
        assertTrue(count("SELECT count(*) FROM production_requests WHERE derivative LIKE '%330e%'") > 0);
    }

    private JsonNode readPlan() throws Exception {
        Resp read = get(greg, PLAN);
        assertEquals(200, read.status(), read.toString());
        return read.body().at("/value/plan");
    }

    private static JsonNode unmet(JsonNode plan, String entitlementId) {
        for (JsonNode need : plan.get("unmetNeeds")) {
            if (entitlementId.equals(need.get("entitlementId").asText())) return need;
        }
        return null;
    }

    // ---- helpers ----

    /** The slot the app's own supply reading says the car is held for, or null when it is not held. */
    private String heldFor(String orderUuid) {
        RunContext context = new RunContext(ENV, RUN, "sub-greg");
        String asOf = PolicyClock.iso(planningClock.observe(context).now());
        PlanningRead read = new PlanningRead(context, asOf, POLICY, JsTime.iso(JsTime.parse(asOf) + 400L * 86_400_000L));
        ObjectNode out = supply.readSupply(read, policy);
        assertEquals("ok", out.get("status").asText(), out.toString());
        for (JsonNode s : out.at("/value/stock")) {
            if (orderUuid.equals(s.get("stockId").asText())) {
                JsonNode slot = s.get("heldForEntitlementSlotId");
                return slot == null || slot.isNull() ? null : slot.asText();
            }
        }
        throw new AssertionError("the car is not in the planning supply: " + orderUuid);
    }

    private String firstPlanVersion(String key) {
        return firstPlan.at("/versions/" + key).asText();
    }

    private static int quantity(JsonNode plan, String derivativeId) {
        for (JsonNode q : plan.get("quantities")) {
            if (derivativeId.equals(q.get("derivativeId").asText())) return q.get("quantity").asInt();
        }
        throw new AssertionError(derivativeId);
    }

    private static List<String> kinds(JsonNode alternatives) {
        return M.convertValue(alternatives.findValues("kind"), M.getTypeFactory().constructCollectionType(List.class, String.class));
    }

    private ArrayNode withBound(String key, String idField, String id, String field, int to) {
        String asOf = PolicyClock.iso(planningClock.observe(new RunContext(ENV, RUN, "sub-greg")).now());
        ArrayNode bounds = ((ArrayNode) policy.getAssumption(key, new PolicyRead(RUN, asOf, POLICY)).value().get("value")).deepCopy();
        for (JsonNode b : bounds) {
            if (id.equals(b.get(idField).asText())) ((ObjectNode) b).put(field, to);
        }
        return bounds;
    }

    private static ObjectNode change(String key, JsonNode value) {
        ObjectNode n = M.createObjectNode().put("key", key);
        n.set("value", value);
        return n;
    }

    private static String changes(ObjectNode... edits) {
        ObjectNode body = M.createObjectNode();
        ArrayNode list = body.putArray("changes");
        for (ObjectNode e : edits) list.add(e);
        return body.toString();
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
        assertEquals(1, confirm.body().at("/value/brief/briefVersion").asInt());
    }

    /** A complete manual draft, checked again against the actual ready account's canonical date constraints. */
    private void saveDraft(String paula, JsonNode account, String collection) throws Exception {
        ObjectNode choices = StockDbFixture.complete();
        choices.put("slotId", "slot-paula").put("driverId", "driver:employee-paula").put("oldContractId", "current:employee-paula");
        choices = ReturnJourneySteps.withCollectionDate(account, choices);
        assertEquals(collection, choices.get("requestedCollectionDate").asText());
        ((ObjectNode) choices.get("contact")).put("email", "paula@gcsp-demo.com");
        ObjectNode in = M.createObjectNode().put("commandId", cmd()).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", account.get("contextVersion").asText());
        in.set("choices", choices);
        Resp saved = post(paula, API + "/manual/draft", in.toString());
        assertEquals(200, saved.status(), saved.toString());
    }

    /** Only latestCollectionDate is varied; all other bounds remain actual account/policy inputs. */
    private String smallestCollectionDate(JsonNode account) {
        JsonNode rules = selected(account.get("assumptions"), "key", "manual.context.v1").get("value");
        ObjectNode choices = StockDbFixture.complete();
        JsonNode driver = selected(account.get("drivers"), "driverId", "driver:employee-paula");
        JsonNode location = selected(rules.get("locations"), "locationId", choices.get("collectionLocationId").asText());
        JsonNode option = selected(rules.get("contractOptions"), "contractOptionId", choices.get("contractOptionId").asText());
        assertEquals(account.at("/choices/schemeId"), choices.get("schemeId"));
        assertTrue(includes(option.get("schemeIds"), choices.get("schemeId").asText()));
        assertTrue(includes(option.get("driverKinds"), driver.get("kind").asText()));
        assertTrue(includes(location.get("contractOptionIds"), option.get("contractOptionId").asText()));
        assertTrue(includes(location.get("driverKinds"), driver.get("kind").asText()));
        assertTrue(rules.get("minimumLeadDays").isIntegralNumber() && rules.get("maximumLeadDays").isIntegralNumber());
        long min = rules.get("minimumLeadDays").asLong(), max = rules.get("maximumLeadDays").asLong();
        assertTrue(min >= 0 && max >= min);
        LocalDate day = LocalDate.parse(account.get("asOf").asText().substring(0, 10));
        LocalDate first = day.plusDays(min), last = day.plusDays(max);
        JsonNode contract = account.get("currentContract");
        assertEquals("current:employee-paula", contract.get("contractId").asText());
        if (contract.hasNonNull("earliestCollectionDate")) {
            LocalDate earliest = LocalDate.parse(contract.get("earliestCollectionDate").asText());
            if (earliest.isAfter(first)) first = earliest;
        }
        JsonNode licence = driver.get("licence");
        assertTrue(includes(licence.get("categories"), "car"));
        LocalDate validFrom = LocalDate.parse(licence.get("validFrom").asText());
        LocalDate validUntil = LocalDate.parse(licence.get("validUntil").asText());
        if (validFrom.isAfter(first)) first = validFrom;
        if (validUntil.isBefore(last)) last = validUntil;
        JsonNode closed = location.get("closedDates");
        assertTrue(closed == null || closed.isNull() || closed.isArray());
        for (LocalDate date = first; !date.isAfter(last); date = date.plusDays(1)) {
            if (closed == null || closed.isNull() || !includes(closed, date.toString())) return date.toString();
        }
        throw new AssertionError("No open collection day within canonical lead, earliest and licence bounds");
    }

    private static boolean includes(JsonNode rows, String value) {
        assertTrue(rows != null && rows.isArray());
        for (JsonNode row : rows) if (value.equals(row.asText())) return true;
        return false;
    }

    private static JsonNode selected(JsonNode rows, String key, String value) {
        assertTrue(rows != null && rows.isArray());
        List<JsonNode> found = new ArrayList<>();
        for (JsonNode row : rows) if (value.equals(row.path(key).asText())) found.add(row);
        assertEquals(1, found.size(), "one canonical selection for " + key + "=" + value);
        return found.get(0);
    }

    private static List<ObjectNode> paulaCollectionWindows(JsonNode record) {
        List<ObjectNode> windows = new ArrayList<>();
        for (JsonNode contract : record.get("contracts")) if (paulaContract(contract)) windows.add((ObjectNode) contract);
        assertEquals(1, windows.size(), "one identified current contract");
        for (JsonNode history : record.get("histories")) {
            for (JsonNode contract : history.get("entries")) if (paulaContract(contract)) windows.add((ObjectNode) contract);
        }
        assertEquals(2, windows.size(), "one matching history mirror");
        return windows;
    }

    private static boolean paulaContract(JsonNode contract) {
        return "current:employee-paula".equals(contract.path("contractId").asText())
                && "employee-paula".equals(contract.path("employeeId").asText())
                && "slot-paula".equals(contract.path("slotId").asText());
    }

    private record AccountInput(JsonNode record, long version) {}

    private AccountInput accountInput(String employee) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT record::text, version FROM employee_account_records WHERE environment_id = ? AND run_id = ? AND employee_id = ?")) {
            ps.setString(1, ENV); ps.setString(2, RUN); ps.setString(3, employee);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next(), "the owned composition's account exists");
                AccountInput input = new AccountInput(M.readTree(rs.getString(1)), rs.getLong(2));
                assertFalse(rs.next());
                return input;
            }
        }
    }

    private void replacePaulaRecord(JsonNode record, long expectedVersion) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(
                "UPDATE employee_account_records SET record = ?::jsonb, version = version + 1 "
                        + "WHERE environment_id = ? AND run_id = ? AND employee_id = ? AND version = ?")) {
            ps.setString(1, record.toString()); ps.setString(2, ENV); ps.setString(3, RUN);
            ps.setString(4, "employee-paula"); ps.setLong(5, expectedVersion);
            assertEquals(1, ps.executeUpdate(), "one scoped versioned private record transition");
        }
    }

    private Instant runClockNow() throws Exception {
        return instant("SELECT clock_instant FROM run_clocks WHERE run_id = ?", RUN);
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
        return "cmd-planj-" + UUID.randomUUID();
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

    private Instant instant(String sql, Object... params) throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getObject(1, OffsetDateTime.class).toInstant();
            }
        }
    }

    private static String token(String sub, String role, String jwk) throws Exception {
        JwtClaims c = new JwtClaims();
        c.setIssuer(GregOrderPlanJourneyProfile.ISSUER);
        c.setAudience(GregOrderPlanJourneyProfile.AUDIENCE);
        c.setSubject(sub);
        c.setExpirationTimeMinutesInTheFuture(10);
        c.setIssuedAtToNow();
        c.setClaim("azp", GregOrderPlanJourneyProfile.CLIENT);
        c.setClaim("scope", "openid gcsp-api");
        c.setClaim("realm_access", Map.of("roles", List.of(role)));
        JsonWebSignature jws = new JsonWebSignature();
        jws.setPayload(c.toJson());
        jws.setKey(((RsaJsonWebKey) JsonWebKey.Factory.newJwk(jwk)).getPrivateKey());
        jws.setKeyIdHeaderValue("test-key-1");
        jws.setAlgorithmHeaderValue(AlgorithmIdentifiers.RSA_USING_SHA256);
        return jws.getCompactSerialization();
    }

    private String token(String sub, String role) throws Exception {
        return token(sub, role, jwk);
    }
}
