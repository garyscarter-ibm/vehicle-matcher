package gcsp.api.supply;

import static gcsp.api.supply.SupplyHttpSupport.BASE;
import static gcsp.api.supply.SupplyHttpSupport.presenter;
import static gcsp.api.supply.SupplyHttpSupport.tickBody;
import static gcsp.api.supply.SupplyHttpSupport.tickId;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** With no stock source a tick is still recorded and stays pending, so a configured restart can finish it. */
@QuarkusTest
@TestProfile(SupplyHttpProfile.NoProvider.class)
class SupplyNoProviderHttpTest {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    SupplyStartup startup;

    @Test
    void aTickStaysPendingWithTheTruthfulReason() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        String id = tickId();
        presenter().body(tickBody(id, SupplyHttpSupport.nextClock(dataSource.get(), persistence)))
                .post(BASE + "/ticks").then().statusCode(503).body("status", equalTo("unavailable"))
                .body("code", equalTo("supply-provider-not-configured")).body("retryable", equalTo(true))
                .body("state", equalTo("pending")).body("tickId", equalTo(id));
        presenter().get(BASE + "/ticks/" + id).then().statusCode(200).body("value.state", equalTo("pending"))
                .body("value.outcome.code", equalTo("supply-provider-not-configured"));
        presenter().body("{}").post(BASE + "/reconcile").then().statusCode(200)
                .body("value.results.find { it.tickId == '" + id + "' }.status", equalTo("unavailable"))
                .body("value.results.find { it.tickId == '" + id + "' }.code",
                        equalTo("supply-provider-not-configured"));
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'supply-release' }.data.provider", equalTo("none"))
                .body("checks.find { it.name == 'supply-release' }.data.pendingTicks",
                        org.hamcrest.Matchers.greaterThanOrEqualTo(1));
        assertEquals("skipped", startup.summary());
    }
}
