package gcsp.api.brief;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import gcsp.api.persistence.Persistence;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/** The brief over HTTP for one employee principal, as an ordered scenario over the shared test database. */
@QuarkusTest
@TestProfile(BriefHttpProfiles.Persisted.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class BriefHttpTest {

    private static final String BASE = "/api/gcsp/v1/brief";

    @Inject
    Persistence persistence;

    @BeforeEach
    void needsDatabase() {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
    }

    private static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + BriefHttpProfiles.TOKEN).accept(ContentType.JSON);
    }

    private static Response post(String path, String body) {
        return as().contentType(ContentType.JSON).body(body).post(BASE + path);
    }

    private static String command(String id, long brief, long draft, String rest) {
        return "{\"commandId\":\"" + id + "\",\"expectedBriefVersion\":" + brief + ",\"expectedDraftVersion\":" + draft
                + (rest.isEmpty() ? "" : "," + rest) + "}";
    }

    private static int version(String field) {
        return as().get(BASE + "/editor").then().statusCode(200).extract().path("value.initial." + field);
    }

    private static final String ONE = "\"changes\":{\"comfort\":{\"value\":50}}";
    private static final String TWO_MORE = "\"changes\":{\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50}}";

    @Test
    @Order(1)
    void refusesBeforeAnythingIsRead() {
        given().get(BASE).then().statusCode(401).contentType(containsString("application/json"))
                .body("code", equalTo("bearer-missing"));
        given().header("Authorization", "Bearer " + BriefHttpProfiles.UNMAPPED).get(BASE + "/editor").then()
                .statusCode(403).contentType(containsString("application/json")).body("status", equalTo("forbidden"));
        for (String path : new String[] {"", "/history", "/draft", "/editor"}) {
            as().queryParam("employeeId", "someone-else").get(BASE + path).then().statusCode(400)
                    .contentType(containsString("application/json"))
                    .body("status", equalTo("invalid")).body("code", equalTo("unsupported-query"))
                    .body("retryable", equalTo(false)).body("reasons[0].field", equalTo("query"));
        }
        as().contentType(ContentType.JSON).queryParam("x", "1").body(command("q", 0, 0, "")).post(BASE + "/engage").then()
                .statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    @Order(2)
    void aNewEmployeeSeesPolicyDefaultsAndNoConfirmedBrief() {
        as().get(BASE + "/editor").then().statusCode(200).body("status", equalTo("ok"))
                .body("value.provenance.initial", equalTo("unconfirmed-policy-defaults"))
                .body("value.initial.briefVersion", equalTo(0)).body("value.initial.draftVersion", equalTo(0))
                .body("replayed", nullValue());
        as().get(BASE).then().statusCode(404).body("code", equalTo("not-found"));
        as().get(BASE + "/draft").then().statusCode(404).body("code", equalTo("not-found"));
        as().get(BASE + "/history").then().statusCode(200).body("value.versions.size()", equalTo(0));
    }

    @Test
    @Order(3)
    void savingPreferencesIsIdempotentAndRefusesChangedInputAndStaleVersions() {
        String body = command("http-p1", 0, 0, ONE);
        Response first = post("/preferences", body);
        first.then().statusCode(200).body("status", equalTo("ok")).body("replayed", nullValue())
                .body("value.accountPreferences.considered", equalTo(1));
        Response again = post("/preferences", body);
        again.then().statusCode(200).body("replayed", equalTo(true));
        assertEquals(first.jsonPath().getMap("value"), again.jsonPath().getMap("value"));

        post("/preferences", command("http-p1", 0, 0, "\"changes\":{\"comfort\":{\"value\":0}}")).then()
                .statusCode(409).body("code", equalTo("command-input-changed"));
        int draft = version("draftVersion");
        post("/preferences", command("http-stale", 7, draft, TWO_MORE)).then().statusCode(409)
                .body("status", equalTo("stale-version")).body("code", equalTo("stale-version"))
                .body("currentVersion", equalTo(0)).body("expectedVersion", equalTo(7)).body("action", equalTo("refresh"));
        assertEquals(draft, version("draftVersion"));
    }

    @Test
    @Order(4)
    void engagingNeedsThreeCategoriesThenTheSavedStateReadsBack() {
        int draft = version("draftVersion");
        post("/engage", command("http-e0", 0, draft, "")).then().statusCode(400)
                .body("code", equalTo("engagement-minimum")).body("remaining", equalTo(2));
        post("/preferences", command("http-p2", 0, draft, TWO_MORE)).then().statusCode(200)
                .body("value.accountPreferences.considered", equalTo(3));
        draft = version("draftVersion");
        post("/engage", command("http-e1", 0, draft, "")).then().statusCode(200).body("status", equalTo("ok"))
                .body("value.buddy.state", equalTo("engaged")).body("value.briefVersion", equalTo(1));

        as().get(BASE + "/editor").then().statusCode(200)
                .body("value.initial.buddy.state", equalTo("engaged")).body("value.initial.briefVersion", equalTo(1))
                .body("value.initial.consent.search", equalTo(true))
                .body("value.provenance.initial", equalTo("approved-brief"));
        as().get(BASE).then().statusCode(200).body("value.brief.briefVersion", equalTo(1))
                .body("value.brief.buddy.searchConsent", equalTo(true)).body("value.activity", notNullValue());
        as().get(BASE + "/history").then().statusCode(200).body("value.versions.size()", equalTo(1));
        as().get(BASE + "/draft").then().statusCode(200).body("status", equalTo("ok"));
    }

    @Test
    @Order(5)
    void removingACategoryWhileEngagedDisengagesAndTheEditorReadsItBack() {
        int draft = version("draftVersion");
        post("/preferences", command("http-p3", 1, draft, "\"changes\":{\"comfort\":null}")).then().statusCode(200)
                .body("value.buddyTransition", equalTo("minimum-lost")).body("value.buddy.state", equalTo("disengaged"));
        as().get(BASE + "/editor").then().statusCode(200)
                .body("value.initial.buddy.state", equalTo("disengaged"))
                .body("value.initial.buddy.reason", equalTo("minimum-lost"))
                .body("value.initial.buddy.canEngage", equalTo(false)).body("value.initial.briefVersion", equalTo(2));
        as().get(BASE + "/history").then().statusCode(200).body("value.versions.size()", equalTo(2));
    }

    @Test
    @Order(6)
    void badBodiesAndUnknownRoutesStayInTheJsonEnvelope() {
        as().contentType(ContentType.JSON).body("{not json").post(BASE + "/engage").then().statusCode(400)
                .contentType(containsString("application/json")).body("code", equalTo("invalid-command"));
        as().contentType(ContentType.JSON).body("[1,2]").post(BASE + "/engage").then().statusCode(400)
                .body("code", equalTo("invalid-command"));
        as().contentType(ContentType.JSON).post(BASE + "/engage").then().statusCode(400)
                .contentType(containsString("application/json")).body("status", equalTo("invalid"));
        post("/engage", "{\"commandId\":\"x\"}").then().statusCode(400).body("code", equalTo("invalid-command"));
        post("/engage", command("with-authority", 0, 0, "\"employeeId\":\"someone-else\"")).then().statusCode(400)
                .body("code", equalTo("invalid-command"));
        for (String gone : new String[] {"/pause", "/resume", "/preview", "/change-after-decline", "/nothing"}) {
            as().get(BASE + gone).then().statusCode(404).contentType(containsString("application/json"))
                    .body("code", equalTo("route-not-found"));
            post(gone, "{}").then().statusCode(404).body("code", equalTo("route-not-found"));
        }
        as().post(BASE + "/history").then().statusCode(405).body("code", equalTo("method-not-allowed"));
    }

    @Test
    @Order(7)
    void everyCommandRouteIsReachable() {
        for (String path : new String[] {"/draft", "/confirm", "/engage", "/disengage", "/pause-search", "/resume-search"}) {
            post(path, "{}").then().statusCode(400).body("code", equalTo("invalid-command"))
                    .body("reasons.field", hasItem("command"));
        }
    }
}
