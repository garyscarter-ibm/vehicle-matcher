package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** GET manual/quote and GET/POST manual/review-details end to end over the native test database. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.Selecting.class)
class ManualReviewDetailsHttpTest {

    static final String CLAIM = "/api/gcsp/v1/manual/claim";
    static final String QUOTE = "/api/gcsp/v1/manual/quote";
    static final String DETAILS = "/api/gcsp/v1/manual/review-details";
    private static final String DRAFT = "{\"mode\":\"replacement\",\"oldContractId\":\"c-1\",\"requestedCollectionDate\":"
            + "\"2026-12-01\",\"collectionLocationId\":\"loc-1\",\"contact\":{\"phone\":\"01632 960000\",\"email\":\"a@b.cd\"}}";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + ClaimHttpProfiles.TOKEN).contentType("application/json");
    }

    private void update(String sql, Object... params) throws SQLException {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            ps.executeUpdate();
        }
    }

    /** The employee, slot, complete draft 1 and a released car, written straight to the app schema for the active run. */
    private String seed() throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        String order = "ord-review-" + UUID.randomUUID();
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                run.environmentId(), run.runId(), ClaimHttpProfiles.EMPLOYEE);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, 1) ON CONFLICT DO NOTHING", run.environmentId(), run.runId(),
                "slot-" + ClaimHttpProfiles.EMPLOYEE, ClaimHttpProfiles.EMPLOYEE);
        update("INSERT INTO manual_drafts (environment_id, run_id, employee_id, draft_version, value) VALUES (?, ?, ?, 1, "
                + "?::jsonb) ON CONFLICT DO NOTHING", run.environmentId(), run.runId(), ClaimHttpProfiles.EMPLOYEE,
                "{\"runId\":\"" + run.runId() + "\",\"employeeId\":\"" + ClaimHttpProfiles.EMPLOYEE + "\","
                + "\"entitlementSlotId\":\"slot-" + ClaimHttpProfiles.EMPLOYEE + "\",\"draftStage\":\"complete\","
                + "\"draftVersion\":1,\"policyVersion\":\"" + ClaimHttpProfiles.VERSION + "\",\"choices\":" + DRAFT + "}");
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, 'cfg-1', 'released', ?::jsonb)", run.environmentId(), run.runId(), order,
                "{\"colour\":\"red\",\"orderNumber\":\"1234567\"}");
        return order;
    }

    private static String claimBody(String commandId, String order) {
        return "{\"commandId\":\"" + commandId + "\",\"orderUuid\":\"" + order + "\",\"expectedStockVersion\":1,"
                + "\"expectedDraftVersion\":1,\"expectedContextVersion\":\"ctx-1\",\"expectedTermsDigest\":\""
                + ManualClaims.termsDigest(ClaimHttpProfiles.VERSION, ClaimHttpPorts.TERMS) + "\"}";
    }

    private static String actionBody(String commandId, String holdId, long version, String reason) {
        return "{\"commandId\":\"" + commandId + "\",\"holdId\":\"" + holdId + "\",\"expectedHoldVersion\":" + version
                + ",\"expectedDraftVersion\":1" + (reason == null ? "" : ",\"reason\":\"" + reason + "\"") + "}";
    }

    private static String saveBody(String commandId, String holdId, long holdVersion, long detailsVersion, String text) {
        return "{\"commandId\":\"" + commandId + "\",\"holdId\":\"" + holdId + "\",\"quoteId\":\""
                + ManualClaims.quoteId(holdId) + "\",\"expectedHoldVersion\":" + holdVersion
                + ",\"expectedDraftVersion\":1,\"expectedReviewDetailsVersion\":" + detailsVersion + ",\"details\":{"
                + "\"contact\":{\"phone\":\"01632 960000\",\"email\":\"a@b.cd\"},\"expectedReturnMileage\":12000,"
                + "\"specialRequirements\":\"" + text + "\"}}";
    }

    /** The claim read stamps the wall clock, so two reads differ only by now. */
    private static com.fasterxml.jackson.databind.JsonNode withoutNow(String json) throws Exception {
        com.fasterxml.jackson.databind.JsonNode n = new com.fasterxml.jackson.databind.ObjectMapper().readTree(json);
        ((com.fasterxml.jackson.databind.node.ObjectNode) n.get("value")).remove("now");
        return n;
    }

    @Test
    void quoteIsTheClaimReadAndReviewDetailsReadAndSaveRoundTrip() throws Exception {
        String order = seed();
        String command = "cmd-" + UUID.randomUUID();
        Response claimed = as().body(claimBody(command, order)).post(CLAIM);
        claimed.then().statusCode(200);
        String holdId = claimed.path("value.hold.holdId");
        long version = ((Number) claimed.path("value.hold.version")).longValue();
        try {
            as().get(QUOTE).then().statusCode(200).body("status", equalTo("ok"))
                    .body("value.hold.holdId", equalTo(holdId)).body("value.quote.quoteId", equalTo(ManualClaims.quoteId(holdId)));
            assertEquals(withoutNow(as().get(CLAIM).asString()), withoutNow(as().get(QUOTE).asString()),
                    "the same body as the claim read");

            Response review = as().body(actionBody("rev-" + command, holdId, version, null)).post(CLAIM + "/review");
            review.then().statusCode(200);
            long reviewed = ((Number) review.path("value.hold.version")).longValue();

            as().get(DETAILS).then().statusCode(200).body("status", equalTo("ok"))
                    .body("value.reviewDetailsVersion", equalTo(0)).body("value.orderNumber", equalTo("1234567"))
                    .body("value.mode", equalTo("replacement")).body("value.view.state", equalTo("review"))
                    .body("value.constraints.maximumSpecialRequirements", equalTo(500))
                    .body("value.binding.holdId", equalTo(holdId)).body("value.editable", equalTo(true));

            String body = saveBody("save-" + command, holdId, reviewed, 0, "Call first");
            as().body(body).post(DETAILS).then().statusCode(200).body("value.reviewDetailsVersion", equalTo(1))
                    .body("value.details.specialRequirements", equalTo("Call first"));
            as().body(body).post(DETAILS).then().statusCode(200).body("value.reviewDetailsVersion", equalTo(1));
            as().body(body.replace("Call first", "Other")).post(DETAILS).then().statusCode(409)
                    .body("code", equalTo("idempotency-input-changed"));
            as().body(saveBody("save2-" + command, holdId, reviewed, 0, "Stale")).post(DETAILS).then().statusCode(409)
                    .body("status", equalTo("stale-version")).body("code", equalTo("stale-review-details"))
                    .body("currentVersion", equalTo(1));
            as().body(saveBody("save3-" + command, holdId, reviewed, 1, "x".repeat(501))).post(DETAILS).then().statusCode(400)
                    .body("status", equalTo("invalid")).body("reasons[0].field", equalTo("specialRequirements"));
            as().body("[1]").post(DETAILS).then().statusCode(400).body("code", equalTo("invalid-review-details"));
            as().get(DETAILS).then().statusCode(200).body("value.reviewDetailsVersion", equalTo(1))
                    .body("value.details.expectedReturnMileage", equalTo(12000));
            reviewed = ((Number) as().get(CLAIM).path("value.hold.version")).longValue();
            version = reviewed;
        } finally {
            as().body(actionBody("rel-" + command, holdId, version, "cancel")).post(CLAIM + "/release");
        }
        as().get(DETAILS).then().statusCode(200).body("value.view.state", equalTo("released"))
                .body("value.editable", equalTo(false));
    }

    @Test
    void withoutAClaimTheDetailsAreNotFoundAndAQueryIsRefused() throws Exception {
        Response none = as().get(DETAILS);
        if (none.statusCode() == 404) none.then().body("status", equalTo("not-found")).body("view.state", equalTo("no-claim"));
        as().queryParam("employeeId", "x").get(DETAILS).then().statusCode(400).body("code", equalTo("unsupported-query"));
        as().queryParam("employeeId", "x").body("{}").post(DETAILS).then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        as().queryParam("a", "b").get(QUOTE).then().statusCode(400).body("code", equalTo("unsupported-query"));
        given().get(DETAILS).then().statusCode(401);
        given().get(QUOTE).then().statusCode(401);
        as().get(DETAILS).then().body("status", notNullValue());
    }
}
