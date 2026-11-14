package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
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

/** The employee claim routes end to end over the native test database, with one eligible car. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.Selecting.class)
class ManualClaimsHttpTest {

    static final String CLAIM = "/api/gcsp/v1/manual/claim";

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

    /** The employee, their one-unit slot and a released car, written straight to the app schema for the active run. */
    private String seed() throws SQLException {
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        String order = "ord-claims-" + UUID.randomUUID();
        update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                run.environmentId(), run.runId(), ClaimHttpProfiles.EMPLOYEE);
        update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity) "
                + "VALUES (?, ?, ?, ?, 1) ON CONFLICT DO NOTHING", run.environmentId(), run.runId(),
                "slot-" + ClaimHttpProfiles.EMPLOYEE, ClaimHttpProfiles.EMPLOYEE);
        update("INSERT INTO stock_cars (environment_id, run_id, order_uuid, configuration_id, state, attributes) "
                + "VALUES (?, ?, ?, 'cfg-1', 'released', ?::jsonb)", run.environmentId(), run.runId(), order,
                ClaimHttpPorts.FACTS.toString());
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

    @Test
    void claimReplayReadReviewAndReleaseRoundTrip() throws Exception {
        String order = seed();
        String command = "cmd-" + UUID.randomUUID();
        String body = claimBody(command, order);
        Response first = as().body(body).post(CLAIM);
        first.then().statusCode(200).body("status", equalTo("ok")).body("replayed", nullValue())
                .body("value.hold.orderUuid", equalTo(order)).body("value.hold.holdId", notNullValue());
        String holdId = first.path("value.hold.holdId");
        long version = ((Number) first.path("value.hold.version")).longValue();

        as().body(body).post(CLAIM).then().statusCode(200).body("replayed", equalTo(true))
                .body("value.hold.holdId", equalTo(holdId));
        String changed = body.replace("\"expectedStockVersion\":1", "\"expectedStockVersion\":2");
        as().body(changed).post(CLAIM).then().statusCode(409).body("code", equalTo("idempotency-input-changed"));
        as().body(body.replace("}", ",\"extra\":1}")).post(CLAIM).then().statusCode(400)
                .body("status", equalTo("invalid"));

        as().get(CLAIM).then().statusCode(200).body("value.hold.holdId", equalTo(holdId));

        Response review = as().body(actionBody("rev-" + command, holdId, version, null)).post(CLAIM + "/review");
        review.then().statusCode(200).body("value.hold.phase", equalTo("order-review"));
        long reviewed = ((Number) review.path("value.hold.version")).longValue();

        as().body(actionBody("rel-" + command, holdId, reviewed, "cancel")).post(CLAIM + "/release").then()
                .statusCode(200).body("value.hold.holdId", equalTo(holdId));
        assertEquals(0, count("SELECT count(*) FROM custody_holds WHERE hold_id = ? AND state = 'active'", holdId));
    }

    @Test
    void aSecondClaimOnTheSameCarIsRefusedAndNothingIsHeldTwice() throws Exception {
        String order = seed();
        String first = "cmd-" + UUID.randomUUID();
        Response ok = as().body(claimBody(first, order)).post(CLAIM);
        ok.then().statusCode(200);
        String holdId = ok.path("value.hold.holdId");
        try {
            as().body(claimBody("cmd-" + UUID.randomUUID(), order)).post(CLAIM).then().statusCode(409)
                    .body("status", equalTo("conflict")).body("view.state", equalTo("conflict"));
            assertEquals(1, count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state = 'active'", order));
        } finally {
            long version = ((Number) ok.path("value.hold.version")).longValue();
            as().body(actionBody("rel-" + first, holdId, version, "cancel")).post(CLAIM + "/release");
        }
    }

    @Test
    void aNonObjectBodyIsInvalid() {
        as().body("[1]").post(CLAIM).then().statusCode(400).body("code", equalTo("invalid-manual-claim"));
        as().body("").post(CLAIM + "/release").then().statusCode(400).body("status", equalTo("invalid"));
    }

    private long count(String sql, Object... params) throws SQLException {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) ps.setObject(i + 1, params[i]);
            try (var rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }
}
