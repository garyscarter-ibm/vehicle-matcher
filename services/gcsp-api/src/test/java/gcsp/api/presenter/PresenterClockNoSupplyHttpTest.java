package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;

import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** With no supply provider the stock-release handler is not registered, so release-pull is a missing stage. */
@QuarkusTest
@TestProfile(PresenterClockProfiles.NoSupply.class)
class PresenterClockNoSupplyHttpTest {

    /** The profile's schema as the running app sees it; the profile's own constant is per class loader. */
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    @Test
    void releasePullIsAMissingStageAndTheOtherHandlersStillRun() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        String presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        long v = get(presenter, "/clock").jsonPath().getLong("value.clockVersion");
        post(presenter, "/controls/tick", "{\"commandId\":\"none-1\",\"expectedClockVersion\":" + v
                + ",\"mode\":\"step\"}").then().statusCode(200)
                .body("value.tick.handlerOrder.handlerId", contains("lifecycle-documents", "captured-outbox"))
                .body("value.tick.missingStages", containsInAnyOrder("release-pull", "manual-expiry", "buddy-expiry",
                        "buddy-allocation"));
        given().get("/q/health/ready").then().statusCode(200)
                .body("checks.find { it.name == 'clock' }.data.handlers", equalTo("captured-outbox,lifecycle-documents"));
    }
}
