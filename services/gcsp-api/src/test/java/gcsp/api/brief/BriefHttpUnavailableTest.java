package gcsp.api.brief;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.Test;

/** An authenticated employee while persistence is not configured. */
@QuarkusTest
@TestProfile(BriefHttpProfiles.NoDatabase.class)
class BriefHttpUnavailableTest {

    @Test
    void everyOperationIs503JsonNeverHtml() {
        for (String path : new String[] {"", "/history", "/draft", "/editor"}) {
            given().header("Authorization", "Bearer " + BriefHttpProfiles.TOKEN).get("/api/gcsp/v1/brief" + path).then()
                    .statusCode(503).contentType(containsString("application/json"))
                    .body("status", equalTo("unavailable")).body("code", equalTo("brief-unavailable"))
                    .body("retryable", equalTo(true));
        }
        given().header("Authorization", "Bearer " + BriefHttpProfiles.TOKEN).contentType(ContentType.JSON)
                .body("{\"commandId\":\"a\",\"expectedBriefVersion\":0,\"expectedDraftVersion\":0}")
                .post("/api/gcsp/v1/brief/engage").then().statusCode(503).body("code", equalTo("brief-unavailable"));
    }
}
