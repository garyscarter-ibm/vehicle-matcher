package gcsp.api.policy;

import static gcsp.api.policy.GregPolicyHttp.JSON;
import static gcsp.api.policy.GregPolicyHttp.change;
import static gcsp.api.policy.GregPolicyHttp.field;
import static gcsp.api.policy.GregPolicyHttp.get;
import static gcsp.api.policy.GregPolicyHttp.json;
import static gcsp.api.policy.GregPolicyHttp.post;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Greg's policy controls over HTTP on the native test cluster, in a throwaway schema; skips without the URL. */
@QuarkusTest
@TestProfile(GregPolicyProfiles.Persisted.class)
class GregPolicyHttpTest {

    private static final String V1 = "gcsp-policy-v1";
    private static final AtomicInteger SERIAL = new AtomicInteger();
    private static final GregPolicyHttp.StepClock CLOCK = new GregPolicyHttp.StepClock();
    private static final Path OUTCOMES = Path.of("src/test/resources/policy-http/outcomes.json");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @ConfigProperty(name = "quarkus.flyway.schemas")
    String schema;

    private static volatile String ownedSchema;

    @Inject
    Persistence persistence;

    @Inject
    PolicyService policy;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private String greg;
    private String employee;
    private String presenter;

    @BeforeEach
    void setUp() throws Exception {
        Assumptions.assumeTrue(persistence.active(), "GCSP_TEST_DATABASE_URL is not set");
        ownedSchema = schema;
        QuarkusMock.installMockForType(CLOCK, WallPolicyClock.class);
        greg = GregPolicyHttp.token(signingJwk, "sub-greg", "greg");
        employee = GregPolicyHttp.token(signingJwk, "sub-employee", "employee");
        presenter = GregPolicyHttp.token(signingJwk, "sub-presenter", "presenter");
    }

    @AfterAll
    static void dropSchema() throws Exception {
        if (ownedSchema == null || !ownedSchema.startsWith("gcsp_p_http_")) {
            return;
        }
        try (Connection c = GregPolicyProfiles.plain().getConnection(); Statement st = c.createStatement()) {
            st.execute("DROP SCHEMA IF EXISTS " + ownedSchema + " CASCADE");
        }
    }

    private JsonNode read() throws Exception {
        Response response = get(greg);
        assertEquals(200, response.statusCode(), response.asString());
        return json(response).get("value");
    }

    private String uniqueName(String prefix) {
        return prefix + "-" + SERIAL.incrementAndGet();
    }

    @Test
    void withoutABearerEveryRouteIs401() throws Exception {
        assertEquals(401, get(null).statusCode());
        assertEquals(401, post(null, "/publish", "{}").statusCode());
        Response preview = post(null, "/preview", "{}");
        assertEquals(401, preview.statusCode());
        assertEquals("bearer-missing", json(preview).get("code").textValue());
    }

    @Test
    void anEmployeeAndAPresenterAreRefused403OnEveryRoute() throws Exception {
        for (String token : new String[] {employee, presenter}) {
            assertEquals(403, get(token).statusCode());
            assertEquals(403, post(token, "/publish", "{}").statusCode());
            Response preview = post(token, "/preview", "{}");
            assertEquals(403, preview.statusCode());
            JsonNode body = json(preview);
            assertEquals("forbidden", body.get("status").textValue());
            assertEquals("role-required", body.get("code").textValue());
        }
    }

