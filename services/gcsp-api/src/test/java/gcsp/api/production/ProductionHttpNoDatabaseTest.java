package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.STATUS;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.submitBody;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** Without a database every Production route says so, and startup reconcile is skipped. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.NoDatabase.class)
class ProductionHttpNoDatabaseTest {

    @Inject
    ProductionStartup startup;

    @Test
    void everyRouteSaysThePersistenceIsNotConfigured() {
        var greg = given().header("Authorization", "Bearer production-token").contentType("application/json");
        greg.body(submitBody(command(), "plan-nodb", "s1")).post(REQUESTS).then().statusCode(503)
                .body("code", equalTo("persistence-not-configured"));
        greg.get(STATUS).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        assertEquals(0, startup.reconcileOnce());
        assertEquals("skipped", startup.summary());
    }
}
