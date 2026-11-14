package gcsp.api.returns;

import static gcsp.api.returns.ReturnHttpSupport.ACCEPT;
import static gcsp.api.returns.ReturnHttpSupport.PLAN;
import static gcsp.api.returns.ReturnHttpSupport.PROGRESS;
import static gcsp.api.returns.ReturnHttpSupport.REQUEST;
import static gcsp.api.returns.ReturnHttpSupport.as;
import static gcsp.api.returns.ReturnHttpSupport.orderId;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.ValidatableResponse;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The return plan over HTTP with the synthetic provider, four OIDC identities and the native test database. */
@QuarkusTest
@TestProfile(ReturnHttpProfiles.Synthetic.class)
class ReturnHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ReturnHttpPorts.Source source;

    @Inject
    ReturnHttpPorts.Handover handover;

    private String alice;
    private String bob;
    private String greg;
    private String presenter;

    @BeforeEach
    void identities() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        alice = ReturnHttpSupport.token(jwk, "sub-employee-a", "employee");
        bob = ReturnHttpSupport.token(jwk, "sub-employee-b", "employee");
        greg = ReturnHttpSupport.token(jwk, "sub-greg", "greg");
        presenter = ReturnHttpSupport.token(jwk, "sub-presenter", "presenter");
    }

    /** A replacement order owned by E-1001 with a scheduled handover a few days after the clock. */
    private String order() throws Exception {
        Instant now = ReturnHttpSupport.tick(dataSource.get(), persistence, 60);
        String id = orderId();
        source.put(InMemoryReturnSource.replacement(id, ReturnHttpSupport.EMPLOYEE_A));
        handover.put(id, new HandoverReading.Found("scheduled", ReturnHttpSupport.handoverSlot(now), "SYN-APT-HANDOVER"));
        return id;
    }

    private JsonPath read(String token, String order) {
        return new JsonPath(as(token).queryParam("orderUuid", order).get(PLAN).then().statusCode(200).extract().asString());
    }

    private static String request(String commandId, String order, String slot, long version) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + order + "\",\"choice\":\"same-visit\","
                + "\"slotId\":\"" + slot + "\",\"expectedVersion\":" + version + "}";
    }

    private static void json(ValidatableResponse r) {
        r.contentType(containsString("application/json"));
    }

    @Test
    void noTokenIs401Json() {
        json(given().queryParam("orderUuid", "x").get(PLAN).then().statusCode(401));
        json(given().contentType("application/json").body("{}").post(REQUEST).then().statusCode(401));
        json(given().contentType("application/json").body("{}").post(PROGRESS).then().statusCode(401));
    }

    @Test
    void anEmployeeReadsHerOwnPlanAndNobodyElsesEmployeeDoes() throws Exception {
        String order = order();
        JsonPath own = read(alice, order);
        assertEquals("ok", own.getString("status"));
        assertEquals("not-planned", own.getString("value.state"));
        assertEquals(0, own.getInt("value.version"));
        json(as(bob).queryParam("orderUuid", order).get(PLAN).then().statusCode(403)
                .body("status", equalTo("forbidden")).body("code", equalTo("not-resource-owner"))
                .body("value", equalTo(null)).body("plan", equalTo(null)));
        read(greg, order);
        read(presenter, order);
    }

    @Test
    void anUnknownQueryOrOrderIsRefusedAsJson() throws Exception {
        String order = order();
        json(as(alice).queryParam("orderUuid", order).queryParam("employeeId", "E-1002").get(PLAN).then()
                .statusCode(400).body("code", equalTo("unsupported-query")));
        json(as(alice).get(PLAN).then().statusCode(400).body("code", equalTo("invalid-return-command"))
                .body("reasons.field", hasItem("orderUuid")));
        json(as(alice).queryParam("orderUuid", "no-such-" + order).get(PLAN).then().statusCode(404)
                .body("status", equalTo("not-found")));
    }

    @Test
    void aRequestIsRecordedReplayedAndGuarded() throws Exception {
        String order = order();
        String slot = read(alice, order).getString("value.offeredSlots.'same-visit'[0].slotId");
        String cmd = "http-" + order;
        JsonPath first = new JsonPath(as(alice).body(request(cmd, order, slot, 0)).post(REQUEST).then().statusCode(200)
                .body("status", equalTo("ok")).extract().asString());
        assertEquals("return-requested", first.getString("value.state"));
        long version = first.getLong("value.version");

        String replay = as(alice).body(request(cmd, order, slot, 0)).post(REQUEST).then().statusCode(200).extract().asString();
        assertEquals(first.prettify(), new JsonPath(replay).prettify());

        json(as(alice).body(request(cmd, order, slot, 7)).post(REQUEST).then().statusCode(409)
                .body("status", equalTo("conflict")));
        json(as(alice).body(request("other-" + cmd, order, slot, version + 5).replace("same-visit", "separate")).post(REQUEST).then().statusCode(409)
                .body("status", equalTo("conflict")).body("currentVersion", equalTo((int) version))
                .body("plan.state", equalTo("return-requested")));
        json(as(presenter).body(request("p-" + cmd, order, slot, 0)).post(REQUEST).then().statusCode(403)
                .body("code", equalTo("role-required")));
        json(as(greg).body(request("g-" + cmd, order, slot, 0)).post(REQUEST).then().statusCode(403));
        json(as(bob).body(request("b-" + cmd, order, slot, 0)).post(REQUEST).then().statusCode(403)
                .body("code", equalTo("not-resource-owner")));
    }

    @Test
    void aBadRequestBodyIs400WithFieldReasons() throws Exception {
        String order = order();
        json(as(alice).body("{\"orderUuid\":\"" + order + "\",\"choice\":\"same-visit\",\"slotId\":\"s\",\"expectedVersion\":0}")
                .post(REQUEST).then().statusCode(400).body("status", equalTo("invalid"))
                .body("code", equalTo("invalid-return-command")).body("reasons.field", hasItem("commandId")));
        json(as(alice).body("{\"commandId\":\"c\",\"orderUuid\":\"o\",\"choice\":\"x\",\"slotId\":\"s\",\"expectedVersion\":0,"
                + "\"employeeId\":\"E-1002\"}").post(REQUEST).then().statusCode(400)
                .body("reasons.field", hasItem("employeeId")));
        json(as(alice).body("{not json").post(REQUEST).then().statusCode(400).body("code", equalTo("invalid-return-command")));
        json(as(alice).body("{\"commandId\":\"c\",\"orderUuid\":\"o\"}").post(ACCEPT).then().statusCode(400)
                .body("reasons.field", hasItem("proposalId")).body("reasons.field", hasItem("expectedVersion")));
        json(as(presenter).body("{\"commandId\":\"c\",\"extra\":1}").post(PROGRESS).then().statusCode(400)
                .body("reasons.field", hasItem("extra")));
    }

    @Test
    void thePresenterProgressMovesTheRequestToScheduled() throws Exception {
        String order = order();
        String slot = read(alice, order).getString("value.offeredSlots.'same-visit'[0].slotId");
        as(alice).body(request("c-" + order, order, slot, 0)).post(REQUEST).then().statusCode(200);
        json(as(alice).body("{\"commandId\":\"p-1\"}").post(PROGRESS).then().statusCode(403)
                .body("code", equalTo("role-required")));
        json(as(greg).body("{\"commandId\":\"p-1\"}").post(PROGRESS).then().statusCode(403));

        ReturnHttpSupport.tick(dataSource.get(), persistence, 1800);
        as(presenter).body("{\"commandId\":\"p-2\"}").post(PROGRESS).then().statusCode(200)
                .body("status", equalTo("ok")).body("value.applied", notNullValue()).body("value.failed", notNullValue());
        JsonPath after = read(alice, order);
        assertEquals("return-scheduled", after.getString("value.state"));
    }

    @Test
    void theReadinessCheckReportsTheModesAndOpenOperations() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'returns' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'returns' }.data.provider", equalTo("synthetic"))
                .body("checks.find { it.name == 'returns' }.data.policy", equalTo("file"))
                .body("checks.find { it.name == 'returns' }.data.source", equalTo("test"))
                .body("checks.find { it.name == 'returns' }.data.handover", equalTo("test"))
                .body("checks.find { it.name == 'returns' }.data.openOperations", notNullValue());
    }
}
