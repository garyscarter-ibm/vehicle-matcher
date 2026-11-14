package gcsp.api.ordering;

import static gcsp.api.ordering.OrderingHttpSupport.BASE;
import static gcsp.api.ordering.OrderingHttpSupport.RECONCILE;
import static gcsp.api.ordering.OrderingHttpSupport.TERMS;
import static gcsp.api.ordering.OrderingHttpSupport.as;
import static gcsp.api.ordering.OrderingHttpSupport.body;
import static gcsp.api.ordering.OrderingHttpSupport.count;
import static gcsp.api.ordering.OrderingHttpSupport.seed;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.ordering.OrderingHttpSupport.Seed;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** With provider none every submit is refused 503 while reads still work; an employee cannot reconcile. */
@QuarkusTest
@TestProfile(OrderingHttpProfiles.ProviderNone.class)
class OrderingForbiddenHttpTest {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    OrderingHttpPorts.TestSlots slots;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @Test
    void providerNoneRefusesSubmitButTermsAndReadsStillWork() throws Exception {
        Seed s = seed(dataSource.get());
        slots.use(s.slot(), true, false);
        String digest = as().get(TERMS).then().statusCode(200).extract().path("value.termsDigest");
        as().body(body(s, "cmd-n", digest).toString()).post(BASE).then().statusCode(503)
                .body("code", equalTo("ordering-provider-not-configured")).body("retryable", equalTo(false));
        as().get(BASE).then().statusCode(404).body("code", equalTo("not-found"));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE entitlement_slot_id = ?", s.slot()));
    }

    @Test
    void anEmployeeCannotReconcileAndNoOneElseCanReadOrSubmit() {
        as().body("{}").post(RECONCILE).then().statusCode(403).body("code", equalTo("role-required"));
        given().contentType("application/json").get(TERMS).then().statusCode(401);
    }
}
