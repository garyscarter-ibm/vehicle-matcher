package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Clock;
import org.junit.jupiter.api.Test;

/** The confirmed-change port, the route path rule and the request envelope; none of it needs a database. */
class BriefFeedbackChangeTest {

    private static final String NOW = "2026-11-16T10:00:00.000Z";

    private static ObjectNode brief() {
        ObjectNode b = Json.obj();
        b.put("schemaVersion", 1);
        ObjectNode prefs = b.putObject("preferences");
        prefs.set("body", pref(Harness.list("saloon", "estate")));
        prefs.set("sportiness", pref(Json.M.getNodeFactory().numberNode(40)));
        b.putObject("essentials").set("equipment", essential(Harness.list("sunroof", "towbar")));
        return b;
    }

    private static ObjectNode pref(JsonNode value) {
        ObjectNode p = Json.obj();
        p.set("value", value);
        p.put("importance", 50).put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee");
        return p;
    }

    private static ObjectNode essential(JsonNode value) {
        ObjectNode e = Json.obj();
        e.put("operator", "includes").set("value", value);
        e.put("unit", "equipment-key").put("state", "confirmed").put("source", "employee");
        return e;
    }

    private static FeedbackChange.Applied apply(String path, JsonNode value) {
        return FeedbackChange.apply(brief(), path, value, NOW);
    }

    @Test
    void aPreferenceValueChangeKeepsImportanceAndMarksTheValueConfirmedByTheEmployee() {
        FeedbackChange.Applied a = apply("preferences.body.value", Json.M.getNodeFactory().textNode("suv"));
        assertTrue(a.ok());
        assertEquals(Harness.list("saloon", "estate"), a.before());
        assertEquals("suv", a.after().asText());
        JsonNode p = a.brief().get("preferences").get("body");
        assertEquals("suv", p.get("value").asText());
        assertEquals(50, p.get("importance").intValue());
        assertEquals(NOW, p.get("confirmedAt").asText());
        assertEquals("employee", p.get("source").asText());
    }

    @Test
    void aScalarChoiceAndItsOneItemListAreTheSameValue() {
        assertEquals("unchanged-value", apply("preferences.body.value", Harness.list("saloon", "estate")).code());
        ObjectNode one = brief();
        ((ObjectNode) one.get("preferences").get("body")).set("value", Json.M.getNodeFactory().textNode("suv"));
        assertEquals("unchanged-value", FeedbackChange.apply(one, "preferences.body.value", Harness.list("suv"), NOW).code());
        assertEquals("unchanged-value", apply("preferences.sportiness.value", Json.M.getNodeFactory().numberNode(40.0)).code());
        assertTrue(apply("preferences.sportiness.value", Json.M.getNodeFactory().numberNode(41)).ok());
    }

    @Test
    void anEssentialNeedsAConfirmedNonNullValueAndComparesItsMeaningNotItsOrder() {
        for (JsonNode bad : new JsonNode[] {Json.M.getNodeFactory().textNode("x"), Json.arr(), essential(Json.M.nullNode()),
                ((ObjectNode) essential(Harness.list("a"))).put("state", "draft")}) {
            assertEquals("confirmed-essential-required", apply("essentials.equipment", bad).code(), String.valueOf(bad));
        }
        assertEquals("unchanged-value", apply("essentials.equipment", essential(Harness.list("towbar", "sunroof", "towbar"))).code());
        FeedbackChange.Applied a = apply("essentials.equipment", essential(Harness.list("sunroof")));
        assertTrue(a.ok());
        assertEquals(Harness.list("sunroof"), a.brief().get("essentials").get("equipment").get("value"));
        assertEquals("employee", a.brief().get("essentials").get("equipment").get("source").asText());
        assertEquals(NOW, a.brief().get("essentials").get("equipment").get("confirmedAt").asText());
        assertEquals(Harness.list("sunroof", "towbar"), a.before().get("value"));
    }

