package gcsp.api.planning;

import static gcsp.api.planning.PlanningHttpSupport.get;
import static gcsp.api.planning.PlanningHttpSupport.json;
import static gcsp.api.planning.PlanningHttpSupport.preview;
import static gcsp.api.planning.PlanningHttpSupport.token;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** With no demand or supply adapter bound, the routes are an honest 503 and never a synthetic plan. */
@QuarkusTest
@TestProfile(PlanningHttpSupport.Defaults.class)
class GregOrderPlanDefaultsHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    PlanningDemand demand;

    @Inject
    PlanningSupply supply;

    @Inject
    SubmissionHistory history;

    @Test
    void the_default_ports_are_the_unconfigured_ones_and_history_is_production_backed() {
        assertTrue(ClientProxy.unwrap(demand) instanceof PlanningDefaults.UnconfiguredDemand);
        assertTrue(ClientProxy.unwrap(supply) instanceof PlanningDefaults.UnconfiguredSupply);
        assertTrue(ClientProxy.unwrap(history) instanceof gcsp.api.production.ProductionSubmissionHistory);
        assertEquals("no-submission", history.replan(null, null).get("status").textValue());
    }

    @Test
    void read_and_preview_are_503_with_the_missing_port_named() throws Exception {
        String greg = token(signingJwk, "sub-greg", "greg");
        Response read = get(greg, "");
        assertEquals(503, read.statusCode(), read.asString());
        JsonNode error = json(read);
        assertEquals("unavailable", error.get("status").textValue());
        assertEquals("planning-forecast-not-configured", error.get("code").textValue());
        assertTrue(error.get("retryable").booleanValue());
        Response preview = preview(greg, "{\"changes\":[{\"key\":\"orderPlan.budgetMinor\",\"value\":0}]}");
        assertEquals(503, preview.statusCode(), preview.asString());
        assertEquals("planning-forecast-not-configured", json(preview).get("code").textValue());
        assertEquals(403, get(token(signingJwk, "sub-employee", "employee"), "").statusCode());
    }
}