    @Test
    void gregReadsTheActiveVersionWithPriceAndWeightFieldsAndNoSeedTables() throws Exception {
        CLOCK.advance();
        JsonNode value = read();
        assertEquals("draft", value.get("state").textValue());
        assertTrue(value.get("activeVersion").textValue().length() > 0);
        assertTrue(value.get("activeVersionLabel").textValue().length() > 0);
        assertEquals(PolicyClock.iso(CLOCK.now), value.get("asOf").textValue());
        assertEquals("Published versions preserve existing quotes and offers.", value.get("historyMessage").textValue());
        assertTrue(value.get("heldOffers").get("count").isNull());
        assertEquals("offers", value.get("heldOffers").get("unit").textValue());
        assertFalse(value.has("clockVersion"));
        boolean price = false;
        boolean weight = false;
        for (JsonNode f : value.get("fields")) {
            String kind = f.get("kind").textValue();
            assertTrue(f.get("value").isIntegralNumber(), f.toString());
            assertTrue(f.hasNonNull("source") && f.hasNonNull("basis") && f.hasNonNull("status"), f.toString());
            assertEquals(0, f.get("minimum").intValue());
            assertEquals(1, f.get("step").intValue());
            price |= "price".equals(kind) && f.get("id").textValue().startsWith("price:") && f.hasNonNull("schemeLabel");
            weight |= "weight".equals(kind) && f.get("id").textValue().startsWith("weight:")
                    && "relative-weight".equals(f.get("unit").textValue());
        }
        assertTrue(price && weight);
        assertTrue(field(value, "weight:body").has("adoptionRequired"));
        for (String table : new String[] {"pricePlans", "allowances", "assumptions", "schemeRuleLinks", "eligibilityRules"}) {
            assertFalse(value.has(table), table);
        }
        assertFalse(json(get(greg)).has("assumptions"));
    }

    @Test
    void aPublishedPriceChangeIsActiveForLaterReadsWhileAPinnedReadKeepsTheOldTerms() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        String key = first.get("key").textValue();
        int oldPoints = first.get("value").intValue();
        String oldVersion = before.get("activeVersion").textValue();
        String version = "greg-" + uniqueName("price");

        Response published = post(greg, "/publish", change(uniqueName("cmd"), oldVersion, version, CLOCK.now, id, oldPoints + 25));
        assertEquals(200, published.statusCode(), published.asString());
        JsonNode value = json(published).get("value");
        assertEquals(version, value.get("policyVersion").textValue());
        assertEquals("published", value.get("state").textValue());
        assertTrue(value.get("accepted").booleanValue());
        assertEquals("active", value.get("activation").get("status").textValue());
        assertTrue(value.get("activation").get("publishedVersionActive").booleanValue());
        assertTrue(value.get("heldOffers").get("count").isNull());
        assertEquals("sub-greg", value.get("publisher").textValue());

        JsonNode after = read();
        assertEquals(version, after.get("activeVersion").textValue());
        assertEquals("Greg's change", after.get("activeVersionLabel").textValue());
        assertEquals(oldPoints + 25, field(after, id).get("value").intValue());
        assertEquals("greg-policy-publish", field(after, id).get("source").textValue());

