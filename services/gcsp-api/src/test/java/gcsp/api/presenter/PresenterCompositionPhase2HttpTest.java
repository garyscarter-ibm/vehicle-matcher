package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Phase 2: the app restarted on phase 1's schema still holds the run, the clock and the employee's draft. */
@QuarkusTest
@TestProfile(PresenterCompositionProfiles.Phase2.class)
class PresenterCompositionPhase2HttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static String ownedSchema;

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @AfterAll
    static void drop() throws Exception {
        PresenterClockSupport.dropSchema(ownedSchema);
    }

    @Test
    void aRestartedAppKeepsTheRunTheClockAndTheDraftAndStillRefusesReset() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        String recorded = System.getProperty(PresenterCompositionProfiles.PHASE1);
        assertNotNull(recorded, "Phase 1 must run first in the same JVM (PresenterCompositionPhase1HttpTest)");
        JsonNode phase1 = JSON.readTree(recorded);
        String presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        String employee = PresenterClockSupport.token(signingJwk, "sub-employee", "employee");

        JsonNode clock = get(presenter, "/clock").then().statusCode(200).extract().as(JsonNode.class).get("value");
        assertEquals(phase1.get("runId").textValue(), clock.get("runId").textValue());
        // The restart's startup tick only runs the startup stages and does not advance time.
        assertEquals(phase1.get("now").textValue(), clock.get("now").textValue());
        assertTrue(clock.get("clockVersion").longValue() >= phase1.get("clockVersion").longValue());

        JsonNode draft = JSON.readTree(PresenterClockSupport.as(employee).get("/api/gcsp/v1/manual/draft").then()
                .statusCode(200).extract().asString());
        assertEquals("ok", draft.get("status").textValue());
        assertEquals(phase1.get("draftVersion").longValue(), draft.get("value").get("draftVersion").longValue());
        assertEquals(phase1.get("draftEmployeeId").textValue(), draft.get("value").get("employeeId").textValue());

        PresenterCompositionChecks.noDemoData(schema);
        PresenterCompositionChecks.resetRefused(presenter, employee);
    }
}
