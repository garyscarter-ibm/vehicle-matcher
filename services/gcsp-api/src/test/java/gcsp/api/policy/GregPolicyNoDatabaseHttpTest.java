package gcsp.api.policy;

import static gcsp.api.policy.GregPolicyHttp.change;
import static gcsp.api.policy.GregPolicyHttp.get;
import static gcsp.api.policy.GregPolicyHttp.json;
import static gcsp.api.policy.GregPolicyHttp.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import gcsp.api.brief.BriefPolicyPort;
import io.quarkus.arc.ClientProxy;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** With persistence off the file policy source serves the read and publication is the explicit unsupported refusal. */
@QuarkusTest
@TestProfile(GregPolicyProfiles.NoDatabase.class)
class GregPolicyNoDatabaseHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    BriefPolicyPort briefPolicy;

    @Test
    void theBriefPolicyPortIsThePolicyServiceAdapter() {
        assertTrue(ClientProxy.unwrap(briefPolicy) instanceof PolicyBriefAdapter);
        assertTrue(briefPolicy.assumptions("gcsp-policy-v1").isPresent());
        assertTrue(briefPolicy.assumptions("no-such").isEmpty());
    }

    @Test
    void theReadIs200OverTheFileSourceAndPublishIs422Unsupported() throws Exception {
        String greg = GregPolicyHttp.token(signingJwk, "sub-greg", "greg");
        Response read = get(greg);
        assertEquals(200, read.statusCode(), read.asString());
        JsonNode value = json(read).get("value");
        assertEquals("gcsp-policy-v1", value.get("activeVersion").textValue());
        assertTrue(value.get("fields").size() > 0);

        Response publish = post(greg, "/publish", change("c-1", "gcsp-policy-v1", "greg-x",
                Instant.now().minusSeconds(5), value.get("fields").get(0).get("id").textValue(),
                value.get("fields").get(0).get("value").intValue() + 1));
        assertEquals(422, publish.statusCode(), publish.asString());
        JsonNode error = json(publish);
        assertEquals("unsupported", error.get("status").textValue());
        assertEquals("unsupported-operation", error.get("code").textValue());
        assertTrue(error.get("reason").textValue().length() > 0);
        assertFalse(error.get("retryable").booleanValue());
        assertEquals(401, get(null).statusCode());
        assertEquals(403, get(GregPolicyHttp.token(signingJwk, "sub-employee", "employee")).statusCode());
    }
}
