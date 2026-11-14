package gcsp.api.evidence;

import static io.restassured.RestAssured.given;

import com.fasterxml.jackson.databind.JsonNode;
import io.restassured.specification.RequestSpecification;

/** Shared request helpers and the s4 golden requests that need no stock row. */
final class EvidenceHttpSupport {

    static final String BASE = "/api/gcsp/v1/vehicle-evidence";
    static final JsonNode PROVIDERS = EvidenceFixtures.golden("s4-providers.json");

    private EvidenceHttpSupport() {}

    static RequestSpecification employee() {
        return given().urlEncodingEnabled(false).header("Authorization", "Bearer " + EvidenceHttpProfile.TOKEN);
    }

    /** The URL segment of a golden request: configurations, vins (stock needs a stock port). */
    static String url(JsonNode request) {
        String kind = request.get("kind").textValue();
        String segment = "configuration".equals(kind) ? "configurations" : "vin".equals(kind) ? "vins" : "stock";
        return BASE + "/" + segment + "/" + request.get("id").textValue();
    }
}
