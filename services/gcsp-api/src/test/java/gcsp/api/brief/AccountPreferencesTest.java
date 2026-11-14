package gcsp.api.brief;

import static gcsp.api.brief.Harness.choose;
import static gcsp.api.brief.Harness.list;
import static gcsp.api.brief.Harness.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Replays server/test/gcsp-account-preferences.test.js (editor read and preferences patch) over PostgreSQL. */
class AccountPreferencesTest {

    private static final String CAR = "contract-1";
    private static final String KEY = BriefAssumptions.ACCOUNT_PREFERENCES;
    private static final List<String> SLIDERS = List.of("sportiness", "comfort", "economy", "size");

    BriefFixture f;
    Harness h;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
        f.account.contract(CAR, "Model X");
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    // ---- helpers ----

    private static JsonNode j(String json) {
        try {
            return Json.M.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(json, e);
        }
    }

    private ObjectNode patch(String id, long brief, long draft, String changes) {
        return Harness.envelope(id, brief, draft).set("changes", j(changes));
    }

    /** A patch at the current versions. */
    private ObjectNode patch(String changes) {
        return patch(f.nextId(), h.briefVersion(), h.draftVersion(), changes);
    }

    private BriefResult save(String changes) {
        return f.service.savePreferences(f.scope, patch(changes));
    }

    private JsonNode saved(String changes) {
        return h.ok(save(changes));
    }

    private ObjectNode rated(String changes, String contractId, String value) {
        return (ObjectNode) patch(changes).set("currentCarRating", j("{\"contractId\":\"" + contractId + "\",\"value\":" + value + "}"));
    }

    private ObjectNode again(String changes, String contractId, boolean on) {
        return (ObjectNode) patch(changes).set("sameAgain", j("{\"contractId\":\"" + contractId + "\",\"on\":" + on + "}"));
    }

    private JsonNode rate(int value) {
        return h.ok(f.service.savePreferences(f.scope, rated("{}", CAR, String.valueOf(value))));
    }

    private JsonNode editor() {
        return h.ok(f.service.readEditor(f.scope));
    }

    private JsonNode initial() {
        return editor().get("initial");
    }

    private JsonNode accountState() {
        return initial().get("accountPreferences");
    }

    private JsonNode draftBrief() {
        return h.ok(f.service.draft(f.scope)).get("brief");
    }

    private JsonNode stored(String key) {
        return draftBrief().get("preferences").get(key);
    }

    private void reasonField(BriefResult r, String field) {
        BriefResult.Refusal x = h.refused(r, 400, "invalid-preferences");
        assertEquals(field, x.extra().get("reasons").get(0).get("field").asText(), x.toString());
    }

    private void unavailableWhenPolicyIs(String label, java.util.function.Consumer<ObjectNode> change) throws SQLException {
        f.policy.edit(KEY, change);
        h.refused(f.service.readEditor(f.scope), 503, "brief-unavailable");
        h.refused(f.service.savePreferences(f.scope, patch("p", 0, 0, "{\"comfort\":{\"value\":50}}")), 503, "brief-unavailable");
        assertEquals(0, f.count("SELECT count(*) FROM brief_drafts"), label);
    }

    private ObjectNode savedBrief(JsonNode content) {
        return (ObjectNode) content.deepCopy();
    }

    private static final List<String> STEPS = List.of("{\"body\":{\"value\":[\"suv\"]}}", "{\"fuel\":{\"value\":[\"ev\"]}}",
            "{\"comfort\":{\"value\":100}}", "{\"economy\":{\"value\":0}}", "{\"size\":{\"value\":100}}", "{\"sportiness\":{\"value\":50}}");

    // ---- editor read ----

    @Test
    void theEditorReadCarriesTheContextTheInitialViewsVersionsAndProvenance() throws Exception {
        JsonNode e = editor();
        JsonNode ctx = e.get("context");
        assertEquals("gcsp-policy-v1", ctx.get("policyVersion").asText());
        assertTrue(ctx.get("preferences").get("body").get("multiple").booleanValue());
        assertFalse(ctx.get("preferences").get("comfort").has("multiple"));
        assertEquals("Body style", ctx.get("preferences").get("body").get("label").asText());
        assertTrue(ctx.get("essentials").has("charging"));
        assertEquals(j("{\"minimum\":0,\"maximum\":100}"), ctx.get("slider"));
        assertEquals("Unconfirmed draft starting position", ctx.get("unconfirmedLabel").asText());
        assertTrue(ctx.get("practicalQuestions").has("seats"));
        assertEquals(5, ctx.get("assumptions").size());
        JsonNode projection = ctx.get("accountPreferences");
        assertEquals(j("{\"medium\":50,\"high\":100}"), projection.get("importance"));
        assertEquals(3, projection.get("minimumCategories").intValue());
        assertEquals(KEY, projection.get("understanding").get("policyKey").asText());
        assertEquals("gcsp-policy-v1", projection.get("policyVersion").asText());
        JsonNode car = ctx.get("knownFacts").get("currentContract");
        assertEquals("manual-account", car.get("source").asText());
        assertEquals("facts-1", car.get("sourceVersion").asText());
        assertFalse(car.get("editable").booleanValue());
        assertFalse(ctx.get("permissions").get("currentContract").get("editable").booleanValue());
        JsonNode in = e.get("initial");
        assertEquals(0, in.get("briefVersion").intValue());
        assertEquals(0, in.get("draftVersion").intValue());
        assertEquals(j("{\"search\":false,\"hold\":false}"), in.get("consent"));
        assertEquals("disengaged", in.get("buddy").get("state").asText());
        assertEquals(j("{\"value\":null,\"contractId\":\"" + CAR + "\"}"), in.get("currentCarRating"));
        assertEquals(j("{\"available\":true,\"on\":false,\"contractId\":\"" + CAR + "\"}"), in.get("sameAgain"));
        assertEquals(j("{\"policy\":\"gcsp-policy-v1\",\"facts\":\"facts-1\"}"), e.get("versions"));
        assertTrue(e.get("selection").isNull());
        assertEquals("unconfirmed-policy-defaults", e.get("provenance").get("initial").asText());
        assertTrue(e.get("provenance").get("approvedBriefVersion").isNull());
        f.account.facts = java.util.Optional.empty();
        h.refused(f.service.readEditor(f.scope), 503, "brief-unavailable");
        h.refused(f.service.savePreferences(f.scope, patch("{\"comfort\":{\"value\":50}}")), 503, "brief-unavailable");
    }

