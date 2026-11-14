package gcsp.api.planning;

import static gcsp.api.planning.PlanningHttpSupport.get;
import static gcsp.api.planning.PlanningHttpSupport.json;
import static gcsp.api.planning.PlanningHttpSupport.preview;
import static gcsp.api.planning.PlanningHttpSupport.token;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.arc.ClientProxy;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The order-plan routes over fixture ports: 200 read and preview, 400, 401, 403, 409 and 422. */
@QuarkusTest
@TestProfile(PlanningHttpSupport.WithPorts.class)
class GregOrderPlanHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    PlanningDemand demand;

    private PlanningFixtures.Ports ports() {
        return (PlanningFixtures.Ports) ClientProxy.unwrap(demand);
    }

    @AfterEach
    void reset() {
        ports().laterDemandVersion = null;
        ports().extraEntitlements = 0;
        ports().demandReads.set(0);
    }

    @Test
    void greg_reads_the_plan_and_previews_an_edit_without_a_write() throws Exception {
        String greg = token(signingJwk, "sub-greg", "greg");
        Response read = get(greg, "");
        assertEquals(200, read.statusCode(), read.asString());
        JsonNode value = json(read).get("value");
        assertEquals("ok", json(read).get("status").textValue());
        assertEquals("feasible", value.get("plan").get("status").textValue());
        assertEquals("no-submission", value.get("replan").get("status").textValue());
        assertEquals("unavailable", value.get("learned").get("status").textValue());

        Response preview = preview(greg, "{\"changes\":[{\"key\":\"orderPlan.budgetMinor\",\"value\":0}]}");
        assertEquals(200, preview.statusCode(), preview.asString());
        JsonNode v = json(preview).get("value");
        assertEquals("none", v.get("writes").textValue());
        assertTrue(v.get("draftPolicyVersion").textValue().startsWith("preview-"));
        assertEquals(value.get("plan").get("planId"), v.get("activePlan").get("planId"));
        // The active policy is still the only version: a later read reports the same plan.
        assertEquals(value.get("plan").get("planId"), json(get(greg, "")).get("value").get("plan").get("planId"));
    }

    @Test
    void bad_requests_are_400_and_other_roles_are_refused() throws Exception {
        String greg = token(signingJwk, "sub-greg", "greg");
        for (String body : new String[] {"", "not json", "{\"changes\":[]} {}", "{\"changes\":[],\"changes\":[]}", "{\"changes\":[]}",
                "[]", "{\"changes\":[{\"key\":\"orderPlan.horizonDays\",\"value\":5}]}", "{\"changes\":[],\"x\":1}"}) {
            Response r = preview(greg, body);
            assertEquals(400, r.statusCode(), body + " -> " + r.asString());
            JsonNode error = json(r);
            assertEquals("invalid", error.get("status").textValue());
            assertFalse(error.get("retryable").booleanValue());
            assertTrue(error.get("reasons").size() > 0, body);
        }
        assertEquals("policy-key-not-editable", json(preview(greg, "{\"changes\":[{\"key\":\"orderPlan.horizonDays\",\"value\":5}]}")).get("code").textValue());
        assertEquals(400, get(greg, "?asOf=2026-01-01T00:00:00Z").statusCode());
        assertEquals(400, preview(greg, "{\"changes\":[]}").statusCode());
        assertEquals(401, get(null, "").statusCode());
        String employee = token(signingJwk, "sub-employee", "employee");
        assertEquals(403, get(employee, "").statusCode());
        assertEquals(403, preview(employee, "{\"changes\":[]}").statusCode());
    }

    @Test
    void changed_inputs_are_409_and_a_plan_beyond_the_solver_limit_is_422_with_its_body() throws Exception {
        String greg = token(signingJwk, "sub-greg", "greg");
        ports().demandReads.set(0);
        ports().laterDemandVersion = "forecast-v2";
        Response conflict = get(greg, "");
        assertEquals(409, conflict.statusCode(), conflict.asString());
        assertEquals("planning-inputs-changed", json(conflict).get("code").textValue());
        assertTrue(json(conflict).get("retryable").booleanValue());
        ports().laterDemandVersion = null;
        ports().extraEntitlements = 130;
        Response unsupported = get(greg, "");
        assertEquals(422, unsupported.statusCode(), unsupported.asString());
        assertEquals("unsupported", json(unsupported).get("status").textValue());
        assertEquals("solver-limit", json(unsupported).get("code").textValue());
        assertTrue(json(unsupported).get("limits").size() > 0);
    }
}
