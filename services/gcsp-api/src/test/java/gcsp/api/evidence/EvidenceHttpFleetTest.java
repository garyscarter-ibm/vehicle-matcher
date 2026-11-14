package gcsp.api.evidence;

import static gcsp.api.evidence.EvidenceHttpSupport.BASE;
import static gcsp.api.evidence.EvidenceHttpSupport.employee;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.io.BufferedReader;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/** The retained fleet store with its retained imagery, byte-verified against the catalogue. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.Fleet.class)
class EvidenceHttpFleetTest {

    static final String MISSING = "bmw-display-" + "0".repeat(20);

    /** A configuration with retained images and the first of its image ids. */
    static String[] withImages() throws Exception {
        Path file = EvidenceHttpProfile.REAL.resolve("fleet-source.v1/versions/28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884/configurations.jsonl");
        try (BufferedReader in = Files.newBufferedReader(file)) {
            for (String line = in.readLine(); line != null; line = in.readLine()) {
                String id = EvidenceFixtures.MAPPER.readTree(line).get("configurationId").textValue();
                String body = employee().get(BASE + "/configurations/" + id).then().extract().asString();
                JsonNode vehicle = EvidenceFixtures.MAPPER.readTree(body).path("value").path("vehicle");
                if ("representative".equals(vehicle.path("images").path("state").textValue())) {
                    return new String[] {id, vehicle.get("images").get("items").get(0).get("imageId").textValue()};
                }
            }
        }
        throw new AssertionError("No fleet configuration has retained images");
    }

    static String catalogueSha(JsonNode node, String imageId) {
        if (node.isObject() && node.has("imageId") && imageId.equals(node.get("imageId").textValue()) && node.has("sha256")) {
            return node.get("sha256").textValue();
        }
        for (JsonNode child : node) {
            String found = catalogueSha(child, imageId);
            if (found != null) return found;
        }
        return null;
    }

    @Test
    void aConfigurationServesRepresentativeImagesAndTheFirstIdIsServedAsVerifiedWebp() throws Exception {
        String[] found = withImages();
        JsonNode catalogue = EvidenceFixtures.MAPPER.readTree(Files.readAllBytes(EvidenceHttpProfile.REAL.resolve("display-images.v1.json")));
        String sha = catalogueSha(catalogue, found[1]);
        assertNotNull(sha);
        byte[] bytes = employee().get("/api/gcsp/v1/vehicle-images/" + found[1] + ".webp").then().statusCode(200)
                .contentType("image/webp").header("Cache-Control", "private, max-age=60")
                .header("X-Content-Type-Options", "nosniff").extract().asByteArray();
        assertEquals(sha, CanonicalJson.sha256Hex(bytes));
        employee().get("/api/gcsp/v1/vehicle-images/" + found[1] + ".webp?x=1").then().statusCode(400);
    }

    @Test
    void unknownAndMalformedImagesAre404AndAnImageNeedsABearer() {
        employee().get("/api/gcsp/v1/vehicle-images/" + MISSING + ".webp").then().statusCode(404)
                .body("code", equalTo("image-not-found")).contentType(containsString("application/json"));
        employee().get("/api/gcsp/v1/vehicle-images/not-an-image.webp").then().statusCode(404).body("code", equalTo("image-not-found"));
        employee().get("/api/gcsp/v1/vehicle-images/" + MISSING).then().statusCode(404);
        given().get("/api/gcsp/v1/vehicle-images/" + MISSING + ".webp").then().statusCode(401);
    }

    @Test
    void readinessReportsTheSelectedFleetVersion() {
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'vehicle-evidence' }.data.datasetId", equalTo("gcsp-source-fleet"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.version", equalTo("2026-11-07.9"))
                .body("checks.find { it.name == 'vehicle-evidence' }.data.manifestDigest",
                        equalTo("28374a10e989560f036c912c4b3d6d6b22d69d5ec212aecfc3921bc202af7884"));
    }
}