    @Test
    void freshAndRetainedDefaultsAreNotEmployeeChoicesAndEngageCountsOnlyTheSubset() throws Exception {
        for (boolean retained : new boolean[] {false, true}) {
            try (BriefFixture g = BriefFixture.create()) {
                g.account.contract(CAR, "Model X");
                Harness gh = new Harness(g);
                if (retained) gh.saveOk(((ObjectNode) gh.ok(g.service.resolveInitial(g.scope)).get("initial")).deepCopy());
                long draft = retained ? 1 : 0;
                ObjectNode body = Harness.envelope("subset", 0, draft)
                        .set("changes", j("{\"body\":{\"value\":[\"estate\"]},\"sportiness\":{\"value\":50},\"comfort\":{\"value\":50}}"));
                JsonNode out = gh.ok(g.service.savePreferences(g.scope, body));
                assertEquals(3, out.get("accountPreferences").get("considered").intValue());
                gh.ok(g.service.engage(g.scope, gh.at("engage-subset")));
                JsonNode after = gh.ok(g.service.readEditor(g.scope)).get("initial");
                assertEquals(3, after.get("accountPreferences").get("considered").intValue());
                assertEquals("unset", after.get("accountPreferences").get("categories").get("size").get("state").asText());
                assertEquals("engaged", after.get("buddy").get("state").asText());
            }
        }
    }

    @Test
    void policyDefaultsAreNeverConsideredWhileConfirmedValuesAndZeroImportanceFollowTheRule() throws Exception {
        long before = f.count("SELECT count(*) FROM brief_heads");
        JsonNode first = initial();
        assertEquals("policy:brief.editor.v1", first.get("brief").get("preferences").get("comfort").get("source").asText());
        assertEquals(0, first.get("accountPreferences").get("considered").intValue());
        first.get("accountPreferences").get("categories").properties().forEach(c -> assertEquals(j("{\"state\":\"unset\"}"), c.getValue()));
        assertEquals(before, f.count("SELECT count(*) FROM brief_heads"));
        ObjectNode b = h.sparse();
        choose(b, "comfort", j("90"), 80);
        choose(b, "sportiness", j("30"), 0);
        choose(b, "size", j("50"), 50);
        ObjectNode size = (ObjectNode) b.get("preferences").get("size");
        size.put("source", "policy:brief.editor.v1").put("valueState", "confirmed");
        h.saveOk(b);
        JsonNode next = accountState();
        assertEquals(2, next.get("considered").intValue());
        assertEquals(j("{\"state\":\"considered\",\"value\":100,\"importance\":\"high\",\"exact\":false}"), next.get("categories").get("comfort"));
        assertEquals("unset", next.get("categories").get("sportiness").get("state").asText());
        assertEquals("considered", next.get("categories").get("size").get("state").asText());
        assertEquals("unset", next.get("categories").get("body").get("state").asText());
    }

    @Test
    void anOldScalarBodyReadsAsAListAndAMultipleListValidatesAndPersists() throws Exception {
        for (String bad : List.of("[]", "[\"estate\",\"saloon\"]", "[\"estate\",\"estate\"]", "[\"truck\"]", "[\"saloon\",\"truck\"]", "[[\"estate\"]]")) {
            ObjectNode b = h.sparse();
            choose(b, "body", j(bad), 50);
            h.refused(h.save(b), 400, "invalid-brief");
        }
        ObjectNode slider = h.sparse();
        choose(slider, "sportiness", j("[50]"), 50);
        h.refused(h.save(slider), 400, "invalid-brief");
        assertEquals(0, f.count("SELECT count(*) FROM brief_drafts"));
        ObjectNode legacy = h.sparse();
        choose(legacy, "body", j("\"estate\""), 100);
        h.saveOk(legacy);
        assertEquals(j("{\"state\":\"considered\",\"value\":[\"estate\"],\"importance\":\"high\",\"exact\":true}"),
                accountState().get("categories").get("body"));
        saved("{\"body\":{\"value\":[\"saloon\",\"estate\"]}}");
        assertEquals(j("[\"saloon\",\"estate\"]"), stored("body").get("value"));
        assertEquals(j("[\"saloon\",\"estate\"]"), accountState().get("categories").get("body").get("value"));
    }

    @Test
    void everySliderStopSavesAndReadsBackNonStopsAreRefusedAndALegacyValueReadsAsTheNearestStop() throws Exception {
        for (String key : SLIDERS) {
            for (int stop : new int[] {0, 50, 100}) {
                JsonNode out = saved("{\"" + key + "\":{\"value\":" + stop + "}}");
                assertEquals(j("{\"state\":\"considered\",\"value\":" + stop + ",\"importance\":\"medium\",\"exact\":true}"),
                        out.get("accountPreferences").get("categories").get(key));
                assertEquals(stop, stored(key).get("value").intValue());
            }
        }
        long version = h.draftVersion();
        for (String bad : List.of("40", "101", "-1", "50.5", "\"50\"", "null", "true")) {
            reasonField(save("{\"sportiness\":{\"value\":" + bad + "}}"), "changes.sportiness.value");
        }
        assertEquals(version, h.draftVersion());
        try (BriefFixture g = BriefFixture.create()) {
            g.account.contract(CAR, "Model X");
            Harness gh = new Harness(g);
            ObjectNode b = gh.sparse();
            choose(b, "sportiness", j("37"), 50);
            choose(b, "comfort", j("25"), 50);
            choose(b, "economy", j("75"), 50);
            choose(b, "size", j("100"), 50);
            gh.saveOk(b);
            JsonNode c = gh.ok(g.service.readEditor(g.scope)).get("initial").get("accountPreferences").get("categories");
            assertEquals(j("{\"state\":\"considered\",\"value\":50,\"importance\":\"medium\",\"exact\":false}"), c.get("sportiness"));
            assertEquals(50, c.get("comfort").get("value").intValue());
            assertFalse(c.get("comfort").get("exact").booleanValue());
            assertEquals(50, c.get("economy").get("value").intValue());
            assertEquals(100, c.get("size").get("value").intValue());
            assertTrue(c.get("size").get("exact").booleanValue());
        }
    }

