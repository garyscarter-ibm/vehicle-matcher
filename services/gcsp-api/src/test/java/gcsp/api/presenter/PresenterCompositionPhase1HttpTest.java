package gcsp.api.presenter;

import static gcsp.api.presenter.PresenterClockSupport.get;
import static gcsp.api.presenter.PresenterClockSupport.post;
import static org.hamcrest.Matchers.equalTo;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Persistence;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.UUID;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Phase 1 of the composition proof: nothing demo is seeded, reset is refused, and new-app work is written. */
@QuarkusTest
@TestProfile(PresenterCompositionProfiles.Phase1.class)
class PresenterCompositionPhase1HttpTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String DRAFT = "/api/gcsp/v1/manual/draft";

    @ConfigProperty(name = "quarkus.flyway.default-schema")
    String schema;

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    Persistence persistence;

    @Test
    void nothingDemoIsSeededResetIsRefusedAndNewAppWorkIsWritten() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        String presenter = PresenterClockSupport.token(signingJwk, "sub-presenter", "presenter");
        String employee = PresenterClockSupport.token(signingJwk, "sub-employee", "employee");

        PresenterCompositionChecks.noDemoData(schema);
        PresenterCompositionChecks.resetRefused(presenter, employee);

        JsonNode before = get(presenter, "/clock").then().statusCode(200).extract().as(JsonNode.class).get("value");
        long version = before.get("clockVersion").longValue();
        post(presenter, "/clock/advance", "{\"commandId\":\"ac2-adv-" + UUID.randomUUID() + "\",\"expectedClockVersion\":"
                + version + ",\"bySeconds\":90}").then().statusCode(200).body("value.clockVersion", equalTo((int) version + 1));
        post(presenter, "/clock/tick", "{\"tickId\":\"ac2-tick-" + UUID.randomUUID() + "\",\"expectedClockVersion\":"
                + (version + 1) + "}").then().statusCode(200).body("value.state", equalTo("completed"));
        JsonNode clock = get(presenter, "/clock").then().statusCode(200).extract().as(JsonNode.class).get("value");
        assertEquals(version + 1, clock.get("clockVersion").longValue());

        // The employee writes real state under their own token: a saved manual draft.
        String account = PresenterClockSupport.as(employee).get("/api/gcsp/v1/manual/account").then().statusCode(200)
                .extract().asString();
        String context = JSON.readTree(account).get("value").get("contextVersion").asText();
        String save = "{\"commandId\":\"ac2-draft-1\",\"expectedDraftVersion\":0,\"expectedContextVersion\":\"" + context
                + "\",\"choices\":" + PresenterCompositionHr.choices() + "}";
        JsonNode draft = JSON.readTree(PresenterClockSupport.as(employee).body(save).post(DRAFT).then().statusCode(200)
                .body("status", equalTo("ok")).extract().asString()).get("value");
        assertEquals(1, draft.get("draftVersion").intValue());
        assertEquals(PresenterCompositionHr.EMPLOYEE, draft.get("employeeId").textValue());

        ObjectNode facts = JSON.createObjectNode().put("runId", clock.get("runId").textValue())
                .put("clockVersion", clock.get("clockVersion").longValue()).put("now", clock.get("now").textValue())
                .put("draftVersion", draft.get("draftVersion").longValue())
                .put("draftEmployeeId", draft.get("employeeId").textValue());
        System.setProperty(PresenterCompositionProfiles.PHASE1, facts.toString());
    }
}
