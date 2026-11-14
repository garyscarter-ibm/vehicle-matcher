package gcsp.api.supply;

import static gcsp.api.supply.SupplyHttpSupport.BASE;
import static gcsp.api.supply.SupplyHttpSupport.presenter;
import static gcsp.api.supply.SupplyHttpSupport.tickBody;
import static gcsp.api.supply.SupplyHttpSupport.tickId;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gcsp.api.persistence.Persistence;
import gcsp.api.supply.SupplyHttpSupport.Clock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.lang.annotation.Annotation;
import java.util.List;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Presenter release endpoints over the native test database, with the synthetic tranche plan. */
@QuarkusTest
@TestProfile(SupplyHttpProfile.class)
class SupplyHttpTest {

    static final List<String> PLAN_CARS = List.of("00000000-0000-4000-8000-000000000001",
            "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003",
            "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005");

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    SupplyStartup startup;

    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    Clock clock() throws Exception {
        return SupplyHttpSupport.nextClock(dataSource.get(), persistence);
    }

    @Test
    void everyEndpointRefusesAnAnonymousCaller() {
        given().contentType("application/json").body("{}").post(BASE + "/ticks").then().statusCode(401)
                .body("code", equalTo("bearer-missing"));
        given().post(BASE + "/reconcile").then().statusCode(401);
        given().get(BASE + "/latest").then().statusCode(401);
        given().get(BASE + "/stock").then().statusCode(401);
        given().get(BASE + "/ticks/x").then().statusCode(401);
    }