    @Test
    void importanceIsMediumOrHighOnlyOrphanImportanceIsRefusedAndRemovalClearsBoth() throws Exception {
        JsonNode out = saved("{\"comfort\":{\"value\":100}}");
        assertEquals(j("{\"value\":100,\"importance\":50,\"valueState\":\"draft\",\"importanceState\":\"draft\",\"source\":\"employee\"}"), stored("comfort"));
        out = saved("{\"comfort\":{\"importance\":\"high\"}}");
        assertEquals(100, stored("comfort").get("importance").intValue());
        assertEquals("high", out.get("accountPreferences").get("categories").get("comfort").get("importance").asText());
        assertEquals(1, out.get("accountPreferences").get("considered").intValue());
        saved("{\"comfort\":{\"importance\":\"medium\"}}");
        assertEquals(50, stored("comfort").get("importance").intValue());
        assertEquals(100, stored("comfort").get("value").intValue());
        saved("{\"comfort\":{\"importance\":\"high\"}}");
        // A value-only patch keeps the existing importance.
        saved("{\"comfort\":{\"value\":0}}");
        assertEquals(100, stored("comfort").get("importance").intValue());
        long version = h.draftVersion();
        for (String changes : List.of("{\"size\":{\"importance\":\"high\"}}", "{\"comfort\":{\"importance\":75}}", "{\"comfort\":{\"importance\":\"urgent\"}}",
                "{\"comfort\":{\"importance\":100}}", "{\"body\":{\"value\":[]}}", "{\"body\":{}}", "{\"comfort\":{}}", "{\"comfort\":5}", "{}", "[]")) {
            h.refused(save(changes), 400, "invalid-preferences");
        }
        assertEquals(version, h.draftVersion());
        out = saved("{\"comfort\":null}");
        assertEquals("unset", out.get("accountPreferences").get("categories").get("comfort").get("state").asText());
        assertFalse(draftBrief().get("preferences").has("comfort"));
        reasonField(save("{\"comfort\":{\"importance\":\"high\"}}"), "changes.comfort.importance");
        saved("{\"comfort\":{\"value\":50}}");
        assertEquals(50, stored("comfort").get("importance").intValue());
        // Removing a category that is not there is harmless.
        h.ok(save("{\"size\":null}"));
    }

    @Test
    void unknownCategoriesOptionsAndInjectedAuthorityFieldsAreRefusedAndNothingIsWritten() throws Exception {
        List<Long> before = f.snapshot();
        for (String changes : List.of("{\"price\":{\"value\":1}}", "{\"essentials\":{\"value\":1}}", "{\"constructor\":null}", "{\"__proto__\":{\"value\":1}}",
                "{\"body\":{\"value\":[\"truck\"]}}", "{\"body\":{\"value\":[\"estate\",\"saloon\"]}}", "{\"fuel\":{\"value\":\"petrol\"}}",
                "{\"body\":{\"value\":[\"estate\"],\"weight\":4}}", "{\"sportiness\":{\"value\":\"sporty\"}}")) {
            h.refused(f.service.savePreferences(f.scope, patch("bad", 0, 0, changes)), 400, "invalid-preferences");
        }
        ObjectNode good = patch("bad", 0, 0, "{\"comfort\":{\"value\":50}}");
        for (String field : List.of("employeeId", "runId", "policy", "policyVersion", "buddy", "consent", "essentials", "brief", "context", "knownFacts")) {
            h.refused(f.service.savePreferences(f.scope, good.deepCopy().set(field, obj())), 400, "invalid-preferences");
        }
        for (String missing : List.of("commandId", "expectedBriefVersion", "expectedDraftVersion", "changes")) {
            ObjectNode partial = good.deepCopy();
            partial.remove(missing);
            h.refused(f.service.savePreferences(f.scope, partial), 400, "invalid-preferences");
        }
        for (String bad : List.of("{\"commandId\":\"\"}", "{\"expectedBriefVersion\":-1}", "{\"expectedDraftVersion\":1.5}", "{\"commandId\":7}")) {
            ObjectNode merged = good.deepCopy();
            merged.setAll((ObjectNode) j(bad));
            h.refused(f.service.savePreferences(f.scope, merged), 400, "invalid-preferences");
        }
        h.refused(f.service.savePreferences(f.scope, j("null")), 400, "invalid-preferences");
        assertEquals(before, f.snapshot());
    }

    @Test
    void essentialsFeedbackOtherPreferencesAndConsentSurviveEverySaveAndANewEmployeeStartsSparse() throws Exception {
        ObjectNode seed = h.sparse();
        choose(seed, "comfort", j("100"), 100);
        choose(seed, "body", j("\"estate\""), 50);
        ObjectNode seats = (ObjectNode) seed.get("essentials").get("seats");
        seats.put("state", "draft").put("source", "employee").set("value", j("5"));
        seed.set("currentCarFeedback", j("{\"preserve\":[\"comfort\"],\"change\":[\"size\"],\"state\":\"draft\",\"source\":\"employee\"}"));
        JsonNode before = savedBrief(h.ok(f.service.saveDraft(f.scope, h.at("seed").set("brief", seed))).get("brief"));
        JsonNode out = saved("{\"size\":{\"value\":100},\"fuel\":{\"value\":[\"phev\",\"ev\"],\"importance\":\"high\"}}");
        assertEquals(2, out.get("draftVersion").intValue());
        JsonNode after = draftBrief();
        assertEquals(before.get("essentials"), after.get("essentials"));
        assertEquals(before.get("currentCarFeedback"), after.get("currentCarFeedback"));
        assertEquals(before.get("preferences").get("comfort"), after.get("preferences").get("comfort"));
        assertEquals(before.get("preferences").get("body"), after.get("preferences").get("body"));
        assertEquals(j("[\"phev\",\"ev\"]"), after.get("preferences").get("fuel").get("value"));
        assertEquals(100, after.get("preferences").get("fuel").get("importance").intValue());
        assertEquals(j("{\"value\":100,\"importance\":50,\"valueState\":\"draft\",\"importanceState\":\"draft\",\"source\":\"employee\"}"),
                after.get("preferences").get("size"));
        h.refused(f.service.current(f.scope), 404, "not-found");
        assertEquals(j("{\"search\":false,\"hold\":false}"), initial().get("consent"));
        try (BriefFixture g = BriefFixture.create()) {
            g.account.contract(CAR, "Model X");
            Harness gh = new Harness(g);
            gh.ok(g.service.savePreferences(g.scope, Harness.envelope("fresh", 0, 0).set("changes", j("{\"economy\":{\"value\":0}}"))));
            JsonNode fresh = gh.ok(g.service.draft(g.scope)).get("brief");
            assertEquals(List.of("economy"), List.copyOf(Json.M.convertValue(fresh.get("preferences"), java.util.LinkedHashMap.class).keySet()));
            fresh.get("essentials").properties().forEach(e -> {
                assertTrue(e.getValue().get("value").isNull(), e.getKey());
                assertEquals("needs-confirmation", e.getValue().get("state").asText());
            });
            assertTrue(fresh.get("essentials").has("charging"));
        }
    }

