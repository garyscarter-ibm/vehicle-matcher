package gcsp.api.brief;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
        for (String gone : new String[] {"/nothing"}) {
            as().get(BASE + gone).then().statusCode(404).contentType(containsString("application/json"))
                    .body("code", equalTo("route-not-found"));
            post(gone, "{}").then().statusCode(404).body("code", equalTo("route-not-found"));
        }
        as().get(BASE + "/change-after-decline").then().statusCode(405).body("code", equalTo("method-not-allowed"));
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

    @Test
    @Order(8)
    void previewPassesTheRecommendationOutcomeThroughAndChecksTheSavedVersions() {
        int brief = version("briefVersion");
        int draft = version("draftVersion");
        com.fasterxml.jackson.databind.node.ObjectNode chosen = Json.obj();
        chosen.put("schemaVersion", 1);
        chosen.putObject("preferences").set("body", Json.obj().put("value", "saloon").put("importance", 50)
                .put("valueState", "draft").put("importanceState", "draft").put("source", "employee"));
        chosen.putObject("essentials");
        Response ok = post("/preview", PreviewShapes.request(brief, draft, chosen).toString());
        ok.then().statusCode(200).body("status", equalTo("ok")).body("contractVersion", equalTo("1.0.0")).body("replayed", nullValue());
        assertTrue(PreviewShapes.previewShape(
                Json.M.valueToTree(ok.jsonPath().getMap("value"))));
        assertEquals(draft, version("draftVersion"));

        post("/preview", PreviewShapes.request(brief + 4, draft, chosen).toString()).then().statusCode(409)
                .body("status", equalTo("stale-version")).body("currentVersion", equalTo(brief)).body("action", equalTo("refresh"));
        post("/preview", PreviewShapes.request(brief, draft + 4, chosen).toString()).then().statusCode(409)
                .body("resource.table", equalTo("brief-draft"));
        // The stub port reports invalid for a brief that did not choose body: status and body pass through.
        com.fasterxml.jackson.databind.node.ObjectNode none = chosen.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) none.get("preferences")).removeAll();
        post("/preview", PreviewShapes.request(brief, draft, none).toString()).then().statusCode(400)
                .body("status", equalTo("invalid")).body("code", equalTo("invalid-preview"));
        post("/preview", "{\"kind\":\"unsaved-draft\"}").then().statusCode(400).body("code", equalTo("invalid-preview"))
                .body("reasons[0].field", equalTo("preview"));
        post("/preview", "[1]").then().statusCode(400).body("code", equalTo("invalid-preview"));
        as().contentType(ContentType.JSON).queryParam("x", "1").body("{}").post(BASE + "/preview").then().statusCode(400)
                .body("code", equalTo("unsupported-query"));
    }

    /** One recorded decline for the principal; replica mode skips the offer, hold and stock rows the route never reads. */
    private static void recordDecline(String decisionId) throws Exception {
        org.postgresql.ds.PGSimpleDataSource ds = new org.postgresql.ds.PGSimpleDataSource();
        ds.setUrl(BriefHttpProfiles.URL);
        ds.setCurrentSchema("gcsp_app");
        try (java.sql.Connection c = ds.getConnection()) {
            c.createStatement().execute("SET session_replication_role = replica");
            try (java.sql.PreparedStatement ps = c.prepareStatement("INSERT INTO offer_decisions (environment_id, run_id, offer_id, "
                    + "decision_id, command_id, input_digest, employee_id, hold_id, decision, reason_code, versions, outcome, "
                    + "decided_at) VALUES ('test-app-env', 'run-1', ?, ?, 'cmd', repeat('b', 64), ?, 'hold-x', 'decline', "
                    + "'body-style', '{\"brief\":1}'::jsonb, '{}'::jsonb, now())")) {
                ps.setString(1, "offer-" + decisionId);
                ps.setString(2, decisionId);
                // The profile's employee id is generated per classloader, so take the one the app wrote the head for.
                try (java.sql.ResultSet rs = c.createStatement().executeQuery("SELECT employee_id FROM brief_heads "
                        + "WHERE environment_id = 'test-app-env' ORDER BY updated_at DESC LIMIT 1")) {
                    rs.next();
                    ps.setString(3, rs.getString(1));
                }
                ps.executeUpdate();
            }
        }
    }

    @Test
    @Order(9)
    void changeAfterDeclineRefusesBadRequestsAndRecordsOneChangeWithTheAngularShape() throws Exception {
        int brief = version("briefVersion");
        String body = "{\"commandId\":\"http-d0\",\"expectedBriefVersion\":" + brief + ",\"decisionId\":\"http-decline\","
                + "\"change\":{\"path\":\"preferences.body.value\",\"value\":\"suv\"}}";
        assertTrue(PreviewShapes.declineRequest(Json.M.readTree(body)));
        post("/change-after-decline", "{}").then().statusCode(400).body("code", equalTo("invalid-command"));
        post("/change-after-decline", body.replace("\"change\":{", "\"change\":{\"other\":1,")).then().statusCode(400)
                .body("code", equalTo("invalid-brief")).body("reasons[0].field", equalTo("change"));
        post("/change-after-decline", body.replace("preferences.body.value", "buddy.enabled")).then().statusCode(400)
                .body("reason", equalTo("Change exactly one registered preference value or essential."));
        post("/change-after-decline", body).then().statusCode(404).body("code", equalTo("not-found"))
                .body("resourceType", equalTo("decisions"));
        post("/change-after-decline", body.replace("http-d0", "http-d5").replace("\"expectedBriefVersion\":" + brief, "\"expectedBriefVersion\":" + (brief + 5)))
                .then().statusCode(409).body("code", equalTo("stale-version")).body("currentVersion", equalTo(brief));
        recordDecline("http-decline");
        Response ok = post("/change-after-decline", body);
        ok.then().statusCode(200).body("status", equalTo("ok")).body("value.brief.briefVersion", equalTo(brief + 1))
                .body("value.brief.postDeclineChange.decisionId", equalTo("http-decline"))
                .body("value.event.operation", equalTo("changed-after-decline"));
        assertTrue(PreviewShapes.currentValue(Json.M.valueToTree(ok.jsonPath().getMap("value"))));
        post("/change-after-decline", body).then().statusCode(200).body("replayed", equalTo(true));
        post("/change-after-decline", body.replace("http-d0", "http-d1").replace("\"expectedBriefVersion\":" + brief,
                "\"expectedBriefVersion\":" + (brief + 1))).then().statusCode(409)
                .body("code", equalTo("decline-change-already-recorded")).body("current.briefVersion", equalTo(brief + 1));
        as().contentType(ContentType.JSON).queryParam("x", "1").body(body).post(BASE + "/change-after-decline").then()
                .statusCode(400).body("code", equalTo("unsupported-query"));
    }

    @Test
    @Order(10)
    void legacyPauseAndResumeAreTheDisengageAndEngageAliases() {
        int brief = version("briefVersion");
        String two = "\"changes\":{\"comfort\":{\"value\":50},\"economy\":{\"value\":50},\"size\":{\"value\":50}}";
        post("/preferences", command("leg-p", brief, version("draftVersion"), two)).then().statusCode(200);
        post("/engage", command("leg-e", brief, version("draftVersion"), "")).then().statusCode(200);
        brief = version("briefVersion");
        String ok = "{\"commandId\":\"leg-pause\",\"expectedBriefVersion\":" + brief + "}";
        int draftBefore = version("draftVersion");
        Response paused = post("/pause", ok);
        paused.then().statusCode(200).body("value.operation", equalTo("disengaged")).body("value.buddy.state", equalTo("disengaged"));
        assertEquals(brief + 1, version("briefVersion"));
        // As in Node the alias checks the brief version first, so a late replay is stale; the receipt itself replays.
        post("/pause", ok).then().statusCode(409).body("code", equalTo("stale-version"));
        Response replay = post("/disengage", command("leg-pause", brief, draftBefore, ""));
        replay.then().statusCode(200).body("replayed", equalTo(true));
        assertEquals(paused.jsonPath().getMap("value"), replay.jsonPath().getMap("value"));
        assertEquals(brief + 1, version("briefVersion"));

        brief = version("briefVersion");
        int draft = version("draftVersion");
        post("/resume", "{\"commandId\":\"leg-stale\",\"expectedBriefVersion\":" + (brief + 3) + "}").then().statusCode(409)
                .body("code", equalTo("stale-version")).body("action", equalTo("refresh")).body("currentVersion", equalTo(brief));
        post("/resume", "{\"commandId\":\"leg-extra\",\"expectedBriefVersion\":" + brief + ",\"expectedDraftVersion\":" + draft + "}")
                .then().statusCode(400).body("code", equalTo("invalid-command"));
        post("/resume", "{\"commandId\":\" \",\"expectedBriefVersion\":" + brief + "}").then().statusCode(400)
                .body("code", equalTo("invalid-command"));
        as().contentType(ContentType.JSON).queryParam("x", "1").body(ok).post(BASE + "/pause").then().statusCode(400)
                .body("code", equalTo("invalid-command"));
        assertEquals(brief, version("briefVersion"));
        post("/resume", "{\"commandId\":\"leg-resume\",\"expectedBriefVersion\":" + brief + "}").then().statusCode(200)
                .body("value.operation", equalTo("engaged")).body("value.buddy.state", equalTo("engaged"));
        assertEquals(brief + 1, version("briefVersion"));
    }
}
