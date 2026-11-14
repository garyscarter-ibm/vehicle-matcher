package gcsp.api.supply;

import static gcsp.api.supply.SupplyHttpSupport.BASE;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** An account without the presenter role is refused on every endpoint before any scope is read. */
@QuarkusTest
@TestProfile(SupplyHttpProfile.NotPresenter.class)
class SupplyRefusalHttpTest {

    @Test
    void aNonPresenterIs403OnEveryEndpoint() {
        given().header("Authorization", "Bearer " + SupplyHttpProfile.TOKEN).contentType("application/json")
                .body("{\"tickId\":\"a\",\"now\":\"2026-11-05T09:00:00Z\",\"clockVersion\":1}")
                .post(BASE + "/ticks").then().statusCode(403).body("code", equalTo("role-required"));
        for (String path : new String[] {"/latest", "/stock", "/ticks/x"}) {
            given().header("Authorization", "Bearer " + SupplyHttpProfile.TOKEN).get(BASE + path).then()
                    .statusCode(403).body("code", equalTo("role-required"));
        }
        given().header("Authorization", "Bearer " + SupplyHttpProfile.TOKEN).post(BASE + "/reconcile").then()
                .statusCode(403);
    }
}
