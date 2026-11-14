package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.PROVIDERS;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** The lookup provider over the retained reference store: bodies equal the s4 consumer output. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.class)
class EvidenceHttpTest {

    @TestHTTPResource
    URL url;

    static final String CONFIG = "UkVGMTpSRUZFUkVOQ0U=";
    static final String VIN = "WBA33DB08TC426611";

    static JsonNode expected(int index, String provider) {
        return PROVIDERS.get("cases").get(index).get(provider);
    }

    static void assertSuccess(int index, String provider, String url) throws Exception {
        String body = employee().get(url).then().statusCode(200).header("Cache-Control", equalTo("no-store"))
                .body("status", equalTo("ok")).extract().asString();
        JsonNode actual = EvidenceFixtures.MAPPER.readTree(body);
        JsonNode want = expected(index, provider);
        assertNull(LookupCases.diff("$.vehicle", want.get("vehicle"), actual.get("value").get("vehicle")));
        assertEquals(want.get("status"), actual.get("value").get("status"));
        assertEquals(want.get("contractVersion"), actual.get("value").get("contractVersion"));
        assertTrue(!actual.get("value").has("transport") && !actual.get("value").has("failure"));
    }

    @Test
    void configurationAndVinBodiesEqualTheConsumerOutput() throws Exception {
        for (int index : new int[] {0, 1, 2}) {
            assertSuccess(index, "lookup", EvidenceHttpSupport.url(PROVIDERS.get("cases").get(index).get("request")));
        }
    }

    @Test
    void encodedIdsAreDecodedFromTheRawSingleSegment() throws Exception {
        assertSuccess(0, "lookup", BASE + "/configurations/UkVGMTpSRUZFUkVOQ0U%3D");
        assertSuccess(0, "lookup", BASE + "/configurations/%55kVGMTpSRUZFUkVOQ0U%3D");
        assertSuccess(2, "lookup", BASE + "/vins/wba33db08tc426611");
    }

    @Test
    void slashPlusAndBadEscapesAreInvalidInputNeverAMatch() {
        for (String id : new String[] {"UkVGMTpSRUZFUkVOQ0U%2F", "UkVGMTpS%2BUZFUkVOQ0U%3D", "UkVGMTpS+UZFUkVOQ0U=", "%2F", "%C3%28",
                "UkVGMTpSRUZFUkVOQ0U%3D%0A"}) {
            employee().get(BASE + "/configurations/" + id).then().statusCode(400).body("status", equalTo("invalid"))
                    .body("code", equalTo("invalid-vehicle-identifier")).body("action", equalTo("correct-identifier"))
                    .body("retryable", equalTo(false)).header("Cache-Control", equalTo("no-store"))
                    .body(not(containsString(id)));
        }
        // A literal slash splits the path into two segments, so it is never one id.
        employee().get(BASE + "/configurations/UkVGMTpS/UZFUkVOQ0U=").then().statusCode(400)
                .body("code", equalTo("invalid-vehicle-identifier"));
        employee().get(BASE + "/vins/").then().statusCode(400).body("code", equalTo("invalid-vehicle-identifier"));
        employee().get(BASE + "/vins/" + VIN + "/extra").then().statusCode(400);
    }

    @Test
    void theFrameworkKeepsEncodedSlashAndPlusInTheRawPath() {
        for (String raw : new String[] {"a%2Fb", "a%2fb", "a%2Bb%3D", "a+b", "a/b", "a%252Fb"}) {
            employee().get("/test-raw-path/" + raw).then().statusCode(200).body(equalTo("/test-raw-path/" + raw));
        }
    }

    @Test
    void aMalformedEscapeOnTheWireIsRefusedByTheServerWith400() throws Exception {
        for (String id : new String[] {"%zz", "%E0%A4%A", "%"}) {
            String reply;
            try (Socket socket = new Socket(url.getHost(), url.getPort())) {
                socket.getOutputStream().write(("GET " + BASE + "/configurations/" + id + " HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer "
                        + EvidenceHttpProfile.TOKEN + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                reply = new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            }
            assertTrue(reply.startsWith("HTTP/1.1 400"), id + " -> " + reply);
            // Vert.x refuses the request line itself: 400 with an empty body, before any resource runs.
            assertTrue(reply.contains("content-length: 0"), reply);
        }
    }

    @Test
    void notFoundInvalidAndQueryAnswerTheEnvelope() {
        employee().get(BASE + "/vins/WBA33DB08TC426612").then().statusCode(404).body("status", equalTo("not-found"))
                .body("code", equalTo("vehicle-not-found")).body("action", equalTo("check-identifier"))
                .body("retryable", equalTo(false)).body(not(containsString("WBA33DB08TC426612")));
        employee().get(BASE + "/vins/not-a-vin").then().statusCode(400).body("code", equalTo("invalid-vehicle-identifier"));
        employee().get(BASE + "/configurations/" + CONFIG + "?provider=alternate-offline").then().statusCode(400)
                .body("status", equalTo("invalid"));
        employee().get(BASE + "/vins/" + VIN + "?x=").then().statusCode(400);
    }

    @Test
    void unknownKindAndRouteAreJson404() {
        employee().get(BASE + "/widgets/1").then().statusCode(404).body("code", equalTo("route-not-found"))
                .contentType(containsString("application/json"));
        employee().get(BASE).then().statusCode(404).body("code", equalTo("route-not-found"));
        employee().get(BASE + "/vins").then().statusCode(400).body("code", equalTo("invalid-vehicle-identifier"));
    }

    @Test
    void stockIsUnavailableWithoutAStockPort() {
        employee().get(BASE + "/stock/1d736acd-674c-4bb1-8b6b-45dc56906442").then().statusCode(503)
                .body("status", equalTo("unavailable")).body("code", equalTo("vehicle-source-unavailable"))
                .body("retryable", equalTo(true)).body("action", equalTo("retry-source"));
    }

    @Test
    void authenticationAndRolesGateEveryRead() {
        given().get(BASE + "/vins/" + VIN).then().statusCode(401).body("code", equalTo("bearer-missing"));
        given().header("Authorization", "Bearer wrong").get(BASE + "/vins/" + VIN).then().statusCode(401);
        given().get(BASE + "/widgets/1").then().statusCode(401);
        given().get("/api/gcsp/v1/vehicle-images/bmw-display-" + "a".repeat(20) + ".webp").then().statusCode(401)
                .body("code", equalTo("bearer-missing"));
    }

    @Test
    void readinessReportsTheActiveCorpus() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'vehicle-evidence' }.status", equalTo("UP"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.provider", equalTo("lookup"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.datasetId", equalTo("publication-reference"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.manifestDigest",
                        equalTo("c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.recovered", equalTo(false))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.catalogue", equalTo("available"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.definitions", equalTo("available"));
    }
}
