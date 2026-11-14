package gcsp.api.brief;

import static gcsp.api.brief.Harness.choose;
import static gcsp.api.brief.Harness.envelope;
import static gcsp.api.brief.Harness.list;
import static gcsp.api.brief.Harness.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Replays server/test/gcsp-buddy-engagement.test.js against the Java brief service and PostgreSQL. */
class EngagementTest {

    BriefFixture f;
    Harness h;

    @BeforeEach
    void setUp() throws SQLException {
        f = BriefFixture.create();
        h = new Harness(f);
    }

    @AfterEach
    void tearDown() throws SQLException {
        if (f != null) f.close();
    }

    private ObjectNode editable() {
        return ((ObjectNode) h.ok(f.service.resolveInitial(f.scope)).get("initial")).deepCopy();
    }

    @Test
    void fewerThanThreeCategoriesAreRefusedWithTheRemainingCountAndNothingIsWritten() throws Exception {
        ObjectNode two = h.sparse();
        choose(two, "body", list("saloon", "estate"), 50);
        choose(two, "sportiness", Json.M.getNodeFactory().numberNode(50), 50);
        h.saveOk(two);
        List<Long> before = f.snapshot();
        BriefResult.Refusal r = h.refused(h.engage(), 400, "engagement-minimum");
        assertEquals(1, r.extra().get("remaining").intValue());
        assertEquals(2, r.extra().get("considered").intValue());
        assertEquals(3, r.extra().get("minimumCategories").intValue());
        assertEquals("Choose 1 more category or turn on Same again to engage Buddy.",
                r.extra().get("reasons").get(0).get("reason").asText());
        assertEquals(before, f.snapshot());
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
        // Two more missing reads as plural; a policy default never counts.
        ObjectNode one = h.sparse();
        choose(one, "body", list("saloon"), 50);
        h.saveOk(one);
        BriefResult.Refusal plural = h.refused(h.engage(), 400, "engagement-minimum");
        assertEquals(2, plural.extra().get("remaining").intValue());
        assertEquals("Choose 2 more categories or turn on Same again to engage Buddy.",
                plural.extra().get("reasons").get(0).get("reason").asText());
    }

