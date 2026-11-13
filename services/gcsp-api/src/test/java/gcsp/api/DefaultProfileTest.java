package gcsp.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/** Default configuration: no identity provider, so context is always refused. */
@QuarkusTest
class DefaultProfileTest {

    @Test
    void readinessIsUpAndReportsTheRefusingProvider() {
        given().when().get("/q/health/ready").then()
                .statusCode(200)
                .body("status", equalTo("UP"))
                .body("checks.find { it.name == 'identity-port' }.data.provider", equalTo("none"));
    }

    @Test
    void livenessIsUp() {
        given().when().get("/q/health/live").then().statusCode(200).body("status", equalTo("UP"));
    }

    @Test
    void contextWithoutTokenIs401Json() {
        given().when().get("/api/gcsp/v1/context").then()
                .statusCode(401)
                .contentType(containsString("application/json"))
                .header("WWW-Authenticate", "Bearer")
                .body("status", equalTo("unauthenticated"))
                .body("code", equalTo("bearer-missing"))
                .body("retryable", equalTo(false));
    }

    @Test
    void contextWithNonBearerSchemeIs401Json() {
        given().header("Authorization", "Basic dXNlcjpwYXNz").when().get("/api/gcsp/v1/context").then()
                .statusCode(401)
                .contentType(containsString("application/json"))
                .body("code", equalTo("bearer-invalid"));
    }

    @Test
    void anyBearerIsRefusedWithoutSyntheticIdentity() {
        given().header("Authorization", "Bearer some-token").when().get("/api/gcsp/v1/context").then()
                .statusCode(503)
                .contentType(containsString("application/json"))
                .body("status", equalTo("unavailable"))
                .body("code", equalTo("identity-provider-not-configured"))
                .body("value", nullValue())
                .body(not(containsString("some-token")));
    }

    @Test
    void unknownApiRouteIs404Json() {
        given().when().get("/api/gcsp/v1/no-such-operation").then()
                .statusCode(404)
                .contentType(containsString("application/json"))
                .body("status", equalTo("not-found"))
                .body("code", equalTo("route-not-found"));
    }

    @Test
    void unknownNonApiRouteIs404JsonNotHtml() {
        given().accept("text/html").when().get("/gcsp/anything").then()
                .statusCode(404)
                .contentType(containsString("application/json"))
                .body("code", equalTo("route-not-found"))
                .body(not(containsString("<html")));
    }

    @Test
    void wrongMethodIsJson() {
        given().when().post("/api/gcsp/v1/context").then()
                .statusCode(405)
                .contentType(containsString("application/json"))
                .body("code", equalTo("method-not-allowed"));
    }

    @Test
    void corsPreflightAllowsOnlyTheConfiguredExactOrigin() {
        given().header("Origin", "https://frontend.test")
                .header("Access-Control-Request-Method", "GET")
                .header("Access-Control-Request-Headers", "authorization")
                .when().options("/api/gcsp/v1/context").then()
                .statusCode(200)
                .header("Access-Control-Allow-Origin", "https://frontend.test")
                .header("Access-Control-Allow-Headers", containsString("Authorization"));
        given().header("Origin", "https://other.test")
                .header("Access-Control-Request-Method", "GET")
                .when().options("/api/gcsp/v1/context").then()
                .header("Access-Control-Allow-Origin", nullValue());
    }
}
