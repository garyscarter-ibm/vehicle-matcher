package gcsp.api.cases;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/** The renewal case endpoints over HTTP as one ordered scenario on the shared test database. */
@QuarkusTest
@TestProfile(CaseHttpProfile.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CaseHttpTest {

    private static final String ENV = "test-app-env";
    private static final String BASE = "/api/gcsp/v1";
    private static final String HELP = BASE + "/help";
    private static final String CASES = BASE + "/cases";
    private static final String TEAM = BASE + "/scheme-team/cases";
    private static final String OPTIONS = TEAM + "/options";
    private static final String UPDATE = TEAM + "/update";

    /** Set by the request step and read by the later steps. */
    private static String caseId;
    private static int inProgressVersion;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    CaseServiceHolder holder;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    private RequestSpecification as(String subject, String role) throws Exception {
        return given().header("Authorization", "Bearer " + CaseHttpProfile.bearer(signingJwk, subject, role))
                .accept(ContentType.JSON);
    }

    private RequestSpecification employeeA() throws Exception {
        return as(CaseHttpProfile.SUB_A, "employee");
    }

    private RequestSpecification employeeB() throws Exception {
        return as(CaseHttpProfile.SUB_B, "employee");
    }

    private RequestSpecification greg() throws Exception {
        return as(CaseHttpProfile.SUB_GREG, "greg");
    }

    private RequestSpecification presenter() throws Exception {
        return as(CaseHttpProfile.SUB_PRESENTER, "presenter");
    }

    /** A command id unique to this JVM, so a rerun on the shared database never replays an old receipt. */
    private static String id(String label) {
        return label + "-" + CaseHttpProfile.TAG;
    }

    private static String updateBody(String commandId, int expectedVersion, String status, ObjectNode remedy) {
        ObjectNode n = CaseJson.obj().put("commandId", commandId).put("caseId", caseId)
                .put("expectedVersion", expectedVersion).put("status", status)
                .put("reason", "Scheme team reviewed the renewal.").put("nextAction", "Review options with Paula.")
                .put("dueAt", "2030-01-01T00:00:00.000Z");
        if (remedy != null) n.set("remedy", remedy);
        return n.toString();
    }

    @Test
    @Order(0)
    void productionWiringResolvesWithPersistence() {
        assertTrue(holder.service().isPresent());
    }

    @Test
    @Order(1)
    void everyEndpointRefusesAMissingBearer() {
        for (String path : List.of(HELP, CASES, TEAM, OPTIONS)) {
            given().get(path).then().statusCode(401).contentType(containsString("application/json"))
                    .body("code", equalTo("bearer-missing"));
        }
        given().post(CASES).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
        given().post(UPDATE).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
    }

    @Test
    @Order(2)
    void employeeAReadsHelpThatOpensNothing() throws Exception {
        employeeA().get(HELP).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.opensCase", equalTo(false))
                .body("value.automaticRecoveryPriority", equalTo(false))
                .body("value.ownerRole", equalTo("scheme-team"));
    }

    @Test
    @Order(3)
    void employeeAOpensOneCaseAndAReplayChangesNothing() throws Exception {
        String commandId = id("open");
        String request = CaseHarness.request(commandId, "My replacement may miss my contract end.").toString();
        Response opened = employeeA().contentType(ContentType.JSON).body(request).post(CASES);
        opened.then().statusCode(200).body("status", equalTo("ok")).body("replayed", nullValue())
                .body("value.case.status", equalTo("open"))
                .body("value.case.employeeId", equalTo(CaseHttpProfile.EMPLOYEE_A))
                .body("value.case.owner.role", equalTo("scheme-team"))
                .body("value.case.renewalDeadline", equalTo("2026-12-01"));
        caseId = opened.jsonPath().getString("value.case.caseId");

        employeeA().contentType(ContentType.JSON).body(request).post(CASES).then().statusCode(200)
                .body("replayed", equalTo(true)).body("value.case.caseId", equalTo(caseId));

        String changed = CaseHarness.request(commandId, "A different reason.").toString();
        employeeA().contentType(ContentType.JSON).body(changed).post(CASES).then().statusCode(409)
                .body("code", equalTo("command-input-changed"));
    }

    @Test
    @Order(4)
    void employeeAReadsOnlyHerOwnCaseAndEmployeeBCannotReadIt() throws Exception {
        employeeA().get(CASES).then().statusCode(200).body("value.cases.size()", equalTo(1))
                .body("value.cases[0].caseId", equalTo(caseId));
        employeeA().get(CASES + "?caseId=" + caseId).then().statusCode(200)
                .body("value.case.caseId", equalTo(caseId));
        employeeB().get(CASES + "?caseId=" + caseId).then().statusCode(403)
                .body("code", equalTo("not-resource-owner"));
        employeeB().get(CASES).then().statusCode(200).body("value.cases.size()", equalTo(0));
        employeeA().get(CASES + "?other=1").then().statusCode(400).body("status", equalTo("invalid"))
                .body("code", equalTo("unsupported-query")).body("reasons[0].field", equalTo("query"));
    }

    @Test
    @Order(5)
    void theRoleRulesHoldOnEveryEndpoint() throws Exception {
        employeeA().get(TEAM).then().statusCode(403).body("code", equalTo("role-required"));
        presenter().get(TEAM).then().statusCode(403).body("code", equalTo("role-required"));
        presenter().get(OPTIONS + "?caseId=" + caseId).then().statusCode(403)
                .body("code", equalTo("role-required"));
        presenter().contentType(ContentType.JSON).body("{}").post(UPDATE).then().statusCode(403)
                .body("code", equalTo("role-required"));
        greg().get(HELP).then().statusCode(403).body("code", equalTo("role-required"));
        greg().contentType(ContentType.JSON).body("{}").post(CASES).then().statusCode(403)
                .body("code", equalTo("role-required"));
    }

    @Test
    @Order(6)
    void gregSeesTheCaseWithTheEmployeeNameAndItsOptions() throws Exception {
        greg().get(TEAM).then().statusCode(200)
                .body("value.cases.find { it.caseId == '" + caseId + "' }.employeeName", equalTo("Paula Example"));
        greg().get(OPTIONS + "?caseId=" + caseId).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.nextStatuses", equalTo(List.of("in-progress", "closed")))
                .body("value.automaticRecoveryPriority", equalTo(false))
                .body("value.options.contractExtension.available", equalTo(false))
                .body("value.options.manualDecision.available", equalTo(true));
    }

    @Test
    @Order(7)
    void gregMovesTheCaseOnRefusesAStaleVersionAndRecordsARemedy() throws Exception {
        int current = greg().get(OPTIONS + "?caseId=" + caseId).then().statusCode(200).extract().jsonPath()
                .getInt("value.case.version");
        Response moved = greg().contentType(ContentType.JSON)
                .body(updateBody(id("in-progress"), current, "in-progress", null)).post(UPDATE);
        moved.then().statusCode(200).body("value.case.status", equalTo("in-progress"));
        inProgressVersion = moved.jsonPath().getInt("value.case.version");
        assertEquals(current + 1, inProgressVersion);

        greg().contentType(ContentType.JSON).body(updateBody(id("stale"), current, "in-progress", null)).post(UPDATE)
                .then().statusCode(409).body("status", equalTo("stale-version"))
                .body("code", equalTo("stale-version")).body("expectedVersion", equalTo(current))
                .body("currentVersion", equalTo(inProgressVersion));

        greg().contentType(ContentType.JSON)
                .body(updateBody(id("resolved"), inProgressVersion, "resolved", CaseHarness.manual("Agreed with Paula")))
                .post(UPDATE).then().statusCode(200).body("value.case.status", equalTo("resolved"));

        employeeA().get(CASES + "?caseId=" + caseId).then().statusCode(200)
                .body("value.case.status", equalTo("resolved"))
                .body("value.case.remedy.type", equalTo("manual-decision"))
                .body("value.case.remedy.decision", equalTo("Agreed with Paula"));
    }

    @Test
    @Order(8)
    void aMalformedRequestIsRefusedBeforeAnyWork() throws Exception {
        employeeA().contentType(ContentType.JSON).body("{\"commandId\":").post(CASES).then().statusCode(400)
                .body("status", equalTo("invalid")).body("code", equalTo("invalid-case-command"))
                .body("reasons[0].field", equalTo("body"));
    }

    @Test
    @Order(9)
    void theUpdateQueuedExactlyOneOutboxEventForItsVersion() throws Exception {
        String sql = "SELECT count(*) FROM gcsp_app.outbox_events WHERE environment_id = ? "
                + "AND event_type = 'renewal-case-update' AND payload->'caseUpdate'->>'caseId' = ? "
                + "AND (payload->'caseUpdate'->>'caseVersion')::bigint = ?";
        try (Connection c = DriverManager.getConnection(CaseHttpProfile.URL);
                PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ENV);
            ps.setString(2, caseId);
            ps.setLong(3, inProgressVersion);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                assertEquals(1L, rs.getLong(1));
            }
        }
    }
}