    @Test
    void queryParametersAreRefusedExceptAfterAndLimitOnTheStockRead() {
        presenter().get(BASE + "/latest?runId=run-1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        presenter().get(BASE + "/ticks/x?environmentId=e").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        presenter().body("{}").post(BASE + "/reconcile?limit=5").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        presenter().body("{}").post(BASE + "/ticks?now=2026-11-05T09:00:00Z").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        presenter().get(BASE + "/stock?runId=run-1").then().statusCode(400).body("code", equalTo("unsupported-query"));
        presenter().get(BASE + "/stock?limit=0").then().statusCode(400).body("code", equalTo("invalid-query"));
        presenter().get(BASE + "/stock?limit=501").then().statusCode(400).body("code", equalTo("invalid-query"));
        presenter().get(BASE + "/stock?limit=abc").then().statusCode(400).body("code", equalTo("invalid-query"));
    }

    @Test
    void aMalformedTickBodyIs400WithFieldReasons() {
        for (String body : new String[] {"", "[]", "not json", "{}",
                "{\"tickId\":\"\",\"now\":\"2026-11-05T09:00:00Z\",\"clockVersion\":1}",
                "{\"tickId\":\"a\",\"now\":\"yesterday\",\"clockVersion\":1}",
                "{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\",\"clockVersion\":0}",
                "{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\",\"clockVersion\":1.5}",
                "{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\",\"clockVersion\":1,\"runId\":\"run-9\"}"}) {
            presenter().body(body).post(BASE + "/ticks").then().statusCode(400)
                    .body("status", equalTo("invalid")).body("code", equalTo("invalid-tick"))
                    .body("retryable", equalTo(false)).body("reasons.size()", org.hamcrest.Matchers.greaterThan(0));
        }
        presenter().body("{\"limit\":0}").post(BASE + "/reconcile").then().statusCode(400)
                .body("code", equalTo("invalid-reconcile"));
        presenter().body("{\"limit\":101}").post(BASE + "/reconcile").then().statusCode(400);
        presenter().body("{\"other\":1}").post(BASE + "/reconcile").then().statusCode(400);
    }

    @Test
    void aTickReleasesThePlanCarsAndReplayChangesNothing() throws Exception {
        needsDatabase();
        Clock c = clock();
        String id = tickId();
        JsonPath first = presenter().body(tickBody(id, c)).post(BASE + "/ticks").then().statusCode(200)
                .body("status", equalTo("ok")).body("value.tickId", equalTo(id)).body("value.replayed", equalTo(false))
                .extract().jsonPath();
        String kind = first.getString("value.outcome.kind");
        assertTrue(kind.equals("stock-released") || kind.equals("no-release"), kind);

        List<String> before = stockIds();
        assertTrue(before.containsAll(PLAN_CARS), "the plan cars are released: " + before);
        presenter().body(tickBody(id, c)).post(BASE + "/ticks").then().statusCode(200)
                .body("value.replayed", equalTo(true)).body("value.outcome.kind", equalTo(kind));
        assertEquals(before, stockIds());
    }

    @Test
    void theSameTickWithDifferentInputIs409() throws Exception {
        needsDatabase();
        Clock c = clock();
        String id = tickId();
        presenter().body(tickBody(id, c)).post(BASE + "/ticks").then().statusCode(200);
        presenter().body(tickBody(id, c.next())).post(BASE + "/ticks").then().statusCode(409)
                .body("status", equalTo("conflict")).body("code", equalTo("tick-input-changed"))
                .body("tickId", equalTo(id));
    }

    @Test
    void aLowerClockVersionIs409() throws Exception {
        needsDatabase();
        Clock c = clock();
        presenter().body(tickBody(tickId(), c)).post(BASE + "/ticks").then().statusCode(200);
        presenter().body(tickBody(tickId(), new Clock(c.version() - 1, c.now().plusSeconds(5)))).post(BASE + "/ticks")
                .then().statusCode(409).body("code", equalTo("release-clock-changed"));
    }

    @Test
    void theStockReadPagesWithACursorAndNeverReturnsAVinOrAnEmployee() throws Exception {
        needsDatabase();
        presenter().body(tickBody(tickId(), clock())).post(BASE + "/ticks").then().statusCode(200);
        JsonPath page1 = presenter().get(BASE + "/stock?limit=2").then().statusCode(200)
                .body("status", equalTo("ok")).body("value.cars.size()", equalTo(2))
                .body("value.cars[0].release.trancheId", org.hamcrest.Matchers.notNullValue())
                .extract().jsonPath();
        String next = page1.getString("value.next");
        assertEquals(page1.getString("value.cars[1].orderUuid"), next);
        String body = presenter().get(BASE + "/stock?after=" + next + "&limit=500").then().statusCode(200)
                .body(not(containsString("vin"))).body(not(containsString("employee")))
                .extract().asString();
        JsonPath rest = JsonPath.from(body);
        List<String> ids = rest.getList("value.cars.orderUuid");
        assertTrue(ids.stream().allMatch(i -> i.compareTo(next) > 0));
        assertEquals(null, rest.getString("value.next"));
        assertEquals(false, rest.getBoolean("value.cars[0].occupied"));
    }

    @Test
    void latestReturnsTheReleasedTrancheAndTickInspectionAnswers() throws Exception {
        needsDatabase();
        String id = tickId();
        presenter().body(tickBody(id, clock())).post(BASE + "/ticks").then().statusCode(200);
        presenter().get(BASE + "/latest").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.runId", equalTo("run-1")).body("value.release.windowId", equalTo("test-weekly-window"))
                .body("value.release.source.mode", equalTo("synthetic"))
                .body("value.release.visibleOrderUuids", hasItems(PLAN_CARS.get(0)))
                .body("value.release.trancheId", org.hamcrest.Matchers.notNullValue());
        presenter().get(BASE + "/ticks/" + id).then().statusCode(200).body("value.tickId", equalTo(id))
                .body("value.state", equalTo("completed")).body("value.attempts", equalTo(0))
                .body("value.clockVersion", org.hamcrest.Matchers.greaterThan(0))
                .body("value.outcome.status", equalTo("ok"));
        presenter().get(BASE + "/ticks/missing-" + id).then().statusCode(404).body("code", equalTo("tick-not-found"));
    }

    @Test
    void reconcileAnswersWithAResultList() throws Exception {
        needsDatabase();
        presenter().body("{}").post(BASE + "/reconcile").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.results", org.hamcrest.Matchers.notNullValue());
        presenter().post(BASE + "/reconcile").then().statusCode(200);
        presenter().body("{\"limit\":5}").post(BASE + "/reconcile").then().statusCode(200);
    }

    @Test
    void readinessReportsTheSelectedSupplyState() {
        needsDatabase();
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'supply-release' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'supply-release' }.data.provider", equalTo("tranche-plan"))
                .body("checks.find { it.name == 'supply-release' }.data.policy", equalTo("file"))
                .body("checks.find { it.name == 'supply-release' }.data.pendingTicks",
                        org.hamcrest.Matchers.greaterThanOrEqualTo(0));
    }

    @Test
    void startupReconcileRunsAfterPersistencesClaimAndCompletedWithoutFailing() throws Exception {
        needsDatabase();
        assertTrue(startup.summary().startsWith("reconciled:"), startup.summary());
        var method = SupplyStartup.class.getDeclaredMethod("onStart", io.quarkus.runtime.StartupEvent.class);
        int priority = 0;
        for (Annotation[] a : method.getParameterAnnotations()) {
            for (Annotation x : a) if (x instanceof jakarta.annotation.Priority p) priority = p.value();
        }
        // Persistence's observer has no @Priority, which CDI treats as APPLICATION + 500.
        assertTrue(priority > jakarta.interceptor.Interceptor.Priority.APPLICATION + 500, "priority " + priority);
    }

    private List<String> stockIds() {
        return presenter().get(BASE + "/stock?limit=500").then().statusCode(200).extract().jsonPath()
                .getList("value.cars.orderUuid");
    }
}
