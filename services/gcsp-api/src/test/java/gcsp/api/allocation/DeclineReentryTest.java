package gcsp.api.allocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.ReviewedDefinitions;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** The reason answer must resolve the actual candidate, independently of its total fit score. */
class DeclineReentryTest {

    private JsonNode rule() throws Exception {
        return ReviewedDefinitions.get("offer-journey-v2").path("definitions").get(2).path("value");
    }

    private JsonNode json(String value) throws Exception {
        return Sql.JSON.readTree(value);
    }

    private ObjectNode brief(String value, String state) throws Exception {
        return (ObjectNode) json("{\"preferences\":{\"fuel\":{\"value\":\"" + value
                + "\",\"valueState\":\"" + state + "\",\"importance\":50,\"importanceState\":\"confirmed\",\"source\":\"employee\"}}}");
    }

    private ObjectNode change() throws Exception {
        return (ObjectNode) json("""
                {"decisionId":"decline-2","offerId":"offer-2","fromBriefVersion":2,
                 "path":"preferences.fuel.value","before":"diesel","after":"ev",
                 "confirmedBy":"employee-paula","confirmedAt":"2026-11-18T09:00:00Z"}
                """);
    }

    private DeclineReentry.Decline decline() throws Exception {
        return decline(change(), "diesel");
    }

    private DeclineReentry.Decline decline(ObjectNode record, String before) throws Exception {
        return new DeclineReentry.Decline("diesel-car", "decline-2", "offer-2", 2,
                json("{\"code\":\"fuel\",\"attribute\":\"fuel\",\"policyVersion\":\"policy-v2\"}"), null,
                brief(before, "confirmed"), record, "employee-paula", Instant.parse("2026-11-18T09:00:00Z"));
    }

    private JsonNode candidate(String fuel) throws Exception {
        return json("{\"snapshot\":{\"facts\":{\"fuel\":{\"status\":\"known\",\"value\":\"" + fuel + "\"}}}}");
    }

    @Test
    void changingDieselToEvCannotReofferTheSameDieselOrAnotherCombustionCar() throws Exception {
        assertEquals("decline-answer-mismatch", DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "confirmed"),
                change(), "diesel-car", candidate("diesel")));
        assertEquals("decline-answer-mismatch", DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "confirmed"),
                change(), "petrol-alternative", candidate("petrol")));
        assertNull(DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "confirmed"), change(), "ev-alternative", candidate("ev")));
    }

    @Test
    void inferredUnlinkedAndStaleAnswersDoNotReleaseTheExactRejectedCar() throws Exception {
        assertEquals("declined-unresolved", DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "draft"),
                change(), "diesel-car", candidate("diesel")));
        ObjectNode unrelated = change();
        unrelated.put("decisionId", "earlier-decline");
        assertEquals("declined-unresolved", DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "confirmed"),
                unrelated, "diesel-car", candidate("diesel")));
        assertEquals("declined-unresolved", DeclineReentry.blocker(rule(), decline(), 3, brief("phev", "confirmed"),
                change(), "diesel-car", candidate("diesel")));
        assertNull(DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "draft"),
                change(), "another-car", candidate("diesel")), "Other preferences remain soft before a valid reason answer.");
    }

    @Test
    void unknownFuelCannotEstablishThatTheAnswerWasResolved() throws Exception {
        JsonNode unknown = json("{\"snapshot\":{\"facts\":{\"fuel\":{\"status\":\"unknown\",\"value\":null}}}}");
        assertEquals("decline-answer-mismatch", DeclineReentry.blocker(rule(), decline(), 3, brief("ev", "confirmed"),
                change(), "unknown-car", unknown));
    }

    @Test
    void anExplicitDieselAnswerCanLegitimatelyReturnTheDieselExactCar() throws Exception {
        ObjectNode diesel = change();
        diesel.put("before", "petrol").put("after", "diesel");
        assertNull(DeclineReentry.blocker(rule(), decline(diesel, "petrol"), 3, brief("diesel", "confirmed"), diesel,
                "diesel-car", candidate("diesel")));
    }

    @Test
    void provenanceOnlyEquipmentRefreshKeepsTheConfirmedMeaningAndUsesTheCanonicalEssentialEvidence() throws Exception {
        ObjectNode after = (ObjectNode) json("""
                {"value":["heated-seats","camera"],"operator":"includes","unit":"equipment-key",
                 "state":"confirmed","source":"employee"}
                """);
        ObjectNode before = after.deepCopy();
        before.set("value", json("[\"heated-seats\"]"));
        ObjectNode record = change();
        record.put("path", "essentials.equipment").set("before", before);
        record.set("after", after);
        ObjectNode previous = (ObjectNode) json("{\"essentials\":{}}");
        ((ObjectNode) previous.path("essentials")).set("equipment", before);
        ObjectNode content = previous.deepCopy();
        ObjectNode refreshed = after.deepCopy();
        refreshed.put("confirmedAt", "2026-11-18T09:02:00Z");
        refreshed.set("value", json("[\"camera\",\"heated-seats\"]"));
        ((ObjectNode) content.path("essentials")).set("equipment", refreshed);
        DeclineReentry.Decline latest = new DeclineReentry.Decline("diesel-car", "decline-2", "offer-2", 2,
                json("{\"code\":\"equipment\",\"policyVersion\":\"policy-v2\"}"), null, previous, record,
                "employee-paula", Instant.parse("2026-11-18T09:00:00Z"));
        ObjectNode quoted = (ObjectNode) json("{\"reasons\":[{\"code\":\"essential-met\",\"field\":\"equipment\"}]}");
        ((ObjectNode) quoted.path("reasons").get(0)).set("requirement", refreshed);
        assertNull(DeclineReentry.blocker(rule(), latest, 4, content, record, "diesel-car", quoted));
        assertEquals("decline-answer-mismatch", DeclineReentry.blocker(rule(), latest, 4, content, record,
                "diesel-car", json("{\"reasons\":[]}")));
    }

    @Test
    void sizeUsesStrictImprovementAgainstTheStoredQuoteAndNeverAnArbitraryTotalScore() throws Exception {
        ObjectNode record = change();
        record.put("path", "preferences.size.value").put("before", 10).put("after", 45);
        JsonNode before = json("{\"preferences\":{\"size\":{\"value\":10}}}");
        JsonNode content = json("""
                {"preferences":{"size":{"value":45,"valueState":"confirmed","importanceState":"confirmed","source":"employee"}}}
                """);
        JsonNode rejected = json("{\"tradeOffs\":[{\"code\":\"preference-fit\",\"field\":\"size\",\"observed\":50}]}");
        DeclineReentry.Decline latest = new DeclineReentry.Decline("diesel-car", "decline-2", "offer-2", 2,
                json("{\"code\":\"size\",\"policyVersion\":\"policy-v2\"}"), rejected, before, record,
                "employee-paula", Instant.parse("2026-11-18T09:00:00Z"));
        JsonNode equalDistance = json("{\"reasons\":[{\"code\":\"preference-fit\",\"field\":\"size\",\"observed\":40}]}");
        JsonNode closer = json("{\"reasons\":[{\"code\":\"preference-fit\",\"field\":\"size\",\"observed\":45}]}");
        assertNull(DeclineReentry.blocker(rule(), latest, 3, content, record, "diesel-car", rejected));
        assertEquals("decline-answer-mismatch", DeclineReentry.blocker(rule(), latest, 3, content, record,
                "alternative", equalDistance));
        assertNull(DeclineReentry.blocker(rule(), latest, 3, content, record, "alternative", closer));
    }
}