    @Test
    void staleVersionsWriteNothingARetryIsIdempotentAndAnAcceptedOfferIsReadOnly() throws Exception {
        h.ok(f.service.savePreferences(f.scope, patch("first", 0, 0, "{\"comfort\":{\"value\":50}}")));
        List<Long> before = f.snapshot();
        BriefResult.Refusal staleDraft = h.refused(f.service.savePreferences(f.scope, patch("second", 0, 0, "{\"comfort\":{\"value\":100}}")), 409, "stale-version");
        assertEquals("brief-draft", staleDraft.extra().get("resource").get("table").asText());
        BriefResult.Refusal staleBrief = h.refused(f.service.savePreferences(f.scope, patch("third", 3, 1, "{\"comfort\":{\"value\":100}}")), 409, "stale-version");
        assertEquals("briefs", staleBrief.extra().get("resource").get("table").asText());
        assertEquals(before, f.snapshot());
        BriefResult again = f.service.savePreferences(f.scope, patch("first", 0, 0, "{\"comfort\":{\"value\":50}}"));
        assertEquals(1, h.ok(again).get("draftVersion").intValue());
        assertTrue(((BriefResult.Ok) again).replayed());
        assertEquals(before, f.snapshot());
        h.refused(f.service.savePreferences(f.scope, patch("first", 0, 0, "{\"comfort\":{\"value\":0}}")), 409, "command-input-changed");
        assertEquals(2, h.ok(f.service.savePreferences(f.scope, patch("next", 0, 1, "{\"size\":{\"value\":50}}"))).get("draftVersion").intValue());
        f.offers.list = List.of(new BriefOfferPort.Offer("o1", "accepted", 1L));
        List<Long> locked = f.snapshot();
        h.refused(f.service.savePreferences(f.scope, patch("late", 0, 2, "{\"size\":{\"value\":100}}")), 409, "brief-read-only");
        assertEquals(locked, f.snapshot());
    }

    @Test
    void anAcceptedOfferShowsAsTheSelectionOnceThereIsAConfirmedBrief() throws Exception {
        h.engaged();
        f.offers.list = List.of(new BriefOfferPort.Offer("o1", "accepted", 1L));
        JsonNode e = editor();
        assertEquals("{\"state\":\"accepted\",\"briefVersion\":1}", e.get("selection").toString());
        assertEquals("approved-brief", e.get("provenance").get("initial").asText());
        assertEquals(1, e.get("provenance").get("approvedBriefVersion").intValue());
    }

    @Test
    void zeroOneAndTwoCategoriesAutosaveWithNoMinimumEnforced() throws Exception {
        assertEquals(1, saved("{\"body\":{\"value\":[\"coupe\"]}}").get("accountPreferences").get("considered").intValue());
        assertEquals(2, saved("{\"fuel\":{\"value\":[\"ev\"]}}").get("accountPreferences").get("considered").intValue());
        assertEquals(1, saved("{\"body\":null}").get("accountPreferences").get("considered").intValue());
        assertEquals(0, saved("{\"fuel\":null}").get("accountPreferences").get("considered").intValue());
        assertEquals(obj(), draftBrief().get("preferences"));
        assertEquals(j("{\"state\":\"unset\"}"), accountState().get("categories").get("fuel"));
        assertEquals(3, editor().get("context").get("accountPreferences").get("minimumCategories").intValue());
    }

    @Test
    void oneMappingChangeReachesTheProjectionSavedImportanceAndReadback() throws Exception {
        f.policy.edit(KEY, v -> {
            ((ObjectNode) v.get("importance")).put("high", 90);
            ((ObjectNode) ((ArrayNode) v.get("categories").get("comfort").get("stops")).get(2)).put("label", "Plush");
        });
        JsonNode e = editor();
        assertEquals(90, e.get("context").get("accountPreferences").get("importance").get("high").intValue());
        assertEquals("Plush", e.get("context").get("accountPreferences").get("categories").get("comfort").get("stops").get(2).get("label").asText());
        saved("{\"comfort\":{\"value\":100,\"importance\":\"high\"}}");
        assertEquals(90, stored("comfort").get("importance").intValue());
        assertEquals("high", accountState().get("categories").get("comfort").get("importance").asText());
        // The unchanged policy still maps high to 100.
        try (BriefFixture g = BriefFixture.create()) {
            g.account.contract(CAR, "Model X");
            Harness gh = new Harness(g);
            JsonNode pinned = gh.ok(g.service.readEditor(g.scope));
            assertEquals(100, pinned.get("context").get("accountPreferences").get("importance").get("high").intValue());
            assertEquals("As comfortable as possible",
                    pinned.get("context").get("accountPreferences").get("categories").get("comfort").get("stops").get(2).get("label").asText());
            gh.ok(g.service.savePreferences(g.scope, Harness.envelope("v1", 0, 0).set("changes", j("{\"comfort\":{\"value\":100,\"importance\":\"high\"}}"))));
            assertEquals(100, gh.ok(g.service.draft(g.scope)).get("brief").get("preferences").get("comfort").get("importance").intValue());
        }
    }

    @Test
    void aMissingOrMalformedAccountPreferencePolicyMakesTheEditorUnavailable() throws Exception {
        unavailableWhenPolicyIs("size removed", v -> ((ObjectNode) v.get("categories")).remove("size"));
        unavailableWhenPolicyIs("medium 0", v -> ((ObjectNode) v.get("importance")).put("medium", 0));
        unavailableWhenPolicyIs("highFrom 40", v -> ((ObjectNode) v.get("importance")).put("highFrom", 40));
        unavailableWhenPolicyIs("two stops", v -> {
            ObjectNode c = (ObjectNode) v.get("categories").get("comfort");
            ((ArrayNode) c.get("stops")).remove(2);
            c.put("openDefault", 100);
        });
        unavailableWhenPolicyIs("open default", v -> ((ObjectNode) v.get("categories").get("sportiness")).put("openDefault", 40));
        unavailableWhenPolicyIs("unregistered option", v -> ((ObjectNode) v.get("categories").get("body").get("options").get(0)).put("value", "tractor"));
        unavailableWhenPolicyIs("options reversed", v -> {
            ArrayNode options = (ArrayNode) v.get("categories").get("fuel").get("options");
            List<JsonNode> all = new java.util.ArrayList<>();
            options.forEach(all::add);
            options.removeAll();
            for (int i = all.size() - 1; i >= 0; i--) options.add(all.get(i));
        });
        unavailableWhenPolicyIs("size as multi", v -> ((ObjectNode) v.get("categories").get("size")).put("kind", "multi"));
        f.policy.edit(KEY, v -> {});
        h.ok(f.service.readEditor(f.scope));
    }