        String at = PolicyClock.iso(CLOCK.now);
        assertEquals(oldPoints, monthlyPoints(policy.getPolicySnapshot(new PolicyRead("run-1", at, oldVersion)), key));
        assertEquals(oldPoints + 25, monthlyPoints(policy.getPolicySnapshot(new PolicyRead("run-1", at, null)), key));
        assertEquals(oldVersion, policy.getPolicySnapshot(new PolicyRead("run-1", at, oldVersion)).policyVersion());
    }

    private static int monthlyPoints(PolicyResult snapshot, String key) {
        assertTrue(snapshot.ok(), snapshot.body().toString());
        for (JsonNode row : snapshot.value().get("pricePlans")) {
            if (key.equals(row.get("key").textValue())) {
                return row.get("monthlyPoints").intValue();
            }
        }
        throw new IllegalStateException(key);
    }

    @Test
    void replayingTheSameCommandIs200WithTheSameBodyAndChangedInputIs409() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String command = uniqueName("replay");
        ObjectNode body = change(command, before.get("activeVersion").textValue(), "greg-" + command, CLOCK.now, id, points + 3);
        Response one = post(greg, "/publish", body);
        Response two = post(greg, "/publish", body);
        assertEquals(200, one.statusCode(), one.asString());
        assertEquals(200, two.statusCode(), two.asString());
        assertEquals(json(one), json(two));

        ObjectNode changed = change(command, before.get("activeVersion").textValue(), "greg-" + command, CLOCK.now, id, points + 4);
        Response conflict = post(greg, "/publish", changed);
        assertEquals(409, conflict.statusCode(), conflict.asString());
        JsonNode error = json(conflict);
        assertEquals("conflict", error.get("status").textValue());
        assertEquals("command-input-changed", error.get("code").textValue());
        assertTrue(error.get("reason").textValue().length() > 0);
        assertFalse(error.get("retryable").booleanValue());
        assertEquals("greg-" + command, json(get(greg)).get("value").get("activeVersion").textValue());
    }

    @Test
    void aStaleExpectedActiveVersionIs409WithTheRefreshHint() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String old = before.get("activeVersion").textValue();
        Response ok = post(greg, "/publish", change(uniqueName("c"), old, "greg-" + uniqueName("a"), CLOCK.now, id, points + 1));
        assertEquals(200, ok.statusCode(), ok.asString());
        CLOCK.advance();
        Response stale = post(greg, "/publish", change(uniqueName("c"), old, "greg-" + uniqueName("b"), CLOCK.now, id, points + 2));
        assertEquals(409, stale.statusCode(), stale.asString());
        JsonNode error = json(stale);
        assertEquals("stale-version", error.get("status").textValue());
        assertEquals("stale-version", error.get("code").textValue());
        assertEquals("The policy changed. Refresh and try again.", error.get("reason").textValue());
        assertEquals("refresh", error.get("action").textValue());
        assertEquals(old, error.get("expectedVersion").textValue());
        assertNotEquals(old, error.get("currentVersion").textValue());
        assertFalse(error.get("retryable").booleanValue());
    }

    @Test
    void invalidChangeSetsAre400WithReasonsAndNothingIsPublished() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        String old = before.get("activeVersion").textValue();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();

        assertInvalid(post(greg, "/publish", change("c-1", old, "greg-x", CLOCK.now, "price:nope", 5)),
                "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/publish", change("c-2", old, "greg-x", CLOCK.now, id, points)),
                "no-policy-change", "changes");
        assertInvalid(post(greg, "/publish", change("c-3", old, "greg-x", CLOCK.now, id, -1)),
                "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/publish", change("c-4", old, "greg-x", CLOCK.now.plusSeconds(60), id, points + 1)),
                "invalid-change-set", "changeSet");
        assertInvalid(post(greg, "/publish", change("c-5", "no-such-version", "greg-x", CLOCK.now, id, points + 1)),
                "invalid-active-version", "expectedActiveVersion");
        ObjectNode extra = change("c-6", old, "greg-x", CLOCK.now, id, points + 1);
        extra.put("surprise", true);
        assertInvalid(post(greg, "/publish", extra), "invalid-change-set", "changeSet");
        assertInvalid(post(greg, "/publish", "not json"), "invalid-change-set", "body");
        assertInvalid(post(greg, "/publish", "[]"), "invalid-change-set", "body");
        assertEquals(old, read().get("activeVersion").textValue());
    }

    private static void assertInvalid(Response response, String code, String field) throws Exception {
        assertEquals(400, response.statusCode(), response.asString());
        JsonNode body = json(response);
        assertEquals("invalid", body.get("status").textValue());
        assertEquals(code, body.get("code").textValue());
        assertTrue(body.get("reason").textValue().length() > 0);
        assertFalse(body.get("retryable").booleanValue());
        assertEquals(field, body.get("reasons").get(0).get("field").textValue());
    }

    @Test
    void aWeightChangeAdoptsTheNeutralWeightsAndIsReadBack() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode weight = field(before, "weight:body");
        int old = weight.get("value").intValue();
        Response published = post(greg, "/publish", change(uniqueName("w"), before.get("activeVersion").textValue(),
                "greg-" + uniqueName("weight"), CLOCK.now, "weight:body", old + 2));
        assertEquals(200, published.statusCode(), published.asString());
        JsonNode after = read();
        assertEquals(old + 2, field(after, "weight:body").get("value").intValue());
        assertFalse(after.get("weightsAdoptionRequired").booleanValue());
        assertFalse(field(after, "weight:body").get("adoptionRequired").booleanValue());
    }

    @Test
    void previewIs422BecauseGregDemandAndFitAreNotInJavaYet() throws Exception {
        Response response = post(greg, "/preview", "{}");
        assertEquals(422, response.statusCode());
        JsonNode body = json(response);
        assertEquals("unsupported", body.get("status").textValue());
        assertEquals("preview-unavailable", body.get("code").textValue());
        assertEquals("Policy preview is not available on this service yet.", body.get("reason").textValue());
        assertFalse(body.get("retryable").booleanValue());
    }

    @Test
    void anyQueryParameterIs400OnEveryRoute() throws Exception {
        for (Response response : new Response[] {
                io.restassured.RestAssured.given().header("Authorization", "Bearer " + greg).get(GregPolicyHttp.PATH + "?run=x"),
                io.restassured.RestAssured.given().header("Authorization", "Bearer " + greg)
                        .post(GregPolicyHttp.PATH + "/publish?x=1"),
                io.restassured.RestAssured.given().header("Authorization", "Bearer " + greg)
                        .post(GregPolicyHttp.PATH + "/preview?x=1")}) {
            assertEquals(400, response.statusCode());
            assertEquals("unsupported-query", json(response).get("code").textValue());
        }
    }

    @Test
    void theBackendPresentationOutcomesTheGregScreenConsumesAreStable() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String old = before.get("activeVersion").textValue();
        String version = "greg-" + uniqueName("outcome");
        Map<String, String> names = new TreeMap<>(Map.of(version, "<new>", old, "<old>", PolicyClock.iso(CLOCK.now), "<now>"));

        Response accepted = post(greg, "/publish", change(uniqueName("o"), old, version, CLOCK.now, id, points + 9));
        CLOCK.advance();
        Response stale = post(greg, "/publish", change(uniqueName("o"), old, "greg-" + uniqueName("s"), CLOCK.now, id, points + 10));
        names.put(PolicyClock.iso(CLOCK.now), "<later>");
        Response invalid = post(greg, "/publish", change("o-invalid", version, "greg-x", CLOCK.now, "price:nope", 1));
        Response forbidden = post(employee, "/publish", "{}");
        Response unauthenticated = post(null, "/publish", "{}");
        Response preview = post(greg, "/preview", "{}");

        ObjectNode outcomes = JSON.createObjectNode();
        outcomes.set("accepted", outcome(accepted, names));
        outcomes.set("invalid", outcome(invalid, names));
        outcomes.set("stale", outcome(stale, names));
        outcomes.set("forbidden", outcome(forbidden, names));
        outcomes.set("unauthenticated", outcome(unauthenticated, names));
        outcomes.set("previewUnavailable", outcome(preview, names));
        if (Boolean.getBoolean("gcsp.snapshot.update")) {
            Files.createDirectories(OUTCOMES.getParent());
            Files.writeString(OUTCOMES, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(outcomes) + "\n");
        }
        assertEquals(JSON.readTree(Files.readString(OUTCOMES)), outcomes);
        for (Iterator<JsonNode> each = outcomes.elements(); each.hasNext();) {
            JsonNode http = each.next();
            if (http.get("http").intValue() >= 400) {
                JsonNode body = http.get("body");
                assertTrue(body.hasNonNull("code") && body.hasNonNull("reason") && body.has("retryable"), body.toString());
            }
        }
        assertNull(outcomes.get("accepted").get("body").get("code"));
    }

    private static ObjectNode outcome(Response response, Map<String, String> names) throws Exception {
        String text = response.asString();
        for (Map.Entry<String, String> name : names.entrySet()) {
            text = text.replace(name.getKey(), name.getValue());
        }
        ObjectNode out = JSON.createObjectNode();
        out.put("http", response.statusCode());
        out.set("body", JSON.readTree(text));
        return out;
    }
}
