package gcsp.api.offers;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_2;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static gcsp.api.offers.OfferDecisionJourneySupport.accept;
import static gcsp.api.offers.OfferDecisionJourneySupport.body;
import static gcsp.api.offers.OfferDecisionJourneySupport.decide;
import static gcsp.api.offers.OfferDecisionJourneySupport.decline;
import static gcsp.api.offers.OfferDecisionJourneySupport.path;
import static gcsp.api.offers.OfferDecisionJourneySupport.view;
import static gcsp.api.offers.OfferDecisionJourneySupport.written;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.allocation.BuddyJourneySupport;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.time.Instant;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** FUCQ-466 AC2: decline, refused downstream work, replay and expiry stay truthful through the started app. */
@QuarkusTest
@TestProfile(OfferJourneyProfiles.Decline.class)
class OfferDeclineJourneyHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @BeforeEach
    void useTheRunClockForDocuments() {
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void declineReleasesAuthorityAndExpiryRefusesWithoutWriting() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String bruno = s.token("sub-bruno", "employee");
        String paulaOffer = OfferDecisionJourneySupport.allocate(s, presenter, PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);

        // Refused downstream work stays truthful: a stale terms digest is a typed 409 and the hold stays active.
        JsonNode paulaView = view(paula, paulaOffer);
        String beforeStale = written(s);
        JsonNode stale = decide(paula, paulaOffer, accept("accept-stale", paulaView, "0".repeat(64)), 409);
        assertNotNull(stale.get("code"), stale.toString());
        assertEquals(beforeStale, written(s));
        assertEquals("active", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ? AND state = 'active'", PAULA));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));

        // Bruno declines with a registry reason; the hold is released and the decline event is written once.
        JsonNode reasons = body(get(bruno, path(brunoOffer) + "/decision-reasons").then().statusCode(200).extract().response())
                .get("value");
        assertNotNull(reasons.get("provenance"));
        String reason = reasons.get("reasons").get(0).get("code").asText();
        JsonNode brunoView = view(bruno, brunoOffer);
        ObjectNode body = decline("decline-1", brunoView, reason);
        JsonNode first = decide(bruno, brunoOffer, body, 200).get("value");
        assertEquals("declined", first.get("state").asText());
        assertEquals("decline", first.get("requestedDecision").asText());
        assertEquals("released", first.get("holdState").asText());
        assertEquals("released", s.text("SELECT state FROM custody_holds WHERE employee_id = ?", BRUNO));
        assertEquals("declined", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", brunoOffer));
        assertEquals(1, s.count("SELECT count(*) FROM offer_decisions WHERE offer_id = ? AND decision = 'decline' "
                + "AND reason_code = ?", brunoOffer, reason));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined'"));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));
        assertEquals("released", s.text("SELECT state FROM stock_cars WHERE order_uuid = ?", CAR_2));
        s.assertCustodyInvariants(1);

        // Replay returns the stored outcome with no new row; changed input and a later accept are refused.
        String after = written(s);
        JsonNode replay = decide(bruno, brunoOffer, body, 200).get("value");
        assertEquals(first.get("decisionId").asText(), replay.get("decisionId").asText());
        assertEquals(first.get("serverNow").asText(), replay.get("serverNow").asText());
        assertEquals(after, written(s));
        ObjectNode changed = decline("decline-1", brunoView, reasons.get("reasons").get(1).get("code").asText());
        assertEquals("command-input-changed", decide(bruno, brunoOffer, changed, 409).get("code").asText());
        JsonNode late = decide(bruno, brunoOffer, accept("accept-late", brunoView, "0".repeat(64)), 409);
        assertEquals("offer-no-longer-pending", late.get("code").asText());
        assertEquals("declined", late.get("current").get("state").asText());
        assertEquals(after, written(s));

        // The supported follow-up after a decline is waiting for the next offer; a never-declined offer has none.
        JsonNode followUp = body(get(bruno, path(brunoOffer) + "/follow-up").then().statusCode(200).extract().response())
                .get("value");
        assertEquals("waiting-for-next-offer", followUp.get("state").asText());
        assertEquals(first.get("decisionId").asText(), followUp.get("decisionId").asText());
        assertTrue(followUp.get("nextOfferId").isNull());
        get(paula, path(paulaOffer) + "/follow-up").then().statusCode(404);
        assertFalse(get(bruno, path(brunoOffer) + "/follow-up").asString().contains(paulaOffer));

        // The follow-up routes: the registered question, one confirmed change, a replay and the saved/waiting read.
        String decisionId = first.get("decisionId").asText();
        String fu = "/api/gcsp/v1/offer-followup";
        JsonNode question = body(get(bruno, fu + "?decisionId=" + decisionId).then().statusCode(200).extract().response())
                .get("value");
        assertEquals("question", question.get("state").asText());
        JsonNode q = question.get("question");
        assertEquals(reason, q.get("reasonCode").asText());
        assertEquals("preferences.body.value", q.get("path").asText());
        assertEquals("estate", q.get("currentValue").asText());
        assertEquals("offer.followupQuestions.v1", q.get("provenance").get("key").asText());
        get(paula, fu + "?decisionId=" + decisionId).then().statusCode(403);
        get(presenter, fu + "?decisionId=" + decisionId).then().statusCode(403);
        get(bruno, fu + "?decisionId=offer-decision:unknown").then().statusCode(404);
        get(bruno, fu).then().statusCode(400);
        get(bruno, fu + "?decisionId=" + decisionId + "&x=1").then().statusCode(400);
        long briefs = s.count("SELECT count(*) FROM briefs WHERE employee_id = ?", BRUNO);
        ObjectNode confirm = BuddyJourneySupport.JSON.createObjectNode();
        confirm.put("commandId", "followup-1").put("decisionId", decisionId)
                .put("expectedBriefVersion", question.get("briefVersion").asLong())
                .put("questionVersion", q.get("questionVersion").asText()).put("value", "saloon");
        assertEquals(403, BuddyJourneySupport.post(paula, fu + "/confirm", confirm.toString()).statusCode());
        ObjectNode same = confirm.deepCopy();
        same.put("value", "estate");
        assertEquals(400, BuddyJourneySupport.post(bruno, fu + "/confirm", same.toString()).statusCode());
        assertEquals(400, BuddyJourneySupport.post(bruno, fu + "/confirm", "{\"commandId\":\"x\"}").statusCode());
        assertEquals(briefs, s.count("SELECT count(*) FROM briefs WHERE employee_id = ?", BRUNO));
        JsonNode saved = body(BuddyJourneySupport.post(bruno, fu + "/confirm", confirm.toString()).then().statusCode(200)
                .extract().response()).get("value");
        assertEquals("change-saved", saved.get("state").asText());
        assertEquals(decisionId, saved.get("decisionId").asText());
        assertEquals("preferences.body.value", saved.get("change").get("path").asText());
        assertEquals("estate", saved.get("change").get("before").asText());
        assertEquals("saloon", saved.get("change").get("after").asText());
        assertEquals(briefs + 1, s.count("SELECT count(*) FROM briefs WHERE employee_id = ?", BRUNO));
        assertEquals(1, s.count("SELECT count(*) FROM briefs WHERE employee_id = ? AND post_decline_change ->> 'decisionId' = ?",
                BRUNO, decisionId));
        // FUCQ-570: the scoped run is deliberately behind wall time. Saving must not create future history.
        Instant runNow = Instant.parse(s.clockNow(presenter));
        assertTrue(runNow.isBefore(Instant.now()), "this regression requires a run earlier than wall time");
        JsonNode currentBrief = body(get(bruno, "/api/gcsp/v1/brief").then().statusCode(200).extract().response())
                .get("value").get("brief");
        assertEquals(saved.get("briefVersion").asLong(), currentBrief.get("briefVersion").asLong());
        assertEquals("saloon", currentBrief.at("/preferences/body/value").asText());
        assertEquals(runNow, Instant.parse(currentBrief.get("confirmedAt").asText()), "brief confirmation uses run time");
        assertEquals(runNow, Instant.parse(currentBrief.at("/preferences/body/confirmedAt").asText()));
        assertEquals(runNow, Instant.parse(currentBrief.at("/postDeclineChange/confirmedAt").asText()));
        assertEquals(runNow, Instant.parse(saved.at("/event/occurredAt").asText()));
        JsonNode history = body(get(bruno, "/api/gcsp/v1/brief/history").then().statusCode(200).extract().response())
                .get("value").get("versions");
        assertEquals(briefs + 1, history.size());
        assertEquals(currentBrief, history.get(history.size() - 1));
        JsonNode activity = body(get(bruno, "/api/gcsp/v1/activity").then().statusCode(200).extract().response()).get("value");
        assertEquals(saved.get("briefVersion").asLong(), activity.get("briefVersion").asLong());
        assertEquals("offer-closed", activity.get("state").asText());
        assertEquals(brunoOffer, activity.at("/currentOffer/offerRef/offerId").asText());
        assertEquals("declined", activity.at("/currentOffer/state").asText());
        assertEquals(Long.toString(s.clockVersion(presenter)), activity.get("clockVersion").asText());
        assertTrue(activity.get("stateChanges").findValuesAsText("operation").contains("changed-after-decline"));
        assertEquals(currentBrief, body(get(bruno, "/api/gcsp/v1/brief").then().statusCode(200).extract().response())
                .get("value").get("brief"));
        assertEquals(activity, body(get(bruno, "/api/gcsp/v1/activity").then().statusCode(200).extract().response()).get("value"));
        assertEquals("declined", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", brunoOffer));

        JsonNode replayed = body(BuddyJourneySupport.post(bruno, fu + "/confirm", confirm.toString()).then().statusCode(200)
                .extract().response()).get("value");
        assertEquals(saved.get("briefVersion").asLong(), replayed.get("briefVersion").asLong());
        assertEquals(briefs + 1, s.count("SELECT count(*) FROM briefs WHERE employee_id = ?", BRUNO));
        ObjectNode again = confirm.deepCopy();
        again.put("commandId", "followup-2").put("expectedBriefVersion", saved.get("briefVersion").asLong());
        assertEquals(409, BuddyJourneySupport.post(bruno, fu + "/confirm", again.toString()).statusCode());
        JsonNode waiting = body(get(bruno, fu + "?decisionId=" + decisionId).then().statusCode(200).extract().response())
                .get("value");
        assertEquals("waiting", waiting.get("state").asText());
        assertEquals(saved.get("briefVersion").asLong(), waiting.get("savedChange").get("briefVersion").asLong());
        assertEquals("saloon", waiting.get("savedChange").get("change").get("after").asText());
        assertEquals(briefs + 1, s.count("SELECT count(*) FROM briefs WHERE employee_id = ?", BRUNO));

        // A presenter tick re-evaluates Bruno against his saved brief: a second offer makes the follow-up ready.
        try (var c = dataSource.getConnection(); var ps = c.prepareStatement("UPDATE employee_account_records SET record = "
                + "jsonb_set(record, '{contracts,0,vehicle,points}', '900'::jsonb), version = version + 1 WHERE employee_id = ?")) {
            ps.setString(1, BRUNO); assertEquals(1, ps.executeUpdate());
        }
        assertEquals("completed", s.tick(presenter, "offer-journey-after-change").get("state").asText());
        JsonNode ready = body(get(bruno, fu + "?decisionId=" + decisionId).then().statusCode(200).extract().response())
                .get("value");
        assertEquals("ready", ready.get("state").asText());
        assertEquals("saloon", ready.get("savedChange").get("change").get("after").asText());
        JsonNode cmp = ready.get("comparison");
        String secondOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ? AND state = 'active'", BRUNO);
        assertEquals(brunoOffer, cmp.get("previous").get("offer").get("offerId").asText());
        assertEquals("declined", cmp.get("previous").get("offer").get("state").asText());
        assertEquals(secondOffer, cmp.get("next").get("offer").get("offerId").asText());
        assertEquals(saved.get("briefVersion").asLong(), cmp.get("currentBriefVersion").asLong());
        assertEquals(saved.get("briefVersion").asLong(), cmp.get("next").get("scoreBasis").get("briefVersion").asLong());
        assertEquals("body", cmp.get("requirements").get(0).get("key").asText());
        assertEquals("saloon", cmp.get("requirements").get(0).get("value").asText());
        assertEquals("known", cmp.get("requirements").get(0).get("nextFacts").get("body").get("status").asText());
        JsonNode oldCurrent = cmp.path("previous").path("offer").path("comparison");
        JsonNode newCurrent = cmp.path("next").path("offer").path("comparison");
        assertEquals(1100, oldCurrent.path("currentCar").path("facts").path("points").path("value").asInt());
        assertEquals(900, newCurrent.path("currentCar").path("facts").path("points").path("value").asInt());
        assertFalse(oldCurrent.has("binding")); assertFalse(newCurrent.has("binding"));
        assertEquals(oldCurrent, view(bruno, brunoOffer).path("comparison"));
        assertEquals(newCurrent, view(bruno, secondOffer).path("comparison"));
        assertFalse(ready.toString().contains(paulaOffer));
        get(paula, fu + "?decisionId=" + decisionId).then().statusCode(403);

        // Declining that offer for equipment and requiring equipment no car has leaves nothing suitable: no-match.
        JsonNode secondView = view(bruno, secondOffer);
        String equipment = reasons.get("reasons").get(3).get("code").asText();
        JsonNode second = decide(bruno, secondOffer, decline("decline-2", secondView, equipment), 200).get("value");
        String secondDecision = second.get("decisionId").asText();
        JsonNode eq = body(get(bruno, fu + "?decisionId=" + secondDecision).then().statusCode(200).extract().response())
                .get("value");
        assertEquals("question", eq.get("state").asText());
        ObjectNode essential = BuddyJourneySupport.JSON.createObjectNode();
        essential.put("commandId", "followup-3").put("decisionId", secondDecision)
                .put("expectedBriefVersion", eq.get("briefVersion").asLong())
                .put("questionVersion", eq.get("question").get("questionVersion").asText());
        essential.putArray("value").add("tow-bar-that-no-car-has");
        JsonNode savedEq = body(BuddyJourneySupport.post(bruno, fu + "/confirm", essential.toString()).then().statusCode(200)
                .extract().response()).get("value");
        assertEquals("essentials.equipment", savedEq.get("change").get("path").asText());
        assertEquals("waiting", body(get(bruno, fu + "?decisionId=" + secondDecision).then().statusCode(200).extract()
                .response()).get("value").get("state").asText());
        assertEquals("completed", s.tick(presenter, "offer-journey-after-equipment").get("state").asText());
        JsonNode none = body(get(bruno, fu + "?decisionId=" + secondDecision).then().statusCode(200).extract().response())
                .get("value");
        assertEquals("no-match", none.get("state").asText(), none.toString());
        assertEquals(0, none.get("evaluation").get("suitable").asInt());
        assertEquals(s.count("SELECT jsonb_array_length(e.evaluation->'decisions') FROM allocation_evaluations e "
                + "JOIN allocation_runs r ON r.allocation_id = e.allocation_id AND r.run_id = e.run_id "
                + "WHERE e.employee_id = ? ORDER BY r.evaluated_at DESC, r.allocation_id DESC LIMIT 1", BRUNO),
                none.get("evaluation").get("carsChecked").asInt());
        assertTrue(none.get("evaluation").get("carsChecked").asInt() > 0);
        assertEquals(0, s.count("SELECT count(*) FROM buddy_offers WHERE employee_id = ? AND state = 'active'", BRUNO));
        s.assertCustodyInvariants(1);

        // Expiry on the run clock: past the hold duration, with no wall wait and no tick, the offer is refused.
        s.advance(presenter, 7200 + 60);
        // The current terms are read after the deadline: the refusal must come from the offer, not from stale terms.
        assertEquals("active", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        String beforeExpiry = written(s);
        JsonNode expired = decide(paula, paulaOffer, accept("accept-expired", paulaView, OfferDecisionJourneySupport.termsDigest(paula)), 409);
        assertTrue(expired.get("code").asText().matches("deadline-passed|offer-not-actionable"), expired.toString());
        assertEquals(beforeExpiry, written(s));
        assertEquals(0, s.count("SELECT count(*) FROM selection_orders"));
        JsonNode expiredView = view(paula, paulaOffer);
        assertEquals("expired", expiredView.get("state").asText());

        // A missing scoped clock refuses a real signed brief command before any domain write.
        JsonNode editor = body(get(bruno, "/api/gcsp/v1/brief/editor").then().statusCode(200).extract().response()).get("value");
        ObjectNode draft = BuddyJourneySupport.JSON.createObjectNode().put("commandId", "missing-clock-draft")
                .put("expectedBriefVersion", editor.at("/initial/briefVersion").asLong())
                .put("expectedDraftVersion", editor.at("/initial/draftVersion").asLong());
        draft.set("brief", editor.at("/initial/brief").deepCopy());
        try (var c = dataSource.getConnection()) {
            // Test-only fault injection; production clock rows remain append/forward guarded.
            c.createStatement().execute("SET session_replication_role = replica");
            assertEquals(1, c.createStatement().executeUpdate("DELETE FROM run_clocks"));
        }
        String beforeMissingClock = briefWrites(s);
        JsonNode unavailable = body(BuddyJourneySupport.post(bruno, "/api/gcsp/v1/brief/draft", draft.toString())
                .then().statusCode(503).extract().response());
        assertEquals("brief-unavailable", unavailable.get("code").asText());
        get(bruno, "/api/gcsp/v1/brief/editor").then().statusCode(503);
        assertEquals(beforeMissingClock, briefWrites(s));

    }

    private static String briefWrites(BuddyJourneySupport s) throws Exception {
        return s.count("SELECT count(*) FROM brief_heads") + ":" + s.count("SELECT coalesce(sum(version), 0) FROM brief_heads")
                + ":" + s.count("SELECT count(*) FROM briefs") + ":" + s.count("SELECT count(*) FROM brief_drafts")
                + ":" + s.count("SELECT count(*) FROM command_receipts") + ":" + s.count("SELECT count(*) FROM outbox_events")
                + ":" + s.count("SELECT sum(revision) FROM runs");
    }
}
