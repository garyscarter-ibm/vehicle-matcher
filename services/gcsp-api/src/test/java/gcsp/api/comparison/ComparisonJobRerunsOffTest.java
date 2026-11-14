package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** The reruns-off switch over HTTP. */
@QuarkusTest
@TestProfile(ComparisonJobProfiles.RerunsOff.class)
class ComparisonJobRerunsOffTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Inject
    Persistence persistence;

    @Test
    void withRerunsOffGregIsToldSoAndNothingIsStored() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        String greg = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        as(greg).contentType("application/json").body("{\"experimentId\":\"process-only\",\"commandId\":\"off-1\"}")
                .post("/api/gcsp/v1/comparison/jobs").then().statusCode(403).body("code", equalTo("comparison-reruns-off"))
                .body("reason", equalTo("Reruns are not started from this screen."));
        as(greg).get("/api/gcsp/v1/comparison/jobs/latest").then().statusCode(404).body("reruns", equalTo(false));
        try (Connection c = ComparisonJobProfiles.pool(ComparisonJobProfiles.RerunsOff.SCHEMA).getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT count(*) FROM comparison_jobs"); ResultSet rs = ps.executeQuery()) {
            rs.next();
            assertEquals(0, rs.getInt(1));
        }
    }
}
