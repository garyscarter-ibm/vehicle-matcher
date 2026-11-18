package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.allocation.BuddyJourneySupport.post;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.decline;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySeed;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** The real OIDC/native-PG allocator and follow-up agree on a saved EV answer and a computed no-match. */
@QuarkusTest
@TestProfile(DeclineReentryHttpTest.Successor.class)
class DeclineReentryHttpTest {

    /** A test-local suffix choice; the shared historical profiles and their consumers are unchanged. */
    public static class Successor extends OfferJourneyProfiles.Accept {
        @Override
        public Map<String, String> getConfigOverrides() {
            Map<String, String> c = super.getConfigOverrides();
            c.put("gcsp.environment.policy-version", "gcsp-policy-v1+offer-journey-v2");
            return c;
        }
    }

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @Test
    void theSavedEvAnswerCannotProduceAnotherCombustionOfferAndReloadShowsNoMatch() throws Exception {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        for (String employee : new String[] {"carla", "bruno"}) {
            post(s.token("sub-" + employee, "employee"), API + "/brief/pause",
                    "{\"commandId\":\"pause-" + employee + "\",\"expectedBriefVersion\":1}")
                    .then().statusCode(200);
        }

        JsonNode current = body(get(paula, API + "/brief").then().statusCode(200).extract().response())
                .path("value").path("brief");
        ObjectNode content = BuddyJourneySupport.JSON.createObjectNode().put("schemaVersion", 1);
        ObjectNode preferences = current.path("preferences").deepCopy();
        preferences.putObject("fuel").put("value", "petrol").put("importance", 50)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee");
        preferences.putObject("comfort").put("value", 50).put("importance", 50)
                .put("valueState", "confirmed").put("importanceState", "confirmed").put("source", "employee");
        content.set("preferences", preferences);
        ObjectNode essentials = current.path("essentials").deepCopy();
        essentials.putObject("charging").put("value", "not-ready").put("operator", "equals")
                .putNull("unit").put("state", "confirmed").put("source", "employee");
        content.set("essentials", essentials);
        ObjectNode draft = BuddyJourneySupport.JSON.createObjectNode().put("commandId", "reentry-draft")
                .put("expectedBriefVersion", 1).put("expectedDraftVersion", 0);
        draft.set("brief", content);
        post(paula, API + "/brief/draft", draft.toString()).then().statusCode(200);
        post(paula, API + "/brief/confirm", """
                {"commandId":"reentry-confirm","expectedBriefVersion":1,"expectedDraftVersion":1,
                 "consent":{"search":true,"hold":true}}
                """).then().statusCode(200);

        String previousOffer = OfferDecisionJourneySupport.allocate(s, presenter, BuddyJourneySeed.PAULA);
        JsonNode offered = view(paula, previousOffer);
        String exactCar = s.text("SELECT order_uuid FROM buddy_offers WHERE offer_id = ?", previousOffer);
        JsonNode declined = decide(paula, previousOffer, decline("reentry-decline", offered, "fuel"), 200).path("value");
        String decisionId = declined.path("decisionId").asText();
        String followup = API + "/offer-followup?decisionId=" + decisionId;
        JsonNode question = body(get(paula, followup).then().statusCode(200).extract().response()).path("value");
        ObjectNode confirm = BuddyJourneySupport.JSON.createObjectNode().put("commandId", "reentry-ev")
                .put("decisionId", decisionId).put("expectedBriefVersion", question.path("briefVersion").asLong())
                .put("questionVersion", question.path("question").path("questionVersion").asText()).put("value", "ev");
        JsonNode saved = body(post(paula, API + "/offer-followup/confirm", confirm.toString())
                .then().statusCode(200).extract().response()).path("value");
        assertEquals("change-saved", saved.path("state").asText());
        assertEquals("completed", s.tick(presenter, "reentry-after-ev").path("state").asText());
        JsonNode reloaded = body(get(paula, followup).then().statusCode(200).extract().response()).path("value");
        assertEquals("no-match", reloaded.path("state").asText());
        assertTrue(reloaded.path("evaluation").path("carsChecked").asInt() > 0);
        assertEquals(0, s.count("SELECT count(*) FROM buddy_offers WHERE employee_id = ? AND state = 'active'",
                BuddyJourneySeed.PAULA));
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ? AND state = 'active'",
                BuddyJourneySeed.PAULA));
        assertEquals("ev", s.text("SELECT content->'preferences'->'fuel'->>'value' FROM briefs "
                + "WHERE employee_id = ? ORDER BY brief_version DESC LIMIT 1", BuddyJourneySeed.PAULA));
        assertEquals("not-ready", s.text("SELECT content->'essentials'->'charging'->>'value' FROM briefs "
                + "WHERE employee_id = ? ORDER BY brief_version DESC LIMIT 1", BuddyJourneySeed.PAULA));
        assertTrue(s.count("SELECT count(*) FROM allocation_evaluations, "
                + "jsonb_array_elements(evaluation->'decisions') d WHERE employee_id = ? "
                + "AND d->>'orderUuid' = ? AND d->>'gateStatus' = 'ineligible' "
                + "AND d->'blockers' @> '[{\"code\":\"decline-answer-mismatch\"}]'::jsonb",
                BuddyJourneySeed.PAULA, exactCar) > 0);
        assertTrue(s.count("SELECT count(*) FROM allocation_runs WHERE "
                + "plan->'assumptions' @> '[{\"key\":\"offer.declinedCar.reentry.v1\"}]'::jsonb") > 0);
        s.assertCustodyInvariants(1);
    }
}
