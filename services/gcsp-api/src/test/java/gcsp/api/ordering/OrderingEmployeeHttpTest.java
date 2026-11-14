package gcsp.api.ordering;

import static gcsp.api.ordering.OrderingHttpSupport.BASE;
import static gcsp.api.ordering.OrderingHttpSupport.PROGRESS;
import static gcsp.api.ordering.OrderingHttpSupport.TERMS;
import static gcsp.api.ordering.OrderingHttpSupport.as;
import static gcsp.api.ordering.OrderingHttpSupport.body;
import static gcsp.api.ordering.OrderingHttpSupport.count;
import static gcsp.api.ordering.OrderingHttpSupport.seed;
import static gcsp.api.ordering.OrderingHttpSupport.termsDigest;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.OrderSourcePort;
import gcsp.api.ordering.OrderingHttpSupport.Seed;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** An employee's whole ordering flow over HTTP with the synthetic provider, and its binding into approvals. */
@QuarkusTest
@TestProfile(OrderingHttpProfiles.Employee.class)
class OrderingEmployeeHttpTest {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    OrderingHttpPorts.TestSlots slots;

    @Inject
    OrderingStartup startup;

    @Inject
    OrderSourcePort orderSource;

    @Inject
    PolicyService policy;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    @Test
    void termsAreReadWithDigestDeclarationsAndStages() {
        as().get(TERMS).then().statusCode(200).body("status", equalTo("ok")).body("value.termsDigest", notNullValue())
                .body("value.declarations", hasSize(3)).body("value.approvalStages[0]", equalTo("HR approval"));
    }

    @Test
    void aSubmitIsAcknowledgedReplaysOnTheSameBodyRefusesAChangeAndFeedsApprovals() throws Exception {
        Seed s = seed(dataSource.get());
        slots.use(s.slot(), true, false);
        String digest = termsDigest();
        ObjectNode first = body(s, "cmd-1", digest);
        var ok = as().body(first.toString()).post(BASE).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.status", equalTo("acknowledged")).body("value.providerReference", notNullValue())
                .body("value.replayed", nullValue()).extract().path("value.selection.orderUuid");
        assertEquals(s.car(), ok);

        as().body(body(s, "cmd-2", digest).toString()).post(BASE).then().statusCode(200)
                .body("value.status", equalTo("acknowledged")).body("value.replayed", equalTo(true));
        ObjectNode changed = body(s, "cmd-3", digest);
        changed.put("expectedStockVersion", 2);
        as().body(changed.toString()).post(BASE).then().statusCode(409).body("code", equalTo("active-selection-exists"))
                .body("status", equalTo("conflict"));
        assertEquals(1, count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE entitlement_slot_id = ?", s.slot()));

        as().get(BASE).then().statusCode(200).body("value.status", equalTo("acknowledged"));
        as().get(PROGRESS + "?orderUuid=" + s.car()).then().statusCode(200)
                .body("value.employeeId", equalTo(OrderingHttpProfiles.OWNER)).body("value.orderUuid", equalTo(s.car()));
        assertEquals("ordering", orderSource.mode());
        assertInstanceOf(OrderSourcePort.Ready.class, orderSource.find(new gcsp.api.persistence.RunContext(
                OrderingHttpProfiles.ENV, OrderingHttpProfiles.RUN, "t"), s.car()));
    }

    @Test
    void aDeclarationFailureIs400AndWritesNothing() throws Exception {
        Seed s = seed(dataSource.get());
        slots.use(s.slot(), true, false);
        ObjectNode b = body(s, "cmd-d", termsDigest());
        b.putObject("declarations").put("terms", true);
        as().body(b.toString()).post(BASE).then().statusCode(400).body("status", equalTo("invalid"))
                .body("reasons[0].field", equalTo("declarations"));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM pending_operations WHERE operation_id = ?",
                OrderingService.operationId(OrderingHttpSupport.scope(s))));
        as().get(BASE).then().statusCode(404).body("code", equalTo("not-found"));
    }

    @Test
    void anUnreadableBodyAndAQueryAreRefused() {
        as().body("[]").post(BASE).then().statusCode(400).body("reasons[0].field", equalTo("body"));
        as().get(BASE + "?employeeId=other").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as().get(TERMS + "?x=1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        as().body("{}").post(BASE + "?slot=x").then().statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    void noEnabledSlotIs409AndAnUnavailableAccountIs503() throws Exception {
        Seed s = seed(dataSource.get());
        ObjectNode b = body(s, "cmd-e", termsDigest());
        slots.use(s.slot(), false, false);
        as().body(b.toString()).post(BASE).then().statusCode(409).body("code", equalTo("entitlement-unavailable"));
        as().get(BASE).then().statusCode(404).body("code", equalTo("not-found"));
        slots.use(s.slot(), true, true);
        as().body(b.toString()).post(BASE).then().statusCode(503).body("code", equalTo("account-unavailable"))
                .body("retryable", equalTo(true));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE entitlement_slot_id = ?", s.slot()));
    }

    @Test
    void aPendingHandoffIsReconciledByStartupAndByARead() throws Exception {
        var ds = dataSource.get();
        var lossy = new OrderingFixture.TestProvider(new SyntheticOrderingProvider(ds));
        lossy.loseAnswer = true;
        var service = new OrderingService(ds, new OrderingTerms(policy, ctx -> OrderingHttpPorts.NOW), lossy,
                java.time.Duration.ofSeconds(30), java.time.Duration.ZERO, java.time.Instant::now);
        var cart = new OrderingHttpPorts.Cart();
        Seed a = seed(ds);
        Seed b = seed(ds);
        for (Seed s : new Seed[] {a, b}) {
            slots.use(s.slot(), true, false);
            assertInstanceOf(OrderingResult.Pending.class, service.submit(OrderingHttpSupport.scope(s), body(s, "c-" + s.slot(), termsDigest()), cart));
        }
        slots.use(a.slot(), true, false);
        as().get(BASE).then().statusCode(200).body("value.status", equalTo("acknowledged"));
        assertTrue(startup.reconcileOnce() >= 1);
        assertEquals(1, count(ds, "SELECT count(*) FROM pending_operations WHERE state = 'acknowledged' AND operation_id = ?",
                OrderingService.operationId(OrderingHttpSupport.scope(b))));
        assertEquals(1, count(ds, "SELECT count(*) FROM ordering_synthetic_receipts WHERE operation_id = ?",
                OrderingService.operationId(OrderingHttpSupport.scope(b))));
    }

    @Test
    void theSelectionRoutesNeverCreateAnOrderFromARead() throws Exception {
        Seed s = seed(dataSource.get());
        slots.use(s.slot(), true, false);
        as().get(BASE).then().statusCode(404).body("code", equalTo("not-found")).body("reason", containsString("no selection"));
        assertEquals(0, count(dataSource.get(), "SELECT count(*) FROM selection_orders WHERE entitlement_slot_id = ?", s.slot()));
    }
}
