package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonHttpSupport.as;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** Without persistence both reads answer 503 persistence-not-configured, and the startup import is skipped. */
@QuarkusTest
@TestProfile(ComparisonHttpProfiles.NoDatabase.class)
class ComparisonHttpNoDatabaseTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String jwk;

    @Test
    void readsAreUnavailableAsJson() {
        String token = ComparisonHttpSupport.token(jwk, "sub-greg", "greg");
        for (String path : new String[] {"/api/gcsp/v1/comparison/results/latest",
                "/api/gcsp/v1/comparison/process/latest"}) {
            as(token).get(path).then().statusCode(503).body("status", equalTo("unavailable"))
                    .body("code", equalTo("persistence-not-configured")).body("retryable", equalTo(false));
        }
    }
}
