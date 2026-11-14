package gcsp.api.claims;

import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Shipped defaults: no claim reads as 404, and a claim is 503 with nothing written. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.Unconfigured.class)
class ManualClaimsHttpGuardTest {

    private static final String CLAIM = ManualClaimsHttpTest.CLAIM;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Test
    void anEmployeeWithNoClaimReadsTheNoClaimViewAndAnyQueryIsRefused() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ManualClaimsHttpTest.as().get(CLAIM).then().statusCode(404).body("status", equalTo("not-found"))
                .body("view.state", equalTo("no-claim")).body("view.action", equalTo("browse-stock"));
        ManualClaimsHttpTest.as().get(CLAIM + "?employeeId=x").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
        ManualClaimsHttpTest.as().body("{}").post(CLAIM + "?x=1").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
    }

    @Test
    void claimingWithTheDefaultSelectionIs503AndWritesNothing() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        long before = holds();
        String body = "{\"commandId\":\"cmd-unconfigured\",\"orderUuid\":\"ord-x\",\"expectedStockVersion\":1,"
                + "\"expectedDraftVersion\":1,\"expectedContextVersion\":\"ctx-1\",\"expectedTermsDigest\":\"d\"}";
        ManualClaimsHttpTest.as().body(body).post(CLAIM).then().statusCode(503)
                .body("code", equalTo("manual-selection-not-configured")).body("retryable", equalTo(false));
        assertEquals(before, holds());
    }

    @Test
    void sweepIntervalOutsideOneSecondToTenMinutesIsRefused() {
        ClaimSweep.checkInterval(Duration.ofSeconds(1));
        ClaimSweep.checkInterval(Duration.ofMinutes(10));
        assertThrows(IllegalStateException.class, () -> ClaimSweep.checkInterval(Duration.ofMillis(999)));
        assertThrows(IllegalStateException.class, () -> ClaimSweep.checkInterval(Duration.ofMinutes(11)));
    }

    private long holds() throws Exception {
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT (SELECT count(*) FROM custody_holds) + (SELECT count(*) FROM manual_claims)");
                ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }
}
