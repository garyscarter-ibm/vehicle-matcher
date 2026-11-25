package gcsp.api.supply;

import static gcsp.api.supply.SupplyHttpSupport.BASE;
import static gcsp.api.supply.SupplyHttpSupport.presenter;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.util.Map;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Optional policy never hides a valid release; contradictory required stock/custody evidence still refuses. */
@QuarkusTest
@TestProfile(SupplyProjectionHttpTest.ProjectionProfile.class)
class SupplyProjectionHttpTest {
    public static class ProjectionProfile extends SupplyHttpProfile {
        @Override public Map<String, String> getConfigOverrides() {
            Map<String, String> values = super.getConfigOverrides();
            values.put("quarkus.datasource.jdbc.additional-jdbc-properties.currentSchema", "gcsp_projection_http");
            values.put("quarkus.flyway.schemas", "gcsp_projection_http");
            values.put("quarkus.flyway.default-schema", "gcsp_projection_http");
            return values;
        }
    }

    @Inject Persistence persistence;
    @Inject Instance<AgroalDataSource> source;

    @Test void optionalPolicyKeepsTheCompleteReleaseButContradictoryCustodyIsUnavailable() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        var clock = SupplyHttpSupport.nextClock(source.get(), persistence);
        presenter().body(SupplyHttpSupport.tickBody(SupplyHttpSupport.tickId(), clock)).post(BASE + "/ticks").then().statusCode(200);
        long before = policies();
        for (int i = 0; i < 2; i++) {
            presenter().get(BASE + "/latest").then().statusCode(200)
                    .body("status", equalTo("ok")).body("value.counts.released", equalTo(5))
                    .body("value.counts.totalReleased", equalTo(5)).body("value.cars.size()", equalTo(5))
                    .body("value.charts.points.size()", equalTo(0));
        }
        assertEquals(before, policies());
        // A selected stock row with no corresponding custody is genuinely contradictory evidence.
        try (var c = source.get().getConnection(); var st = c.createStatement()) {
            st.executeUpdate("UPDATE stock_cars SET state='allocated' WHERE order_uuid='00000000-0000-4000-8000-000000000001'");
        }
        presenter().get(BASE + "/latest").then().statusCode(503)
                .body("status", equalTo("unavailable")).body("code", equalTo("release-evidence-unavailable"))
                .body("retryable", equalTo(true));
        assertEquals(before, policies());
    }

    private long policies() throws Exception {
        try (var c = source.get().getConnection(); var st = c.createStatement(); var rs = st.executeQuery("SELECT count(*) FROM policy_versions")) {
            rs.next(); return rs.getLong(1);
        }
    }
}
