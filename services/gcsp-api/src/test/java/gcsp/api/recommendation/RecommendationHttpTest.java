package gcsp.api.recommendation;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** POST /api/gcsp/v1/recommendations for Paula over real released-stock rows and account records on the native cluster. */
@QuarkusTest
@TestProfile(RecommendationHttpProfiles.Paula.class)
class RecommendationHttpTest {

    static final String PATH = "/api/gcsp/v1/recommendations";
    static final String BRIEF = "{\"schemaVersion\":1,\"briefVersion\":1,\"preferences\":{\"body\":{\"value\":\"estate\","
            + "\"importance\":100,\"valueState\":\"confirmed\",\"importanceState\":\"confirmed\",\"source\":\"employee\"}},"
            + "\"essentials\":{}}";

    @Inject
    Persistence persistence;

    private List<JsonNode> rows;

    @BeforeEach
    void seed() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        RecommendationDb.seedEmployees();
        RecommendationDb.clearStock();
        rows = new ArrayList<>();
        RecommendationDb.resource("/recommendation-source/source-cases.json").get("cases").get(0).get("rows").forEach(rows::add);
        RecommendationDb.insertStock(rows);
        RecommendationDb.holdForJordan(rows.get(2).get("orderUuid").asText());
    }

    private static RequestSpecification as() {
        return given().header("Authorization", "Bearer " + RecommendationHttpProfiles.TOKEN).contentType(ContentType.JSON);
    }

    private JsonNode expectedFromService() throws Exception {
        SourceFixture.Pager pager = new SourceFixture.Pager(SourceFixture.cars(RecommendationDb.JSON.valueToTree(rows)));
        RecommendationService service = new RecommendationService(SourceFixture.source("paula", pager, new StockFactsEvidence()),
                SourceFixture.policy(), SourceFixture.clock());
        return service.recommend(SourceFixture.context("paula"), RecommendationDb.JSON.readTree(BRIEF));
    }

    @Test
    void refusesBeforeAnythingIsRead() {
        given().contentType(ContentType.JSON).body(BRIEF).post(PATH).then().statusCode(401)
                .contentType(containsString("application/json")).body("code", equalTo("bearer-missing"));
        as().queryParam("employeeId", "employee-jordan").body(BRIEF).post(PATH).then().statusCode(400)
                .contentType(containsString("application/json")).body("status", equalTo("invalid"))
                .body("code", equalTo("unsupported-query")).body("reasons[0].field", equalTo("query"));
        as().body("{\"schemaVersion\":1,\"briefVersion\":1,\"preferences\":{\"nope\":{}},\"essentials\":{}}").post(PATH).then()
                .statusCode(400).body("status", equalTo("invalid")).body("code", equalTo("invalid-brief"));
        as().body("not json").post(PATH).then().statusCode(400).body("code", equalTo("invalid-brief"));
    }

    @Test
    void realRowsGiveTheServiceRankingTermsAndAllowance() throws Exception {
        Response response = as().body(BRIEF).post(PATH);
        response.then().statusCode(200).contentType(containsString("application/json")).body("status", equalTo("ok"));
        JsonNode actual = RecommendationDb.JSON.readTree(response.asString());
        assertEquals(ReleasedStockSourceTest.text(expectedFromService()), ReleasedStockSourceTest.text(actual));
        JsonNode value = actual.get("value");
        assertEquals("recommendations", value.get("state").asText());
        assertEquals(2, value.get("eligibleCount").asInt());
        assertEquals(List.of("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000006"),
                value.get("recommendations").findValuesAsText("orderUuid"));
        assertEquals("gcsp-policy-v1", value.get("versions").get("policy").asText());
        JsonNode first = value.get("recommendations").get(0);
        assertEquals("00000000-0000-4000-8000-000000000001", first.get("orderUuid").asText());
        assertEquals(1100, first.get("terms").get("points").get("value").asInt());
        assertEquals(1300, first.get("terms").get("allowanceInputs").get("allowance").get("value").asInt());
    }

    @Test
    void aCarHiddenByVisibilityIsAbsentAndAnOccupiedCarIsABlocker() throws Exception {
        JsonNode value = RecommendationDb.JSON.readTree(as().body(BRIEF).post(PATH).asString()).get("value");
        List<String> ids = value.get("decisions").findValuesAsText("orderUuid");
        assertEquals(4, ids.size(), ids.toString());
        assertFalse(ids.contains("00000000-0000-4000-8000-000000000004"), "visible only to another employee");
        assertFalse(ids.contains("00000000-0000-4000-8000-000000000005"), "another scheme");
        JsonNode held = null;
        for (JsonNode d : value.get("decisions")) if (d.get("orderUuid").asText().endsWith("3")) held = d;
        assertEquals("ineligible", held.get("gateStatus").asText());
        assertTrue(held.get("blockers").findValuesAsText("code").contains("not-available"), held.get("blockers").toString());
        assertEquals("unavailable", held.get("blockers").get(0).get("availability").get("state").asText());
    }

    @Test
    void anotherEmployeesRecordsNeverAppear() {
        String body = as().body(BRIEF).post(PATH).asString();
        for (String leak : new String[] {"employee-jordan", "slot-jordan", "Jordan", "manual:employee-jordan"}) {
            assertFalse(body.contains(leak), leak);
        }
    }

    @Test
    void emptyStockIsTheNoStockState() throws Exception {
        RecommendationDb.clearStock();
        as().body(BRIEF).post(PATH).then().statusCode(200).body("status", equalTo("ok")).body("value.state", equalTo("no-stock"))
                .body("value.eligibleCount", equalTo(0)).body("value.decisions.size()", equalTo(0));
    }
}