    // ---- ratings ----

    @Test
    void aRatingSetsOneAndFiveReplacesClearsWithNullAndReadsBack() throws Exception {
        assertEquals(j("{\"value\":null,\"contractId\":\"" + CAR + "\"}"), initial().get("currentCarRating"));
        for (String value : List.of("1", "5", "3", "null", "4")) {
            JsonNode out = h.ok(f.service.savePreferences(f.scope, rated("{}", CAR, value)));
            assertEquals(j("{\"value\":" + value + ",\"contractId\":\"" + CAR + "\"}"), out.get("currentCarRating"));
            JsonNode s = draftBrief().get("currentCarRating");
            assertEquals(j(value), s.get("value"));
            assertEquals("employee", s.get("source").asText());
            assertEquals("2026-11-13T10:00:00Z", s.get("ratedAt").asText());
            assertEquals(j("{\"value\":" + value + ",\"contractId\":\"" + CAR + "\"}"), initial().get("currentCarRating"));
        }
        // A cleared rating is stored as an explicit null, not dropped.
        h.ok(f.service.savePreferences(f.scope, rated("{}", CAR, "null")));
        assertTrue(draftBrief().get("currentCarRating").has("value"));
        assertTrue(draftBrief().get("currentCarRating").get("value").isNull());
    }

    @Test
    void malformedRatingsAreInvalidWithTheFieldNamedAndWriteNothing() throws Exception {
        List<Long> before = f.snapshot();
        for (String value : List.of("0", "6", "4.5", "\"4\"", "true", "-1", "[3]", "{}", "\"null\"")) {
            reasonField(f.service.savePreferences(f.scope, patch("bad", 0, 0, "{}").set("currentCarRating",
                    j("{\"contractId\":\"" + CAR + "\",\"value\":" + value + "}"))), "currentCarRating");
        }
        for (String bad : List.of("{\"contractId\":\"" + CAR + "\"}", "{\"value\":3}", "{\"contractId\":\"\",\"value\":3}", "{\"contractId\":7,\"value\":3}",
                "{\"contractId\":\"" + "x".repeat(129) + "\",\"value\":3}", "null", "3", "[]")) {
            reasonField(f.service.savePreferences(f.scope, patch("bad", 0, 0, "{}").set("currentCarRating", j(bad))), "currentCarRating");
        }
        for (String extra : List.of("source", "ratedAt", "employeeId", "runId", "buddy", "consent", "state")) {
            reasonField(f.service.savePreferences(f.scope, patch("bad", 0, 0, "{}").set("currentCarRating",
                    j("{\"contractId\":\"" + CAR + "\",\"value\":3,\"" + extra + "\":\"x\"}"))), "currentCarRating");
        }
        BriefResult.Refusal bare = h.refused(f.service.savePreferences(f.scope, patch("bare", 0, 0, "{}")), 400, "invalid-preferences");
        assertEquals("Change at least one category.", bare.extra().get("reasons").get(0).get("reason").asText());
        h.refused(f.service.savePreferences(f.scope, Harness.envelope("b", 0, 0).set("currentCarRating", j("{\"contractId\":\"" + CAR + "\",\"value\":3}"))),
                400, "invalid-preferences");
        assertEquals(before, f.snapshot());
    }

    @Test
    void aRatingForAnotherCarOrWithNoCurrentCarIsAConflictThatWritesNothing() throws Exception {
        rate(3);
        List<Long> before = f.snapshot();
        BriefResult.Refusal wrong = h.refused(f.service.savePreferences(f.scope, rated("{}", "current:someone-else", "4")), 409, "current-car-changed");
        assertEquals(CAR, wrong.extra().get("current").get("contractId").asText());
        f.account.facts = java.util.Optional.of(new BriefAccountPort.AccountFacts(null, "facts-1"));
        h.refused(f.service.savePreferences(f.scope, rated("{}", CAR, "2")), 409, "no-current-car");
        assertEquals(before, f.snapshot());
        // Without a current car a category save still works and the readback is null.
        JsonNode sparse = saved("{\"size\":{\"value\":50}}");
        assertTrue(sparse.get("currentCarRating").isNull());
        assertTrue(initial().get("currentCarRating").isNull());
        assertEquals(CAR, draftBrief().get("currentCarRating").get("contractId").asText());
    }

    @Test
    void aRatingOnlySaveLeavesEverythingElseIdenticalAndACategorySaveKeepsTheRating() throws Exception {
        ObjectNode seed = h.sparse();
        choose(seed, "comfort", j("100"), 100);
        choose(seed, "body", j("\"estate\""), 50);
        ((ObjectNode) seed.get("essentials").get("seats")).put("state", "draft").put("source", "employee").set("value", j("5"));
        seed.set("currentCarFeedback", j("{\"preserve\":[\"comfort\"],\"change\":[\"size\"],\"state\":\"draft\",\"source\":\"employee\"}"));
        h.saveOk(seed);
        ObjectNode before = savedBrief(draftBrief());
        JsonNode countBefore = accountState();
        JsonNode out = rate(4);
        ObjectNode after = savedBrief(draftBrief());
        JsonNode rating = after.remove("currentCarRating");
        assertEquals(before, after);
        assertEquals(4, rating.get("value").intValue());
        assertEquals(countBefore, out.get("accountPreferences"));
        h.refused(f.service.current(f.scope), 404, "not-found");
        assertEquals(j("{\"search\":false,\"hold\":false}"), initial().get("consent"));
        saved("{\"size\":{\"value\":100}}");
        assertEquals(rating, draftBrief().get("currentCarRating"));
        assertEquals(before.get("currentCarFeedback"), draftBrief().get("currentCarFeedback"));
        JsonNode both = h.ok(f.service.savePreferences(f.scope, rated("{\"economy\":{\"value\":0}}", CAR, "2")));
        assertEquals(0, both.get("accountPreferences").get("categories").get("economy").get("value").intValue());
        assertEquals(2, draftBrief().get("currentCarRating").get("value").intValue());
    }

