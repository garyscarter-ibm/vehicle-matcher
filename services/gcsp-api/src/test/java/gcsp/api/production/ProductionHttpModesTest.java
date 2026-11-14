package gcsp.api.production;

import static gcsp.api.production.ProductionHttpSupport.REQUESTS;
import static gcsp.api.production.ProductionHttpSupport.RESPONSES;
import static gcsp.api.production.ProductionHttpSupport.STATUS;
import static gcsp.api.production.ProductionHttpSupport.as;
import static gcsp.api.production.ProductionHttpSupport.command;
import static gcsp.api.production.ProductionHttpSupport.count;
import static gcsp.api.production.ProductionHttpSupport.scriptBody;
import static gcsp.api.production.ProductionHttpSupport.submitBody;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** The live-stub provider refuses honestly and sends nothing. */
@QuarkusTest
@TestProfile(ProductionHttpProfiles.LiveStub.class)
class ProductionHttpModesTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ProductionStartup startup;

    @Inject
    ProductionHttpPorts.Plan plan;

    @Test
    void liveStubLinesAreUnsupportedAndThePresenterCannotScriptThem() throws Exception {
        assertTrue(persistence.active(), "every production test must run: GCSP_TEST_DATABASE_URL is not set");
        String greg = ProductionHttpSupport.token(jwk, "sub-greg", "greg");
        String presenter = ProductionHttpSupport.token(jwk, "sub-presenter", "presenter");
        ProductionHttpSupport.tick(dataSource.get(), persistence, 60);
        plan.reset();
        JsonPath r = JsonPath.from(as(greg).body(submitBody(command(), plan.planId(), "s1")).post(REQUESTS).then().statusCode(200)
                .extract().asString());
        assertEquals(java.util.List.of("unsupported", "unsupported"), r.getList("value.requests.state"));
        String id = r.getString("value.requests[0].requestId");
        long responses = count(dataSource.get(), "SELECT count(*) FROM production_responses");
        as(presenter).body(scriptBody(id, "confirm", 1)).post(RESPONSES).then().statusCode(409)
                .body("code", equalTo("production-scenario-unsupported"))
                .body("reason", equalTo("Production responses can only be scripted for the synthetic provider."));
        assertEquals(responses, count(dataSource.get(), "SELECT count(*) FROM production_responses"));
        as(presenter).get(STATUS).then().statusCode(200).body("value.provider.mode", equalTo("live"));
        startup.reconcileOnce();
        assertEquals(responses, count(dataSource.get(), "SELECT count(*) FROM production_responses"));
    }
}
