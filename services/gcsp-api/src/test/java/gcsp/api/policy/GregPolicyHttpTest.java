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
import gcsp.api.clock.ClockConfiguration;
import gcsp.api.clock.ClockReading;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.clock.ScenarioClockStart;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
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
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

/** Greg's policy controls over HTTP on the native test cluster, in a throwaway schema; skips without the URL. */
@QuarkusTest
@TestProfile(GregPolicyProfiles.Persisted.class)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
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
    RunClockHolder runClock;

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
        QuarkusMock.installMockForType(new GregPolicyClock(CLOCK, ctx -> Optional.of(CLOCK.now)), GregPolicyClock.class);
        greg = GregPolicyHttp.token(signingJwk, "sub-greg", "greg");
        employee = GregPolicyHttp.token(signingJwk, "sub-employee", "employee");
        presenter = GregPolicyHttp.token(signingJwk, "sub-presenter", "presenter");
    }

    private long policyRows() throws Exception {
        try (Connection c = GregPolicyProfiles.plain().getConnection(); Statement st = c.createStatement()) {
            st.execute("SET search_path TO " + schema);
            try (java.sql.ResultSet rs = st.executeQuery("SELECT (SELECT count(*) FROM policy_documents) "
                    + "+ (SELECT count(*) FROM policy_versions) + (SELECT count(*) FROM policy_run_activation)")) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    private static ObjectNode previewBody(String expected, Object... edits) {
        ObjectNode body = JSON.createObjectNode();
        body.put("expectedActiveVersion", expected);
        com.fasterxml.jackson.databind.node.ArrayNode changes = body.putArray("changes");
        for (int i = 0; i < edits.length; i += 2) {
            changes.addObject().put("id", (String) edits[i]).put("value", (Integer) edits[i + 1]);
        }
        return body;
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
    void aSecondWeightChangeOnAWeightedVersionIsReadBackAndANegativeOneIs400() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        int old = field(before, "weight:body").get("value").intValue();
        Response first = post(greg, "/publish", change(uniqueName("w"), before.get("activeVersion").textValue(),
                "greg-" + uniqueName("weight"), CLOCK.now, "weight:body", old + 1));
        assertEquals(200, first.statusCode(), first.asString());
        CLOCK.advance();
        JsonNode weighted = read();
        assertFalse(weighted.get("weightsAdoptionRequired").booleanValue());
        String active = weighted.get("activeVersion").textValue();
        assertInvalid(post(greg, "/publish", change(uniqueName("w"), active, "greg-" + uniqueName("neg"), CLOCK.now, "weight:fuel", -1)),
                "invalid-editable-field", "changes");
        Response second = post(greg, "/publish", change(uniqueName("w"), active, "greg-" + uniqueName("weight"), CLOCK.now, "weight:fuel", 4));
        assertEquals(200, second.statusCode(), second.asString());
        JsonNode after = read();
        assertEquals(4, field(after, "weight:fuel").get("value").intValue());
        assertEquals(old + 1, field(after, "weight:body").get("value").intValue());
    }

    @Test
    void aPriceChangePreviewReturnsTheNodeShapeWithBothDemandsAndWritesNothing() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String active = before.get("activeVersion").textValue();
        long rows = policyRows();

        Response response = post(greg, "/preview", previewBody(active, id, points + 7));
        assertEquals(200, response.statusCode(), response.asString());
        JsonNode body = json(response);
        assertEquals("ok", body.get("status").textValue());
        JsonNode value = body.get("value");
        assertEquals("preview-ready", value.get("state").textValue());
        assertTrue(value.get("preview").booleanValue());
        assertEquals(active, value.get("activeVersion").textValue());
        String draft = value.get("draftVersion").textValue();
        assertTrue(draft.matches("preview-[0-9a-f]{24}"), draft);
        assertEquals(PolicyClock.iso(CLOCK.now), value.get("asOf").textValue());
        assertEquals(1, value.get("clockVersion").longValue());
        assertEquals(1, value.get("differences").size());
        JsonNode difference = value.get("differences").get(0);
        assertEquals(id, difference.get("id").textValue());
        assertEquals(points, difference.get("before").intValue());
        assertEquals(points + 7, difference.get("after").intValue());
        assertEquals(first.path("unit").textValue(), difference.path("unit").textValue());
        assertEquals(active, value.at("/active/demand/privacy/policyVersion").textValue());
        assertEquals(draft, value.at("/draft/demand/privacy/policyVersion").textValue());
        assertTrue(value.at("/active/demand/privacy/threshold").intValue() >= 1);
        assertTrue(value.get("heldOffers").get("count").isNull());
        for (String side : new String[] {"active", "draft"}) {
            JsonNode fit = value.at("/" + side + "/fit");
            assertEquals("saved-brief-recommendation-fit", fit.get("basis").textValue());
            assertEquals("Recommendation fit, not predicted acceptance", fit.get("label").textValue());
            assertEquals("band", fit.at("/employeesWithEligibleStock/kind").textValue());
            assertEquals("band", fit.at("/scoredBriefs/kind").textValue());
            assertEquals("suppressed", fit.at("/meanBestScore/status").textValue());
            assertEquals("score/100", fit.at("/meanBestScore/unit").textValue());
            assertFalse(fit.at("/scoredBriefs").has("value"));
        }

        assertEquals(draft, json(post(greg, "/preview", previewBody(active, id, points + 7))).at("/value/draftVersion").textValue());
        assertNotEquals(draft, json(post(greg, "/preview", previewBody(active, id, points + 8))).at("/value/draftVersion").textValue());
        assertEquals(rows, policyRows());
        assertEquals(active, read().get("activeVersion").textValue());
        assertEquals(points, field(read(), id).get("value").intValue());
    }

    @Test
    void aWeightChangePreviewDiffersOnTheWeight() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        int old = field(before, "weight:body").get("value").intValue();
        String active = before.get("activeVersion").textValue();
        Response response = post(greg, "/preview", previewBody(active, "weight:body", old + 2));
        assertEquals(200, response.statusCode(), response.asString());
        JsonNode difference = json(response).at("/value/differences/0");
        assertEquals("weight:body", difference.get("id").textValue());
        assertEquals(old, difference.get("before").intValue());
        assertEquals(old + 2, difference.get("after").intValue());
        assertEquals("relative-weight", difference.get("unit").textValue());
    }

    @Test
    void aPreviewAgainstAStaleActiveVersionIs409WithTheCurrentVersion() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        Response stale = post(greg, "/preview", previewBody("older-version", id, points + 1));
        assertEquals(409, stale.statusCode(), stale.asString());
        JsonNode error = json(stale);
        assertEquals("stale-version", error.get("status").textValue());
        assertEquals("older-version", error.get("expectedVersion").textValue());
        assertEquals(before.get("activeVersion").textValue(), error.get("currentVersion").textValue());
        assertEquals("refresh", error.get("action").textValue());
        assertFalse(error.has("accepted"));
    }

    @Test
    void publishAcceptsAPreviewAtTheCurrentVersionAndThatPreviewIsThenStale() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String active = before.get("activeVersion").textValue();
        JsonNode preview = json(post(greg, "/preview", previewBody(active, id, points + 4))).get("value");
        assertEquals(active, preview.get("activeVersion").textValue());
        // The screen publishes the preview's binding with effectiveFrom = preview asOf.
        Instant asOf = Instant.parse(preview.get("asOf").textValue());
        Response published = post(greg, "/publish", change(uniqueName("c"), active, "greg-" + uniqueName("p"), asOf, id, points + 4));
        assertEquals(200, published.statusCode(), published.asString());
        assertEquals(points + 4, field(read(), id).get("value").intValue());

        CLOCK.advance();
        Response again = post(greg, "/preview", previewBody(active, id, points + 6));
        assertEquals(409, again.statusCode(), again.asString());
        Response republish = post(greg, "/publish", change(uniqueName("c"), active, "greg-" + uniqueName("q"), CLOCK.now, id, points + 6));
        assertEquals(409, republish.statusCode(), republish.asString());
        assertEquals("stale-version", json(republish).get("status").textValue());
    }

    @Test
    @Order(Integer.MAX_VALUE)
    void publishOnATickingWallClockStillAcceptsThePreviewsAsOf() throws Exception {
        // Runs last: it publishes at run-clock time, which would postdate the StepClock versions of the other tests.
        Instant[] wall = {Instant.now()};
        WallPolicyClock ticking = new WallPolicyClock() {
            @Override
            public Instant now(RunContext context) {
                wall[0] = wall[0].plusSeconds(1);
                return wall[0];
            }
        };
        QuarkusMock.installMockForType(ticking, WallPolicyClock.class);
        QuarkusMock.installMockForType(new GregPolicyClock(ticking, ctx -> {
            try {
                return runClock.clock().now(ctx.environmentId(), ctx.runId()).map(ClockReading::now);
            } catch (RuntimeException e) {
                return Optional.empty();
            }
        }), GregPolicyClock.class);
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String active = before.get("activeVersion").textValue();
        JsonNode preview = json(post(greg, "/preview", previewBody(active, id, points + 3))).get("value");
        Instant asOf = Instant.parse(preview.get("asOf").textValue());
        Response published = post(greg, "/publish", change(uniqueName("c"), active, "greg-" + uniqueName("t"), asOf, id, points + 3));
        assertEquals(200, published.statusCode(), published.asString());
        assertEquals(points + 3, field(read(), id).get("value").intValue());
    }

    @Test
    void invalidPreviewChangeSetsAre400AndNothingIsStored() throws Exception {
        CLOCK.advance();
        JsonNode before = read();
        String old = before.get("activeVersion").textValue();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        long rows = policyRows();

        assertInvalid(post(greg, "/preview", previewBody(old, "price:nope", 5)), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", previewBody(old, "weight:unknown", 1)), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", previewBody(old, id, -1)), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", previewBody(old, id, points)), "no-policy-change", "changes");
        assertInvalid(post(greg, "/preview", "{\"expectedActiveVersion\":\"" + old + "\",\"changes\":[{\"id\":\"" + id
                + "\",\"value\":0.5}]}"), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", "{\"expectedActiveVersion\":\"" + old + "\",\"changes\":[{\"id\":\"" + id
                + "\",\"value\":9007199254740992}]}"), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", "{\"expectedActiveVersion\":\"" + old + "\",\"changes\":[{\"id\":\"" + id
                + "\",\"value\":" + (points + 1) + ",\"path\":\"essentials\"}]}"), "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", "{\"expectedActiveVersion\":\"" + old + "\",\"changes\":[{\"id\":\"" + id
                + "\",\"value\":" + (points + 1) + "},{\"id\":\"" + id + "\",\"value\":" + (points + 2) + "}]}"),
                "invalid-editable-field", "changes");
        assertInvalid(post(greg, "/preview", "{\"expectedActiveVersion\":\"" + old + "\",\"changes\":[]}"),
                "invalid-change-set", "changeSet");
        ObjectNode extra = previewBody(old, id, points + 1);
        extra.put("unknown", true);
        assertInvalid(post(greg, "/preview", extra), "invalid-change-set", "changeSet");
        ObjectNode publishKeys = previewBody(old, id, points + 1);
        publishKeys.put("commandId", "c-1");
        assertInvalid(post(greg, "/preview", publishKeys), "invalid-change-set", "changeSet");
        assertInvalid(post(greg, "/preview", "{}"), "invalid-change-set", "changeSet");
        assertInvalid(post(greg, "/preview", "not json"), "invalid-change-set", "body");
        assertInvalid(post(greg, "/preview", "[]"), "invalid-change-set", "body");
        assertEquals(rows, policyRows());
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
    @Order(Integer.MIN_VALUE)
    void theBackendPresentationOutcomesTheGregScreenConsumesAreStable() throws Exception {
        preparePresentationFixture();
        CLOCK.advance();
        JsonNode before = read();
        JsonNode first = before.get("fields").get(0);
        String id = first.get("id").textValue();
        int points = first.get("value").intValue();
        String old = before.get("activeVersion").textValue();
        String version = "greg-" + uniqueName("outcome");
        Map<String, String> names = new TreeMap<>(Map.of(version, "<new>", old, "<old>", PolicyClock.iso(CLOCK.now), "<now>"));

        Response preview = post(greg, "/preview", previewBody(old, id, points + 9));
        Response accepted = post(greg, "/publish", change(uniqueName("o"), old, version, CLOCK.now, id, points + 9));
        CLOCK.advance();
        Response stale = post(greg, "/publish", change(uniqueName("o"), old, "greg-" + uniqueName("s"), CLOCK.now, id, points + 10));
        names.put(PolicyClock.iso(CLOCK.now), "<later>");
        Response invalid = post(greg, "/publish", change("o-invalid", version, "greg-x", CLOCK.now, "price:nope", 1));
        Response forbidden = post(employee, "/publish", "{}");
        Response unauthenticated = post(null, "/publish", "{}");

        ObjectNode outcomes = JSON.createObjectNode();
        outcomes.set("accepted", outcome(accepted, names));
        outcomes.set("invalid", outcome(invalid, names));
        outcomes.set("stale", outcome(stale, names));
        outcomes.set("forbidden", outcome(forbidden, names));
        outcomes.set("unauthenticated", outcome(unauthenticated, names));
        outcomes.set("preview", outcome(preview, names));
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

    private void preparePresentationFixture() throws Exception {
        // This golden owns the initial state, before sibling tests publish their own policy versions.
        Instant at = Instant.parse("2026-11-18T09:00:00Z");
        ClockConfiguration.Loaded loaded = ClockConfiguration.read(policy, "run-1", at);
        assertTrue(loaded.ok(), loaded.problem());
        ClockConfiguration config = loaded.configuration();
        ScenarioClockStart.Dated dated = ScenarioClockStart.derive(config.startsAt(), config.namedTimes(), at);
        ObjectNode named = JSON.createObjectNode();
        dated.namedTimes().forEach((name, instant) -> named.put(name, instant.toString()));
        assertTrue(schema.matches("gcsp_p_http_[0-9a-f]+"));
        try (Connection c = GregPolicyProfiles.plain().getConnection(); Statement st = c.createStatement()) {
            c.setAutoCommit(false);
            try {
                st.execute("SET LOCAL search_path TO " + schema);
                try (var rs = st.executeQuery("SELECT environment_id, run_id FROM run_clocks")) {
                    assertTrue(rs.next());
                    assertEquals(GregPolicyProfiles.ENV, rs.getString(1));
                    assertEquals("run-1", rs.getString(2));
                    assertFalse(rs.next());
                }
                // Re-seed only this private fixture table; the production forward-only guard stays intact.
                st.execute("TRUNCATE run_clocks");
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO run_clocks (environment_id, run_id, "
                        + "clock_instant, clock_version, scenario_version, fixture_version, starts_at, named_times) "
                        + "VALUES (?, 'run-1', ?::timestamptz, ?, ?, ?, ?::timestamptz, ?::jsonb)")) {
                    ps.setString(1, GregPolicyProfiles.ENV);
                    ps.setString(2, dated.startsAt().toString());
                    ps.setLong(3, config.initialClockVersion());
                    ps.setString(4, config.scenarioVersion());
                    ps.setString(5, config.fixtureVersion());
                    ps.setString(6, dated.startsAt().toString());
                    ps.setString(7, named.toString());
                    assertEquals(1, ps.executeUpdate());
                }
                c.commit();
            } catch (Exception | AssertionError e) {
                c.rollback();
                throw e;
            }
        }
        CLOCK.advance();
        JsonNode baseline = read();
        assertEquals(V1, baseline.get("activeVersion").textValue());
        JsonNode first = baseline.get("fields").get(0);
        Response predecessor = post(greg, "/publish", change(uniqueName("fixture"), V1,
                "greg-" + uniqueName("fixture"), CLOCK.now, first.get("id").textValue(), first.get("value").intValue() + 1));
        assertEquals(200, predecessor.statusCode(), predecessor.asString());
    }

    private static ObjectNode outcome(Response response, Map<String, String> names) throws Exception {
        String text = response.asString().replaceAll("preview-[0-9a-f]{24}", "<draft>")
                .replaceAll("\"projectionVersion\":\"[0-9a-f]{64}\"", "\"projectionVersion\":\"<digest>\"");
        for (Map.Entry<String, String> name : names.entrySet()) {
            text = text.replace(name.getKey(), name.getValue());
        }
        ObjectNode out = JSON.createObjectNode();
        out.put("http", response.statusCode());
        out.set("body", JSON.readTree(text));
        return out;
    }
}
