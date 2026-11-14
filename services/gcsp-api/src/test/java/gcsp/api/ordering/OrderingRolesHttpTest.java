package gcsp.api.ordering;

import static gcsp.api.ordering.OrderingHttpSupport.BASE;
import static gcsp.api.ordering.OrderingHttpSupport.RECONCILE;
import static gcsp.api.ordering.OrderingHttpSupport.TERMS;
import static gcsp.api.ordering.OrderingHttpSupport.as;
import static gcsp.api.ordering.OrderingHttpSupport.body;
import static gcsp.api.ordering.OrderingHttpSupport.count;
import static gcsp.api.ordering.OrderingHttpSupport.seed;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
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

/** The presenter reconcile control, and the default converter that refuses until a source Story binds one. */
@QuarkusTest
@TestProfile(OrderingHttpProfiles.Unbound.class)
class OrderingRolesHttpTest {

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
    void thePresenterReconcilesOpenHandoffsWithAValidatedLimit() {
        as().body("{}").post(RECONCILE).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.examined", notNullValue());
        as().post(RECONCILE).then().statusCode(200).body("value.examined", notNullValue());
        as().body("{\"limit\":5}").post(RECONCILE).then().statusCode(200);
        as().body("{\"limit\":0}").post(RECONCILE).then().statusCode(400).body("reasons[0].field", equalTo("limit"));
        as().body("{\"limit\":101}").post(RECONCILE).then().statusCode(400);
        as().body("{\"other\":1}").post(RECONCILE).then().statusCode(400);
        as().body("{}").post(RECONCILE + "?limit=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    void withoutASourceBindingASubmitIsRefusedAndWritesNothing() throws Exception {
        Seed s = seed(dataSource.get());
        slots.use(s.slot(), true, false);
        String digest = as().get(TERMS).then().statusCode(200).extract().path("value.termsDigest");
        as().body(body(s, "cmd-u", digest).toString()).post(BASE).then().statusCode(503)
                .body("code", equalTo("selection-source-unsupported")).body("retryable", equalTo(false));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE entitlement_slot_id = ?", s.slot()));
    }
}
