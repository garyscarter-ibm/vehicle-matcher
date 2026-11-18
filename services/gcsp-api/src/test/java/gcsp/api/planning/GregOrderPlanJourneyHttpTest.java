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
import java.time.OffsetDateTime;
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
 * would call them not-yet-available. The account window in the demo preparation ends 2026-12-01, so the claim step
 * needs a run before that date.
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
        assertEquals(6, plan.at("/unallocatedStockRisk/bySource").size());
        assertFalse(plan.at("/unboundStock").isMissingNode());

        // Supported quantities, coverage and risk, alternatives and explanations are all present.
        assertEquals(5, plan.get("quantities").size());
        assertEquals(4, plan.get("modelQuantities").size());
        assertTrue(plan.get("expectedAcceptableCoverage").has("covered"));
        assertTrue(plan.get("unallocatedStockRisk").has("quantity"));
        assertEquals(List.of("zero-new-orders-baseline", "next-best-distinct-feasible"), kinds(plan.get("alternatives")));
        assertTrue(plan.get("bindingConstraints").size() > 0);
        assertTrue(plan.at("/objective/tradeOff").asText().length() > 0);
        assertEquals(1, plan.get("unmetNeeds").size(), "the brief's unmet need is explained, not dropped");
        assertTrue(plan.at("/unmetNeeds/0/gates").size() > 0);
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
        assertEquals(2, plan.get("unmetNeeds").size());

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
        saveDraft(paula);
        JsonNode eligible = null;
        for (JsonNode d : get(paula, API + "/manual/stock").body().at("/value/decisions")) {
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
        JsonNode hold = claim.body().at("/value/hold");
        holdId = hold.get("holdId").asText();
        assertEquals("cart", text("SELECT hold_type FROM custody_holds WHERE hold_id = ?", holdId));
        String stockBefore = firstPlanVersion("stock");

        // The held car is held for Paula's slot, and the plan still reads while the run clock is at its release cue.
        Resp held = get(greg, PLAN);
        assertEquals(200, held.status(), held.toString());
        assertNotEquals(stockBefore, held.body().at("/value/plan/versions/stock").asText(), "the hold is part of the stock version");
        assertEquals("slot-paula", heldFor(heldCar));

        // The real presenter route moves the run clock two days on; the wall-stamped hold now ends before run time.
        JsonNode clock = get(presenter, API + "/presenter/clock").body().get("value");
        Resp advance = post(presenter, API + "/presenter/clock/advance", "{\"commandId\":\"" + cmd() + "\",\"expectedClockVersion\":"
                + clock.get("clockVersion") + ",\"bySeconds\":172800}");
        assertEquals(200, advance.status(), advance.toString());
        Instant runNow = runClockNow();
        Instant expires = instant("SELECT expires_at FROM custody_holds WHERE hold_id = ?", holdId);
        assertTrue(expires.isBefore(runNow), "control: the old rule would call this hold expired: " + expires + " < " + runNow);
        assertTrue(runNow.isAfter(Instant.now().plusSeconds(86_400)), "the run clock is ahead of wall time");

        Resp after = get(greg, PLAN);
        assertEquals(200, after.status(), "the read must not be refused as planning-held-stock-unresolved: " + after);
        assertEquals("ok", after.body().get("status").asText());
        assertEquals(PolicyClock.iso(runNow), after.body().at("/value/plan/asOf").asText());
        assertEquals("slot-paula", heldFor(heldCar), "the car is still held for the claimant's slot");

        // The real release route lets the car go, and the plan stops showing it held.
        Resp release = post(paula, API + "/manual/claim/release", M.createObjectNode().put("commandId", cmd()).put("holdId", holdId)
                .put("expectedHoldVersion", hold.get("version").asLong()).put("expectedDraftVersion", 1).put("reason", "cancel").toString());
        assertEquals(200, release.status(), release.toString());
        assertEquals(200, get(greg, PLAN).status());
        assertNull(heldFor(heldCar), "a released car is no longer held");
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

    /** A complete manual draft for Paula, dated at the end of her own collection window. */
    private void saveDraft(String paula) throws Exception {
        JsonNode account = get(paula, API + "/manual/account").body();
        String latest = account.findValue("latestCollectionDate").asText();
        ObjectNode choices = StockDbFixture.complete();
        choices.put("slotId", "slot-paula").put("driverId", "driver:employee-paula").put("oldContractId", "current:employee-paula")
                .put("requestedCollectionDate", latest);
        ((ObjectNode) choices.get("contact")).put("email", "paula@gcsp-demo.com");
        ObjectNode in = M.createObjectNode().put("commandId", cmd()).put("expectedDraftVersion", 0)
                .put("expectedContextVersion", account.at("/value/contextVersion").asText());
        in.set("choices", choices);
        Resp saved = post(paula, API + "/manual/draft", in.toString());
        assertEquals(200, saved.status(), "the demo account window must still be open (ends " + latest + "): " + saved);
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
