package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.count;
import static gcsp.api.production.ProductionHttpSupport.submitBody;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.SQLException;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;

/** The started app with no test beans: the real plan port is bound, and unbound planner inputs are named honestly. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.Composition.class)
class ProductionPlanCompositionTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    PlanSnapshotPort plans;

    @AfterAll
    static void dropSchema() throws SQLException {
        if (ProductionHttpProfiles.URL == null) return;
        try (Connection c = java.sql.DriverManager.getConnection(ProductionHttpProfiles.URL);
                java.sql.Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ProductionHttpProfiles.Composition.SCHEMA + " CASCADE");
        }
    }

    @Test
    void theDefaultCompositionBindsTheRealPlanPortAndSubmitNamesThePlannersMissingInput() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        assertEquals("planning", plans.mode());
        assertTrue(ClientProxy.unwrap(plans) instanceof PlanningPlanSnapshot);
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
        String greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        as(greg).body(submitBody(command(), "plan-x", "s1")).post(REQUESTS).then().statusCode(503)
                .body("code", equalTo("planning-forecast-not-configured"));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM production_submissions"));
    }
}
