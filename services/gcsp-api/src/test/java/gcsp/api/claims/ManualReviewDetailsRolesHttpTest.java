package gcsp.api.claims;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** Review details and the quote read refuse a presenter. */
@QuarkusTest
@TestProfile(ClaimHttpProfiles.Presenter.class)
class ManualReviewDetailsRolesHttpTest {

    @Test
    void aPresenterIsRefused() {
        for (String path : new String[] {"/api/gcsp/v1/manual/review-details", "/api/gcsp/v1/manual/quote"}) {
            given().header("Authorization", "Bearer " + ClaimHttpProfiles.TOKEN).get(path).then().statusCode(403)
                    .body("code", equalTo("role-required"));
        }
        given().header("Authorization", "Bearer " + ClaimHttpProfiles.TOKEN).contentType("application/json").body("{}")
                .post("/api/gcsp/v1/manual/review-details").then().statusCode(403);
    }
}
