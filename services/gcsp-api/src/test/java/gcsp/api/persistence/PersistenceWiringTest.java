package gcsp.api.persistence;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Needs GCSP_TEST_DATABASE_URL (the profile writes into schema gcsp_app of the throwaway test database). */
@QuarkusTest
@TestProfile(PersistenceProfile.class)
class PersistenceWiringTest {

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    Persistence persistence;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @Test
    void flywayAppliedV1IntoGcspAppAndTheGuardClaimedIdentityAndFirstRun() throws Exception {
        try (Connection c = dataSource.get().getConnection(); Statement st = c.createStatement()) {
            ResultSet rs = st.executeQuery("SELECT version FROM gcsp_app.flyway_schema_history WHERE success AND version IS NOT NULL ORDER BY installed_rank");
            rs.next();
            assertEquals("1", rs.getString(1));
            rs = st.executeQuery("SELECT current_schema()");
            rs.next();
            assertEquals("gcsp_app", rs.getString(1));
            rs = st.executeQuery("SELECT environment_id FROM environment_identity");
            rs.next();
            assertEquals("test-app-env", rs.getString(1));
        }
        EnvironmentGuard.RunState run = persistence.guard().currentRun();
        assertEquals("run-1", run.runId());
    }

    @Test
    void readinessReportsPersistenceUpWithTheEnvironmentId() {
        given().when().get("/q/health/ready").then()
                .statusCode(200)
                .body("status", equalTo("UP"))
                .body("checks.find { it.name == 'persistence' }.data.state", equalTo("ready"))
                .body("checks.find { it.name == 'persistence' }.data.environmentId", equalTo("test-app-env"));
    }
}