    @Test
    void aRatingForAnotherContractReadsAsUnsetSoAReplacementCarNeverInheritsIt() throws Exception {
        rate(5);
        f.account.contract("replacement-contract", "Model Y");
        assertEquals(j("{\"value\":null,\"contractId\":\"replacement-contract\"}"), initial().get("currentCarRating"));
        JsonNode out = saved("{\"size\":{\"value\":50}}");
        assertEquals(j("{\"value\":null,\"contractId\":\"replacement-contract\"}"), out.get("currentCarRating"));
        assertEquals(CAR, draftBrief().get("currentCarRating").get("contractId").asText());
        assertEquals(5, draftBrief().get("currentCarRating").get("value").intValue());
        JsonNode next = h.ok(f.service.savePreferences(f.scope, rated("{}", "replacement-contract", "2")));
        assertEquals(j("{\"value\":2,\"contractId\":\"replacement-contract\"}"), next.get("currentCarRating"));
    }

    // ---- understanding and Same again ----

    @Test
    void understandingIsOneThreeFourSixSevenNineTenForZeroToSixConsideredAndElevenWithSameAgain() throws Exception {
        assertEquals(j("{\"kind\":\"input-completeness\",\"value\":1,\"maximum\":11,\"basis\":\"categories\",\"considered\":0,\"policyKey\":\"" + KEY
                + "\",\"policyVersion\":\"gcsp-policy-v1\"}"), accountState().get("understanding"));
        List<Integer> seen = new java.util.ArrayList<>(List.of(1));
        for (String step : STEPS) {
            seen.add(saved(step).get("accountPreferences").get("understanding").get("value").intValue());
            assertEquals(seen.get(seen.size() - 1), accountState().get("understanding").get("value").intValue());
        }
        assertEquals(List.of(1, 3, 4, 6, 7, 9, 10), seen);
        JsonNode on = h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        assertEquals(j("{\"kind\":\"input-completeness\",\"value\":11,\"maximum\":11,\"basis\":\"same-again\",\"considered\":6,\"policyKey\":\"" + KEY
                + "\",\"policyVersion\":\"gcsp-policy-v1\"}"), on.get("accountPreferences").get("understanding"));
        assertTrue(on.get("accountPreferences").get("sameAgain").booleanValue());
        assertEquals(11, accountState().get("understanding").get("value").intValue());
        assertEquals(j("{\"kind\":\"input-completeness\",\"maximum\":11,\"byConsidered\":[1,3,4,6,7,9,10],\"sameAgain\":11,\"policyKey\":\"" + KEY + "\"}"),
                editor().get("context").get("accountPreferences").get("understanding"));
    }

    @Test
    void oneUnderstandingChangeReachesTheProjectionAndReadbackWithThePolicyKeyAndVersion() throws Exception {
        f.policy.edit(KEY, v -> v.set("understanding", j("{\"kind\":\"input-completeness\",\"maximum\":20,\"byConsidered\":[2,4,6,8,10,12,14],\"sameAgain\":20}")));
        JsonNode e = editor();
        assertEquals(j("{\"kind\":\"input-completeness\",\"maximum\":20,\"byConsidered\":[2,4,6,8,10,12,14],\"sameAgain\":20,\"policyKey\":\"" + KEY + "\"}"),
                e.get("context").get("accountPreferences").get("understanding"));
        assertEquals(2, e.get("initial").get("accountPreferences").get("understanding").get("value").intValue());
        JsonNode out = saved("{\"comfort\":{\"value\":100},\"size\":{\"value\":0}}");
        assertEquals(6, out.get("accountPreferences").get("understanding").get("value").intValue());
        assertEquals(20, out.get("accountPreferences").get("understanding").get("maximum").intValue());
        JsonNode on = h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        assertEquals(20, on.get("accountPreferences").get("understanding").get("value").intValue());
        assertEquals("same-again", on.get("accountPreferences").get("understanding").get("basis").asText());
    }

    @Test
    void aMalformedUnderstandingMappingMakesTheEditorUnavailable() throws Exception {
        unavailableWhenPolicyIs("missing", v -> v.remove("understanding"));
        unavailableWhenPolicyIs("kind", v -> ((ObjectNode) v.get("understanding")).put("kind", "confidence"));
        unavailableWhenPolicyIs("short", v -> ((ArrayNode) v.get("understanding").get("byConsidered")).remove(6));
        unavailableWhenPolicyIs("not rising", v -> ((ArrayNode) v.get("understanding").get("byConsidered")).set(3, 2));
        unavailableWhenPolicyIs("negative", v -> ((ArrayNode) v.get("understanding").get("byConsidered")).set(0, -1));
        unavailableWhenPolicyIs("over maximum", v -> ((ArrayNode) v.get("understanding").get("byConsidered")).set(6, 12));
        unavailableWhenPolicyIs("fraction", v -> ((ArrayNode) v.get("understanding").get("byConsidered")).set(2, 4.5));
        unavailableWhenPolicyIs("same again low", v -> ((ObjectNode) v.get("understanding")).put("sameAgain", 9));
        unavailableWhenPolicyIs("same again high", v -> ((ObjectNode) v.get("understanding")).put("sameAgain", 12));
        unavailableWhenPolicyIs("same again text", v -> ((ObjectNode) v.get("understanding")).put("sameAgain", "11"));
        unavailableWhenPolicyIs("extra", v -> ((ObjectNode) v.get("understanding")).put("extra", 1));
    }

    @Test
    void importanceAndRatingChangesNeverChangeUnderstandingAndDefaultsOrZeroImportanceNeverCount() throws Exception {
        saved("{\"comfort\":{\"value\":100},\"size\":{\"value\":0}}");
        assertEquals(4, accountState().get("understanding").get("value").intValue());
        saved("{\"comfort\":{\"importance\":\"high\"}}");
        assertEquals(4, accountState().get("understanding").get("value").intValue());
        saved("{\"size\":{\"importance\":\"high\"},\"comfort\":{\"importance\":\"medium\"}}");
        assertEquals(4, accountState().get("understanding").get("value").intValue());
        for (int stars : new int[] {5, 1}) {
            rate(stars);
            assertEquals(4, accountState().get("understanding").get("value").intValue());
        }
        h.ok(f.service.savePreferences(f.scope, rated("{}", CAR, "null")));
        assertEquals(4, accountState().get("understanding").get("value").intValue());
        try (BriefFixture g = BriefFixture.create()) {
            g.account.contract(CAR, "Model X");
            Harness gh = new Harness(g);
            ObjectNode b = gh.sparse();
            choose(b, "comfort", j("100"), 100);
            ((ObjectNode) b.get("preferences").get("comfort")).put("source", "policy:brief.editor.v1");
            choose(b, "size", j("100"), 0);
            gh.saveOk(b);
            JsonNode a = gh.ok(g.service.readEditor(g.scope)).get("initial").get("accountPreferences");
            assertEquals(0, a.get("considered").intValue());
            assertEquals(1, a.get("understanding").get("value").intValue());
        }
    }

