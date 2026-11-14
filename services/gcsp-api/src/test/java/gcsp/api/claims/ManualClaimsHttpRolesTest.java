package gcsp.api.claims;

import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** A presenter is refused on every claims route, with or without a database. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.Presenter.class)
class ManualClaimsHttpRolesTest {

    private static final String CLAIM = ManualClaimsHttpTest.CLAIM;

    @Test
    void aPresenterIs403OnEveryRoute() {
        ManualClaimsHttpTest.as().get(CLAIM).then().statusCode(403).body("code", equalTo("role-required"));
        ManualClaimsHttpTest.as().body("{}").post(CLAIM).then().statusCode(403).body("code", equalTo("role-required"));
        ManualClaimsHttpTest.as().body("{}").post(CLAIM + "/review").then().statusCode(403);
        ManualClaimsHttpTest.as().body("{}").post(CLAIM + "/release").then().statusCode(403);
    }
}
