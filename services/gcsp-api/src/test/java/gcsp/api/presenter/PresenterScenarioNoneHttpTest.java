package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.ResultSet;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** The default provider none: nothing is ever seeded and the scenario controls answer 403. */
@QuarkusTest
@TestProfile(PresenterScenarioProfiles.None.class)
class PresenterScenarioNoneHttpTest {

    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    @Test
    void scenarioControlsAre403ForAPresenterAndNothingIsSeeded() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        String presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        String employee = PresenterClockSupport.token(signingJwk, "sub-employee", "employee");
        for (String path : new String[] {"/scenarios", "/scenarios/current"}) {
            get(presenter, path).then().statusCode(403).body("code", equalTo("scenarios-not-configured"))
                    .body("reason", equalTo("Scenario controls are not configured on this service."));
            get(employee, path).then().statusCode(403).body("code", equalTo("role-required"));
            get(null, path).then().statusCode(401);
        }
        post(presenter, "/scenarios/reset", "{}").then().statusCode(403).body("code", equalTo("scenarios-not-configured"));
        post(employee, "/scenarios/reset", "{}").then().statusCode(403).body("code", equalTo("role-required"));
        try (Connection c = PresenterClockProfiles.plain().getConnection()) {
            c.createStatement().execute("SET search_path TO " + schema);
            for (String table : new String[] {"employees", "employee_account_records", "entitlement_slots", "scenario_runs"}) {
                try (ResultSet rs = c.createStatement().executeQuery("SELECT count(*) FROM " + table)) {
                    rs.next();
                    assertEquals(0, rs.getLong(1), table);
                }
            }
        }
        // The clock is not a scenario control: it still answers on the active run.
        get(presenter, "/clock").then().statusCode(200);
    }
}
