package gcsp.api.claims;

import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** Without a database every claims route says so. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.NoDatabase.class)
class ManualClaimsHttpNoDatabaseTest {

    private static final String CLAIM = ManualClaimsHttpTest.CLAIM;

    @Test
    void everyRouteIs503PersistenceNotConfigured() {
        ManualClaimsHttpTest.as().get(CLAIM).then().statusCode(503).body("code", equalTo("persistence-not-configured"));
        ManualClaimsHttpTest.as().body("{}").post(CLAIM).then().statusCode(503)
                .body("code", equalTo("persistence-not-configured"));
        ManualClaimsHttpTest.as().body("{}").post(CLAIM + "/review").then().statusCode(503);
        ManualClaimsHttpTest.as().body("{}").post(CLAIM + "/release").then().statusCode(503);
    }
}