    @Test
    void unknownFieldsAndUnregisteredPathShapesAreRefused() {
        assertEquals("unknown-field", apply("preferences.fuel.value", Json.M.getNodeFactory().textNode("ev")).code());
        assertEquals("unknown-field", apply("essentials.nothing", essential(Harness.list("a"))).code());
        assertEquals("invalid-target", apply("preferences.my-key.value", Json.M.getNodeFactory().textNode("ev")).code());
        assertEquals("invalid-target", apply("preferences.body.importance.x", Json.M.getNodeFactory().textNode("ev")).code());
        assertNull(brief().get("preferences").get("body").get("confirmedAt"), "the input brief is never mutated");
    }

    @Test
    void theRoutePathRuleAllowsOnlyAPreferenceValueOrOneEssential() {
        for (String ok : new String[] {"preferences.body.value", "essentials.equipment", "preferences.a-b.value"}) {
            assertTrue(FeedbackChange.routePath(Json.M.getNodeFactory().textNode(ok)), ok);
        }
        for (String bad : new String[] {"preferences.body.importance", "preferences.body", "preferences..value", "essentials.a.b",
                "buddy.enabled", "preferences.body.value.x", "x", ""}) {
            assertFalse(FeedbackChange.routePath(Json.M.getNodeFactory().textNode(bad)), bad);
        }
        assertFalse(FeedbackChange.routePath(Json.M.getNodeFactory().numberNode(1)));
    }

    private static final BriefService SERVICE = new BriefService(null, v -> java.util.Optional.empty(), new BriefFixture.Account(),
            new BriefFixture.Offers(), Clock.systemUTC());

    private static ObjectNode request() {
        ObjectNode r = Json.obj().put("commandId", "c1").put("expectedBriefVersion", 1).put("decisionId", "d1");
        r.putObject("change").put("path", "preferences.body.value").put("value", "suv");
        return r;
    }

    @Test
    void theRequestEnvelopeIsCheckedBeforeAnyRead() {
        assertTrue(PreviewShapes.declineRequest(request()));
        for (ObjectNode bad : new ObjectNode[] {withoutKey("commandId"), withoutKey("expectedBriefVersion"),
                request().put("expectedDraftVersion", 0), request().put("extra", 1), request().put("expectedBriefVersion", -1)}) {
            BriefResult.Refusal r = assertInstanceOf(BriefResult.Refusal.class, SERVICE.changeAfterDecline(null, bad));
            assertEquals("invalid-command", r.code(), bad.toString());
        }
        // Node folds a missing decision ID into the change check, so it answers invalid-brief on field change.
        assertEquals("invalid-brief", assertInstanceOf(BriefResult.Refusal.class,
                SERVICE.changeAfterDecline(null, withoutKey("decisionId"))).code());
        ObjectNode other = request();
        other.putObject("change").put("path", "buddy.enabled").put("value", true);
        BriefResult.Refusal r = assertInstanceOf(BriefResult.Refusal.class, SERVICE.changeAfterDecline(null, other));
        assertEquals("invalid-brief", r.code());
        assertEquals("change", r.body().get("reasons").get(0).get("field").asText());
        assertEquals("Change exactly one registered preference value or essential.", r.reason());
        ObjectNode extra = request();
        ((ObjectNode) extra.get("change")).put("other", "body");
        assertEquals("invalid-brief", assertInstanceOf(BriefResult.Refusal.class, SERVICE.changeAfterDecline(null, extra)).code());
        ObjectNode noValue = request();
        ((ObjectNode) noValue.get("change")).remove("value");
        assertEquals("invalid-brief", assertInstanceOf(BriefResult.Refusal.class, SERVICE.changeAfterDecline(null, noValue)).code());
    }

    private static ObjectNode withoutKey(String key) {
        ObjectNode r = request();
        r.remove(key);
        return r;
    }

    @Test
    void aWellFormedRequestWithoutPolicyIsUnavailable() {
        BriefResult.Refusal r = assertInstanceOf(BriefResult.Refusal.class,
                SERVICE.changeAfterDecline(new BriefScope("e", "run-1", "emp-1", "p", "gcsp-policy-v1"), request()));
        assertEquals(503, r.httpStatus());
    }
}
