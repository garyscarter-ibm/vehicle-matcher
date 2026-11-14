package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.submitBody;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** With provider none, submission is unavailable and startup reconcile is skipped. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.None.class)
class ProductionHttpNoneTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ProductionStartup startup;

    @Test
    void submissionIsNotConfiguredAndStartupSkips() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
        String greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        as(greg).body(submitBody(command(), "plan-none", "s1")).post(REQUESTS).then().statusCode(503)
                .body("code", equalTo("production-not-configured")).body("retryable", equalTo(false));
        assertEquals(0, startup.reconcileOnce());
        assertEquals("skipped", startup.summary());
    }
}
