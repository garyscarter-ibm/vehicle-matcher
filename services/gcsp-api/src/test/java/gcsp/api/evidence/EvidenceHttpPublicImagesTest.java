package gcsp.api.evidence;

import static io.restassured.RestAssured.given;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/** Explicitly configured public imagery needs no bearer; evidence reads still do. */
@QuarkusTest
@TestProfile(EvidenceHttpProfile.FleetPublicImages.class)
class EvidenceHttpPublicImagesTest {

    @Test
    void anImageIsServedWithoutABearerWhileEvidenceStillNeedsOne() throws Exception {
        String[] found = EvidenceHttpFleetTest.withImages();
        given().get("/api/gcsp/v1/vehicle-images/" + found[1] + ".webp").then().statusCode(200).contentType("image/webp")
                .header("Cache-Control", "private, max-age=60");
        given().get(EvidenceHttpSupport.BASE + "/configurations/" + found[0]).then().statusCode(401);
    }
}
