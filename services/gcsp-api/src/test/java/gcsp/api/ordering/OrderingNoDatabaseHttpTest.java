package gcsp.api.ordering;

import static gcsp.api.ordering.OrderingHttpSupport.BASE;
import static gcsp.api.ordering.OrderingHttpSupport.RECONCILE;
import static gcsp.api.ordering.OrderingHttpSupport.TERMS;
import static gcsp.api.ordering.OrderingHttpSupport.as;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.persistence.RunContext;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** Without a database every ordering endpoint says so, startup reconcile is skipped and approvals' source is unavailable. */
@QuarkusTest
@TestProfile(OrderingHttpProfiles.NoDatabase.class)
class OrderingNoDatabaseHttpTest {

    @Inject
    OrderingStartup startup;

    @Inject
    OrderSourcePort orderSource;

    @Test
    void everyEndpointIs503PersistenceNotConfigured() {
        as().get(TERMS).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        as().get(BASE).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        as().body("{}").post(BASE).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        as().body("{}").post(RECONCILE).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        assertEquals(0, startup.reconcileOnce());
        assertEquals("skipped", startup.summary());
        var unavailable = assertInstanceOf(OrderSourcePort.Unavailable.class, orderSource.find(new RunContext("e", "r", "a"), "x"));
        assertEquals("order-source-not-configured", unavailable.code());
        assertInstanceOf(OrderSourcePort.Unavailable.class, orderSource.list(new RunContext("e", "r", "a"), null, 10));
    }
}