    @Test
    void sameAgainOnAndOffKeepsCategoriesIdenticalAndRestoresTheCountAndImportance() throws Exception {
        saved("{\"body\":{\"value\":[\"saloon\",\"estate\"]},\"comfort\":{\"value\":100,\"importance\":\"high\"},\"size\":{\"value\":0}}");
        JsonNode kept = draftBrief().get("preferences").deepCopy();
        JsonNode on = h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        assertEquals(j("{\"available\":true,\"on\":true,\"contractId\":\"" + CAR + "\"}"), on.get("sameAgain"));
        assertEquals(11, on.get("accountPreferences").get("understanding").get("value").intValue());
        JsonNode row = draftBrief();
        assertEquals(kept, row.get("preferences"));
        assertEquals(kept.toString(), row.get("preferences").toString());
        assertEquals(j("[true,\"" + CAR + "\",\"employee\",\"2026-11-13T10:00:00Z\"]"),
                j("[" + row.get("sameAgain").get("on") + "," + row.get("sameAgain").get("contractId") + "," + row.get("sameAgain").get("source") + ","
                        + row.get("sameAgain").get("setAt") + "]"));
        JsonNode during = initial();
        assertEquals(j("{\"available\":true,\"on\":true,\"contractId\":\"" + CAR + "\"}"), during.get("sameAgain"));
        assertTrue(during.get("accountPreferences").get("sameAgain").booleanValue());
        assertEquals(3, during.get("accountPreferences").get("considered").intValue());
        assertEquals(11, during.get("accountPreferences").get("understanding").get("value").intValue());
        assertEquals(0, during.get("buddy").get("remaining").intValue());
        h.ok(f.service.savePreferences(f.scope, again("{}", CAR, false)));
        assertEquals(kept, draftBrief().get("preferences"));
        JsonNode after = initial();
        assertEquals(j("{\"available\":true,\"on\":false,\"contractId\":\"" + CAR + "\"}"), after.get("sameAgain"));
        assertEquals(3, after.get("accountPreferences").get("considered").intValue());
        assertEquals(6, after.get("accountPreferences").get("understanding").get("value").intValue());
        assertEquals("categories", after.get("accountPreferences").get("understanding").get("basis").asText());
        assertEquals("high", after.get("accountPreferences").get("categories").get("comfort").get("importance").asText());
        assertEquals("medium", after.get("accountPreferences").get("categories").get("size").get("importance").asText());
        assertEquals(j("{\"search\":false,\"hold\":false}"), after.get("consent"));
    }

    @Test
    void whileSameAgainIsOnACategoryChangeIsRefusedAndOffPlusChangesWorksInOnePatch() throws Exception {
        saved("{\"comfort\":{\"value\":100}}");
        h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        List<Long> before = f.snapshot();
        BriefResult.Refusal refused = h.refused(save("{\"size\":{\"value\":0}}"), 400, "invalid-preferences");
        assertEquals(j("[{\"field\":\"changes\",\"reason\":\"Turn off Same again to change your categories.\"}]"), refused.extra().get("reasons"));
        reasonField(f.service.savePreferences(f.scope, again("{\"size\":{\"value\":0}}", CAR, true)), "changes");
        assertEquals(before, f.snapshot());
        // A rating-only save is still allowed while on.
        rate(4);
        JsonNode both = h.ok(f.service.savePreferences(f.scope, again("{\"size\":{\"value\":0}}", CAR, false)));
        assertFalse(both.get("sameAgain").get("on").booleanValue());
        assertEquals(0, both.get("accountPreferences").get("categories").get("size").get("value").intValue());
        JsonNode brief = draftBrief();
        assertFalse(brief.get("sameAgain").get("on").booleanValue());
        assertEquals(4, brief.get("currentCarRating").get("value").intValue());
        JsonNode then = h.ok(f.service.savePreferences(f.scope, again("{\"economy\":{\"value\":100}}", CAR, true)));
        assertTrue(then.get("sameAgain").get("on").booleanValue());
        assertEquals(100, then.get("accountPreferences").get("categories").get("economy").get("value").intValue());
        assertEquals(11, then.get("accountPreferences").get("understanding").get("value").intValue());
    }

    @Test
    void sameAgainWithoutACarWithoutAModelOrForAnotherCarIsAConflictThatWritesNothing() throws Exception {
        h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        List<Long> before = f.snapshot();
        BriefResult.Refusal wrong = h.refused(f.service.savePreferences(f.scope, again("{}", "current:someone-else", false)), 409, "current-car-changed");
        assertEquals(CAR, wrong.extra().get("current").get("contractId").asText());
        f.account.facts = java.util.Optional.of(new BriefAccountPort.AccountFacts(null, "facts-1"));
        h.refused(f.service.savePreferences(f.scope, again("{}", CAR, false)), 409, "no-current-car");
        assertEquals(j("{\"available\":false,\"on\":false,\"contractId\":null,\"reason\":\"no-current-car\"}"), initial().get("sameAgain"));
        f.account.contract(CAR, "");
        h.refused(f.service.savePreferences(f.scope, again("{}", CAR, false)), 409, "current-car-unidentified");
        assertEquals(before, f.snapshot());
        JsonNode view = initial();
        assertEquals(j("{\"available\":false,\"on\":false,\"contractId\":null,\"reason\":\"current-car-unidentified\"}"), view.get("sameAgain"));
        assertFalse(view.get("accountPreferences").get("sameAgain").booleanValue());
        assertEquals("categories", view.get("accountPreferences").get("understanding").get("basis").asText());
        // Category saves still work without a usable car and carry the unavailable view.
        f.account.facts = java.util.Optional.of(new BriefAccountPort.AccountFacts(null, "facts-1"));
        JsonNode sparse = saved("{\"size\":{\"value\":50}}");
        assertEquals("no-current-car", sparse.get("sameAgain").get("reason").asText());
    }

    @Test
    void sameAgainStoredForAnotherContractReadsAsOffSoAReplacementCarStartsOff() throws Exception {
        h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        f.account.contract("replacement-contract", "Model Y");
        JsonNode view = initial();
        assertEquals(j("{\"available\":true,\"on\":false,\"contractId\":\"replacement-contract\"}"), view.get("sameAgain"));
        assertEquals(1, view.get("accountPreferences").get("understanding").get("value").intValue());
        JsonNode out = saved("{\"size\":{\"value\":50}}");
        assertFalse(out.get("sameAgain").get("on").booleanValue());
        assertEquals(CAR, draftBrief().get("sameAgain").get("contractId").asText());
        assertTrue(draftBrief().get("sameAgain").get("on").booleanValue());
    }

