package gcsp.api.account;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Shared checks for the documented dev composition: persistence, oidc, demo seeding and synthetic ordering. */
abstract class AccountDevCompositionBase {

    static final String PATH = "/api/gcsp/v1/manual/account";
    static final Map<String, String> SUBJECTS = Map.of("paula", "sub-paula", "alex", "sub-alex", "sam", "sub-sam",
            "jordan", "sub-jordan");

    /** state/contractState/ordering.enabled; sam's scheme is not orderable by policy, an explicit state, not a refusal. */
    static final Map<String, String> STATES = Map.of("paula", "ready/current-contract/true",
            "alex", "ready/current-contract/true", "sam", "unsupported-scheme/current-contract/false",
            "jordan", "ready/no-contract/true");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    /** The injected name, because the profile's static name can differ between class loaders. */
    static String ownedSchema;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AccountPolicyPort policy;

    @Inject
    AccountClockPort clock;

    @Inject
    CurrentCarPort cars;

    @BeforeEach
    void requireDatabase() {
        ownedSchema = schema;
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    /** The records port of the other provider shape, reading the same demo people. */
    abstract AccountRecordsPort otherShape() throws Exception;

    final Response get(String sub, String role, String path) throws Exception {
        return given().header("Authorization", "Bearer " + AccountDevCompositionSupport.token(signingJwk, sub, role)).when()
                .get(path);
    }

    final JsonNode httpValue(String employee) throws Exception {
        String body = get(SUBJECTS.get(employee), "employee", PATH).then().statusCode(200).body("status", equalTo("ok"))
                .extract().asString();
        return GoldenFixture.JSON.readTree(body).get("value");
    }

    final JsonNode inProcessValue(AccountRecordsPort records, String employee) {
        AccountScope scope = new AccountScope(AccountDevCompositionProfiles.ENV, AccountDevCompositionProfiles.RUN,
                "employee-" + employee, null, List.of("employee"), null, null, null, null, "gcsp-policy-v1");
        AccountOutcome outcome = new AccountService(records, policy, clock, cars).readAccount(scope);
        assertTrue(outcome.isOk(), String.valueOf(outcome.refusal()));
        return outcome.value();
    }

    @Test
    void everyDemoEmployeeGetsTheProjectionWithItsFactsAndProvenance() throws Exception {
        for (String employee : AccountDevCompositionSupport.EMPLOYEES) {
            JsonNode v = httpValue(employee);
            String id = "employee-" + employee;
            assertEquals(id, v.at("/account/employeeId").asText(), employee);
            assertEquals(STATES.get(employee), v.get("state").asText() + "/" + v.get("contractState").asText() + "/"
                    + v.get("slots").get(0).at("/ordering/enabled").asText(), employee + " state/contract/ordering");
            assertFalse(v.get("drivers").isEmpty(), employee + " drivers");
            assertFalse(v.get("slots").isEmpty(), employee + " slots");
            assertEquals("synthetic", v.at("/versions/employeeContract/mode").asText(), employee);
            assertEquals("synthetic", v.at("/versions/driver/mode").asText(), employee);
            assertEquals(id, v.at("/versions/recordSetId").asText().split(":")[1], employee);
            assertTrue(v.has("currentContract") && v.has("contractState"), employee);
            assertFalse(v.has("currentCarRelationships"), employee);
            assertFalse(v.toString().contains("policy-not-configured"), employee);
            assertFalse(v.get("choices").isNull(), employee + " policy-backed choices");
            assertFalse(v.get("allowance").isNull(), employee + " allowance");
        }
    }

    @Test
    void aDifferentlyShapedSourceGivesTheSameProjection() throws Exception {
        AccountRecordsPort other = otherShape();
        for (String employee : AccountDevCompositionSupport.EMPLOYEES) {
            assertEquals(inProcessValue(other, employee), httpValue(employee), employee);
        }
    }

    @Test
    void gregIsRefusedByRole() throws Exception {
        get("sub-greg", "greg", PATH).then().statusCode(403).body("code", equalTo("role-required"))
                .body("status", equalTo("forbidden")).body(not(containsString("value")));
    }

    @Test
    void aRecordedCurrentCarRelationshipIsListedAndThenAbsentAgain() throws Exception {
        String order = "order-dev-composition-1";
        try (Connection c = dataSource.get().getConnection()) {
            RepositoryFixture.update(c, "INSERT INTO current_car_relationships (environment_id, run_id, order_uuid, employee_id, "
                    + "old_contract_id, old_slot_id, old_status, new_configuration_id, new_status) "
                    + "VALUES (?, ?, ?, 'employee-paula', 'current:employee-paula', 'slot-paula', 'held', 'cfg-x', 'on-order')",
                    AccountDevCompositionProfiles.ENV, AccountDevCompositionProfiles.RUN, order);
            try {
                JsonNode list = httpValue("paula").get("currentCarRelationships");
                assertEquals(1, list.size());
                assertEquals("lifecycle.current-car.v1", list.get(0).get("contractVersion").asText());
                assertEquals(order, list.get(0).get("orderUuid").asText());
                assertEquals("employee-paula", list.get(0).get("employeeId").asText());
                assertEquals("current:employee-paula", list.get(0).at("/currentCar/contractId").asText());
                assertFalse(httpValue("alex").has("currentCarRelationships"));
            } finally {
                // The relationship guard forbids deletes, so the test row is removed with triggers off.
                try (Statement st = c.createStatement()) {
                    st.execute("SET session_replication_role = replica");
                    st.execute("DELETE FROM current_car_relationships WHERE order_uuid = '" + order + "'");
                    st.execute("RESET session_replication_role");
                }
            }
        }
        assertFalse(httpValue("paula").has("currentCarRelationships"));
    }

    @Test
    void orderingAndDraftNowReachTheAccountProjection() throws Exception {
        Response order = get("sub-paula", "employee", "/api/gcsp/v1/manual/order");
        String code = order.then().extract().jsonPath().getString("code");
        assertFalse(order.statusCode() == 503 && "account-unavailable".equals(code), order.asString());
        // The demo people have no selection yet, so the read is an explicit 404 not-found.
        assertEquals(404, order.statusCode());
        assertEquals("not-found", code);
        get("sub-paula", "employee", "/api/gcsp/v1/manual/draft").then().statusCode(200);
    }

    static java.nio.file.Path export(String name) {
        return java.nio.file.Path.of("target", "account-dev", name).toAbsolutePath();
    }
}