    @Test
    void threeCategoriesEngageAndSeveralChoicesInOneCategoryCountOnce() throws Exception {
        ObjectNode b = h.sparse();
        choose(b, "body", list("hatchback", "saloon", "estate"), 50);
        choose(b, "fuel", list("petrol", "diesel"), 50);
        h.saveOk(b);
        assertEquals(1, h.refused(h.engage(), 400, "engagement-minimum").extra().get("remaining").intValue());
        choose(b, "comfort", Json.M.getNodeFactory().numberNode(50), 50);
        h.saveOk(b);
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
        JsonNode out = h.engageOk();
        JsonNode buddy = out.get("buddy");
        assertEquals("engaged", buddy.get("state").asText());
        assertEquals(1, buddy.get("permissionVersion").intValue());
        assertEquals(3, buddy.get("considered").intValue());
        assertEquals(0, buddy.get("remaining").intValue());
        assertEquals(1, out.get("briefVersion").intValue());
        assertEquals(2, out.get("draftVersion").intValue());
        JsonNode brief = h.current().get("brief");
        assertTrue(brief.get("buddy").get("searchConsent").booleanValue());
        assertTrue(brief.get("buddy").get("holdConsent").booleanValue());
        assertFalse(brief.get("buddy").get("paused").booleanValue());
        assertFalse(brief.get("buddy").has("disengagedReason"));
        assertEquals("engaged", h.operation(1));
        assertTrue(h.current().get("activity").get("canSearch").booleanValue());
        assertTrue(h.current().get("activity").get("canHold").booleanValue());
        assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-changed'"));
        assertEquals(2, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-draft-saved'"));
    }

    @Test
    void sameAgainBypassesTheMinimumEvenWithNoCategories() throws Exception {
        f.account.contract(h.contractId(), "model-x");
        ObjectNode b = h.sparse();
        b.set("sameAgain", h.sameAgain(true));
        h.saveOk(b);
        JsonNode out = h.engageOk();
        assertEquals("engaged", out.get("buddy").get("state").asText());
        assertTrue(out.get("buddy").get("sameAgain").booleanValue());
        assertTrue(h.current().get("brief").get("sameAgain").get("on").booleanValue());
    }

    @Test
    void sameAgainCountsOnlyForTheCurrentCarAndNeedsTheAccountFacts() throws Exception {
        ObjectNode b = h.sparse();
        b.set("sameAgain", h.sameAgain(true));
        h.saveOk(b);
        // No account facts at all: the intent cannot count, and the refusal says so with the full remaining count.
        assertEquals(3, h.refused(h.engage(), 400, "engagement-minimum").extra().get("remaining").intValue());
        f.account.contract("another-contract", "model-x");
        h.refused(h.engage(), 400, "engagement-minimum");
        f.account.contract(h.contractId(), null);
        h.refused(h.engage(), 400, "engagement-minimum");
        f.account.contract(h.contractId(), "model-x");
        h.engageOk();
    }

    @Test
    void engagingWithAPendingDraftConfirmsTheDraftContentAsTheLatestBrief() throws Exception {
        h.saveOk(h.three());
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
        h.engageOk();
        JsonNode brief = h.current().get("brief");
        assertEquals("saloon", brief.get("preferences").get("body").get("value").get(0).asText());
        assertEquals("confirmed", brief.get("preferences").get("sportiness").get("valueState").asText());
        assertEquals("principal-1", brief.get("buddy").get("engagedBy").asText());
        // The next autosave builds on this version.
        ObjectNode next = editable();
        choose(next, "economy", Json.M.getNodeFactory().numberNode(50), 100);
        assertEquals(2, h.saveOk(next).get("confirmed").get("briefVersion").intValue());
    }

    @Test
    void aStaleDraftOrBriefVersionIsRefusedAndNothingIsWritten() throws Exception {
        h.saveOk(h.three());
        ObjectNode old = h.at("old-draft");
        ObjectNode later = editable();
        choose(later, "comfort", Json.M.getNodeFactory().numberNode(0), 50);
        h.saveOk(later);
        List<Long> before = f.snapshot();
        BriefResult.Refusal staleDraft = h.refused(f.service.engage(f.scope, old), 409, "stale-version");
        assertEquals(1, staleDraft.extra().get("expectedVersion").intValue());
        assertEquals(2, staleDraft.extra().get("currentVersion").intValue());
        assertEquals("refresh", staleDraft.extra().get("action").asText());
        h.refused(f.service.engage(f.scope, envelope("old-brief", 4, 2)), 409, "stale-version");
        assertEquals(before, f.snapshot());
        h.engageOk();
        assertEquals(0, h.current().get("brief").get("preferences").get("comfort").get("value").intValue());
        h.refused(f.service.disengage(f.scope, old), 409, "stale-version");
        for (String extra : List.of("consent", "employeeId", "brief")) {
            ObjectNode withExtra = h.at(f.nextId());
            withExtra.set(extra, obj());
            h.refused(f.service.engage(f.scope, withExtra), 400, "invalid-command");
        }
        h.refused(f.service.engage(f.scope, h.at(f.nextId()).put("commandId", "x".repeat(129))), 400, "invalid-command");
        h.refused(f.service.engage(f.scope, obj().put("commandId", "c").put("expectedBriefVersion", 0)), 400, "invalid-command");
    }

    @Test
    void repeatingACommandReplaysOneOutcomeAndAChangedBodyOrStateConflictIsRefused() throws Exception {
        h.saveOk(h.three());
        ObjectNode body = h.at("engage-once");
        JsonNode first = h.ok(f.service.engage(f.scope, body));
        BriefResult replay = f.service.engage(f.scope, body);
        assertEquals(first, h.ok(replay));
        assertTrue(((BriefResult.Ok) replay).replayed());
        assertEquals(1, f.count("SELECT count(*) FROM briefs"));
        ObjectNode changed = body.deepCopy();
        changed.put("expectedDraftVersion", 2);
        h.refused(f.service.engage(f.scope, changed), 409, "command-input-changed");
        BriefResult.Refusal again = h.refused(h.engage(), 409, "already-engaged");
        assertEquals(1, again.extra().get("current").get("briefVersion").intValue());
        ObjectNode off = h.at("off-once");
        JsonNode disengaged = h.ok(f.service.disengage(f.scope, off));
        assertEquals(disengaged, h.ok(f.service.disengage(f.scope, off)));
        assertEquals(2, f.count("SELECT count(*) FROM briefs"));
        h.refused(f.service.disengage(f.scope, h.at(f.nextId())), 409, "already-disengaged");
        assertEquals(2, f.count("SELECT count(*) FROM briefs"));
    }

    @Test
    void disengageStopsSearchAndHoldKeepsChoicesRatingAndSameAgainAndLeavesOffersAlone() throws Exception {
        f.account.contract(h.contractId(), "model-x");
        ObjectNode b = h.three();
        b.set("sameAgain", h.sameAgain(true));
        b.set("currentCarRating", obj().put("value", 4).put("contractId", h.contractId()).put("source", "employee")
                .put("ratedAt", "2026-11-13T09:00:00Z"));
        h.saveOk(b);
        h.engageOk();
        f.offers.list = List.of(new BriefOfferPort.Offer("offer-1", "active", 1L));
        JsonNode engaged = h.current().get("brief");
        JsonNode out = h.ok(f.service.disengage(f.scope, h.at(f.nextId())));
        assertEquals("disengaged", out.get("buddy").get("state").asText());
        assertEquals(2, out.get("buddy").get("permissionVersion").intValue());
        assertTrue(out.get("buddy").get("canEngage").booleanValue());
        JsonNode now = h.current();
        for (String key : List.of("preferences", "essentials", "currentCarRating", "sameAgain")) {
            assertEquals(engaged.get(key), now.get("brief").get(key), key);
        }
        JsonNode buddy = now.get("brief").get("buddy");
        assertFalse(buddy.get("searchConsent").booleanValue());
        assertFalse(buddy.get("holdConsent").booleanValue());
        assertFalse(buddy.get("enabled").booleanValue());
        assertEquals("disengaged", now.get("brief").get("operation").asText());
        assertFalse(now.get("activity").get("canSearch").booleanValue());
        assertFalse(now.get("activity").get("canHold").booleanValue());
        assertTrue(now.get("activity").get("existingOffersUnaffected").booleanValue());
        assertEquals("offer-1", now.get("activity").get("existingOffers").get(0).get("offerId").asText());
        // It can be engaged again from the same saved choices.
        assertEquals(3, h.engageOk().get("buddy").get("permissionVersion").intValue());
    }

    @Test
    void aValidEditWhileEngagedStaysEngagedWithANewVersionAndAnUnchangedPermissionVersion() throws Exception {
        h.engaged();
        ObjectNode b = editable();
        choose(b, "comfort", Json.M.getNodeFactory().numberNode(100), 100);
        JsonNode out = h.saveOk(b);
        assertEquals(2, out.get("confirmed").get("briefVersion").intValue());
        assertTrue(out.get("confirmed").get("transition").isNull());
        JsonNode brief = h.current().get("brief");
        assertEquals(2, brief.get("briefVersion").intValue());
        assertEquals(1, brief.get("buddy").get("permissionVersion").intValue());
        assertTrue(brief.get("buddy").get("searchConsent").booleanValue());
        assertEquals("preferences-updated", brief.get("operation").asText());
        assertEquals(100, brief.get("preferences").get("comfort").get("value").intValue());
        // The next autosave carries on from the version the response reported.
        ObjectNode again = editable();
        choose(again, "size", Json.M.getNodeFactory().numberNode(0), 50);
        assertEquals(3, h.saveOk(again).get("confirmed").get("briefVersion").intValue());
        assertTrue(h.current().get("activity").get("canSearch").booleanValue());
    }

    @Test
    void removingACategoryBelowTheMinimumWhileEngagedDisengagesWithTheSaveAndLaterEvaluationSeesIt() throws Exception {
        h.engaged();
        assertTrue(h.current().get("activity").get("canSearch").booleanValue());
        ObjectNode b = editable();
        ((ObjectNode) b.get("preferences")).remove("sportiness");
        JsonNode out = h.saveOk(b);
        assertEquals("minimum-lost", out.get("confirmed").get("transition").asText());
        assertEquals(2, out.get("confirmed").get("briefVersion").intValue());
        JsonNode now = h.current();
        JsonNode buddy = now.get("brief").get("buddy");
        assertFalse(buddy.get("searchConsent").booleanValue());
        assertFalse(buddy.get("holdConsent").booleanValue());
        assertFalse(buddy.get("paused").booleanValue());
        assertEquals("minimum-lost", buddy.get("disengagedReason").asText());
        assertEquals(2, buddy.get("permissionVersion").intValue());
        assertEquals("disengaged", h.operation(2));
        assertFalse(now.get("activity").get("canSearch").booleanValue());
        assertFalse(now.get("activity").get("canHold").booleanValue());
        assertFalse(now.get("brief").get("preferences").has("sportiness"));
        assertEquals("saloon", now.get("brief").get("preferences").get("body").get("value").get(0).asText());
        // The reason clears once Buddy is engaged again.
        ObjectNode restored = editable();
        choose(restored, "sportiness", Json.M.getNodeFactory().numberNode(50), 50);
        h.saveOk(restored);
        h.engageOk();
        assertFalse(h.current().get("brief").get("buddy").has("disengagedReason"));
    }

    @Test
    void turningSameAgainOffBelowTheMinimumWhileEngagedDisengagesAsMinimumLost() throws Exception {
        f.account.contract(h.contractId(), "model-x");
        ObjectNode b = h.sparse();
        b.set("sameAgain", h.sameAgain(true));
        h.saveOk(b);
        h.engageOk();
        ObjectNode off = editable();
        off.set("sameAgain", h.sameAgain(false));
        assertEquals("minimum-lost", h.saveOk(off).get("confirmed").get("transition").asText());
        assertEquals("disengaged", h.operation(2));
        assertFalse(h.current().get("activity").get("canSearch").booleanValue());
        assertFalse(h.current().get("brief").get("sameAgain").get("on").booleanValue());
    }

    @Test
    void aRefusedOrStaleSaveWhileEngagedWritesNothingAndKeepsBuddyEngaged() throws Exception {
        h.engaged();
        List<Long> before = f.snapshot();
        ObjectNode bad = editable();
        ((ObjectNode) bad.get("preferences").get("sportiness")).put("value", 140);
        h.refused(h.save(bad), 400, "invalid-brief");
        h.refused(f.service.saveDraft(f.scope, envelope("stale", 0, 0).set("brief", editable())), 409, "stale-version");
        assertEquals(before, f.snapshot());
        assertTrue(h.current().get("activity").get("canSearch").booleanValue());
    }

    @Test
    void anEditWhilePausedStaysPausedAndADisengagedBriefCannotBePaused() throws Exception {
        h.engaged();
        h.ok(f.service.pauseSearch(f.scope, h.at(f.nextId())));
        assertTrue(h.current().get("brief").get("buddy").get("paused").booleanValue());
        assertFalse(h.current().get("activity").get("canSearch").booleanValue());
        ObjectNode b = editable();
        choose(b, "comfort", Json.M.getNodeFactory().numberNode(100), 50);
        h.saveOk(b);
        JsonNode brief = h.current().get("brief");
        assertEquals(3, brief.get("briefVersion").intValue());
        assertTrue(brief.get("buddy").get("paused").booleanValue());
        assertTrue(brief.get("buddy").get("searchConsent").booleanValue());
        assertEquals(2, brief.get("buddy").get("permissionVersion").intValue());
        h.refused(f.service.pauseSearch(f.scope, h.at(f.nextId())), 409, "already-paused");
        h.ok(f.service.resumeSearch(f.scope, h.at(f.nextId())));
        assertTrue(h.current().get("activity").get("canSearch").booleanValue());
        h.refused(f.service.resumeSearch(f.scope, h.at(f.nextId())), 409, "already-resumed");
        h.ok(f.service.disengage(f.scope, h.at(f.nextId())));
        h.refused(f.service.pauseSearch(f.scope, h.at(f.nextId())), 409, "not-engaged");
    }

    @Test
    void resumeCannotBypassTheAccountMinimum() throws Exception {
        h.engaged();
        h.ok(f.service.pauseSearch(f.scope, h.at(f.nextId())));
        // Saving below the minimum while consent is held disengages; resume then re-checks the same gate.
        ObjectNode b = editable();
        ((ObjectNode) b.get("preferences")).remove("sportiness");
        h.saveOk(b);
        assertFalse(h.current().get("brief").get("buddy").get("searchConsent").booleanValue());
        h.refused(f.service.resumeSearch(f.scope, h.at(f.nextId())), 400, "engagement-minimum");
    }

    @Test
    void beforeEngagementAnAutosaveStaysADraftAndGrantsNothing() throws Exception {
        h.saveOk(h.three());
        ObjectNode b = editable();
        choose(b, "comfort", Json.M.getNodeFactory().numberNode(0), 50);
        JsonNode out = h.saveOk(b);
        assertFalse(out.has("confirmed"));
        assertEquals(0, f.count("SELECT count(*) FROM briefs"));
        assertEquals(0, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'brief-changed'"));
        h.refused(f.service.current(f.scope), 404, "not-found");
        assertEquals(2, h.ok(f.service.draft(f.scope)).get("draftVersion").intValue());
    }

    @Test
    void anAcceptedOfferMakesEveryBriefCommandReadOnly() throws Exception {
        h.engaged();
        f.offers.list = List.of(new BriefOfferPort.Offer("offer-9", "accepted", 1L));
        List<Long> before = f.snapshot();
        ObjectNode consent = h.at(f.nextId());
        consent.set("consent", obj().put("search", true).put("hold", true));
        for (BriefResult r : List.of(h.engage(), f.service.disengage(f.scope, h.at(f.nextId())),
                f.service.pauseSearch(f.scope, h.at(f.nextId())), f.service.resumeSearch(f.scope, h.at(f.nextId())),
                h.save(editable()), f.service.confirm(f.scope, consent))) {
            BriefResult.Refusal x = h.refused(r, 409, "brief-read-only");
            assertEquals(1, x.extra().get("current").get("briefVersion").intValue());
        }
        assertEquals(before, f.snapshot());
    }

    @Test
    void engagementFailsClosedWhenItsPolicyEntryIsMalformed() throws Exception {
        h.saveOk(h.three());
        f.policy.edit(BriefAssumptions.ENGAGEMENT, v -> v.put("onMinimumLoss", "ignore"));
        List<Long> before = f.snapshot();
        h.refused(h.engage(), 503, "brief-unavailable");
        ObjectNode consent = h.at(f.nextId());
        consent.set("consent", obj().put("search", true).put("hold", true));
        h.refused(f.service.confirm(f.scope, consent), 503, "brief-unavailable");
        assertEquals(before, f.snapshot());
        // Consent-free confirmation never touches the engagement entry.
        h.ok(f.service.confirm(f.scope, h.at(f.nextId())));
        assertNotEquals(before, f.snapshot());
        // An absent policy is unavailable too, on reads as well as commands.
        f.policy.edit(BriefAssumptions.ENGAGEMENT, v -> v.put("onMinimumLoss", "disengage"));
        BriefService none = new BriefService(f.pool(), v -> java.util.Optional.empty(), f.account, f.offers,
                java.time.Clock.systemUTC());
        h.refused(none.current(f.scope), 503, "brief-unavailable");
        h.refused(none.engage(f.scope, h.at(f.nextId())), 503, "brief-unavailable");
    }
}