    @Test
    void sameAgainSavesObeyStaleVersionsIdempotentRetriesAndTheAcceptedOfferLock() throws Exception {
        ObjectNode first = (ObjectNode) patch("s1", 0, 0, "{}").set("sameAgain", j("{\"contractId\":\"" + CAR + "\",\"on\":true}"));
        h.ok(f.service.savePreferences(f.scope, first));
        List<Long> before = f.snapshot();
        h.refused(f.service.savePreferences(f.scope, patch("s2", 0, 0, "{}").set("sameAgain", j("{\"contractId\":\"" + CAR + "\",\"on\":false}"))), 409, "stale-version");
        h.refused(f.service.savePreferences(f.scope, patch("s3", 4, 1, "{}").set("sameAgain", j("{\"contractId\":\"" + CAR + "\",\"on\":false}"))), 409, "stale-version");
        BriefResult retry = f.service.savePreferences(f.scope, first);
        assertEquals(1, h.ok(retry).get("draftVersion").intValue());
        assertTrue(((BriefResult.Ok) retry).replayed());
        h.refused(f.service.savePreferences(f.scope, patch("s1", 0, 0, "{}").set("sameAgain", j("{\"contractId\":\"" + CAR + "\",\"on\":false}"))), 409,
                "command-input-changed");
        assertEquals(before, f.snapshot());
        h.ok(f.service.confirm(f.scope, h.at("confirm")));
        JsonNode confirmed = h.current().get("brief");
        assertTrue(confirmed.get("sameAgain").get("on").booleanValue());
        JsonNode view = initial();
        assertTrue(view.get("sameAgain").get("on").booleanValue());
        assertEquals(11, view.get("accountPreferences").get("understanding").get("value").intValue());
        assertEquals("same-again", view.get("accountPreferences").get("understanding").get("basis").asText());
        f.offers.list = List.of(new BriefOfferPort.Offer("o1", "accepted", 1L));
        List<Long> locked = f.snapshot();
        h.refused(f.service.savePreferences(f.scope, again("{}", CAR, false)), 409, "brief-read-only");
        assertEquals(locked, f.snapshot());
    }

    @Test
    void malformedSameAgainPatchesAreInvalidWithTheFieldNamedAndWriteNothing() throws Exception {
        List<Long> before = f.snapshot();
        for (String bad : List.of("{\"contractId\":\"" + CAR + "\",\"on\":\"yes\"}", "{\"contractId\":\"" + CAR + "\"}", "{\"on\":true}",
                "{\"contractId\":\"\",\"on\":true}", "{\"contractId\":7,\"on\":true}", "{\"contractId\":\"" + "x".repeat(129) + "\",\"on\":true}",
                "{\"contractId\":\"" + CAR + "\",\"on\":true,\"source\":\"employee\"}", "{\"contractId\":\"" + CAR + "\",\"on\":true,\"employeeId\":\"x\"}",
                "null", "true", "[]")) {
            reasonField(f.service.savePreferences(f.scope, patch("bad", 0, 0, "{}").set("sameAgain", j(bad))), "sameAgain");
        }
        assertEquals(before, f.snapshot());
    }

    // ---- engagement through the editor ----

    @Test
    void anEngagedEmployeeRemovingACategoryDisengagesAsMinimumLostAndTheEditorReadsItBack() throws Exception {
        h.engaged();
        JsonNode keep = saved("{\"comfort\":{\"value\":100}}");
        assertTrue(keep.get("buddyTransition").isNull());
        assertEquals("engaged", keep.get("buddy").get("state").asText());
        assertEquals(2, keep.get("briefVersion").intValue());
        assertEquals("preferences-updated", h.operation(2));
        JsonNode lost = saved("{\"body\":null,\"comfort\":null}");
        assertEquals("minimum-lost", lost.get("buddyTransition").asText());
        assertEquals(3, lost.get("briefVersion").intValue());
        assertEquals("disengaged", lost.get("buddy").get("state").asText());
        assertEquals("minimum-lost", lost.get("buddy").get("reason").asText());
        assertEquals("disengaged", h.operation(3));
        JsonNode e = initial();
        assertEquals("disengaged", e.get("buddy").get("state").asText());
        assertEquals("minimum-lost", e.get("buddy").get("reason").asText());
        assertFalse(e.get("buddy").get("canEngage").booleanValue());
        assertEquals(1, e.get("buddy").get("remaining").intValue());
        assertEquals(j("{\"search\":false,\"hold\":false}"), e.get("consent"));
        assertEquals(3, e.get("briefVersion").intValue());
    }

    @Test
    void engagementConflictsCarryTheBuddyViewAndTheSuccessResultIncludesIt() throws Exception {
        h.saveOk(h.three());
        assertEquals("engaged", h.engageOk().get("buddy").get("state").asText());
        BriefResult.Refusal again = h.refused(h.engage(), 409, "already-engaged");
        assertEquals("engaged", again.extra().get("buddy").get("state").asText());
        assertEquals(3, again.extra().get("buddy").get("considered").intValue());
        assertEquals(1, again.extra().get("current").get("briefVersion").intValue());
        h.ok(f.service.disengage(f.scope, h.at(f.nextId())));
        BriefResult.Refusal off = h.refused(f.service.disengage(f.scope, h.at(f.nextId())), 409, "already-disengaged");
        assertEquals("disengaged", off.extra().get("buddy").get("state").asText());
        assertTrue(off.extra().get("buddy").get("canEngage").booleanValue());
        BriefResult.Refusal pause = h.refused(f.service.pauseSearch(f.scope, h.at(f.nextId())), 409, "not-engaged");
        assertTrue(pause.extra().has("buddy"));
    }

    @Test
    void aNewPoolReadsTheSameEditorStateAfterASave() throws Exception {
        saved("{\"body\":{\"value\":[\"estate\"]},\"comfort\":{\"value\":50,\"importance\":\"high\"}}");
        rate(4);
        h.ok(f.service.savePreferences(f.scope, again("{}", CAR, true)));
        JsonNode before = editor();
        BriefService restarted = f.newService(f.pool());
        assertEquals(before, h.ok(restarted.readEditor(f.scope)));
    }
}
