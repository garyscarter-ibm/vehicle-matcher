package gcsp.api.allocation;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_1;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_2;
import static gcsp.api.allocation.BuddyJourneySeed.CARLA;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.TickKind;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.identity.IdentityPort;
import gcsp.api.persistence.Canonical;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** AC1: a release allocates computed offers through the started app, driven by presenter ticks and real JWTs. */
@QuarkusTest
@TestProfile(BuddyJourneyProfiles.Local.class)
class BuddyAllocationJourneyHttpTest {

    private static final List<String> QUOTE = List.of("orderUuid", "configurationId", "snapshot", "terms",
            "employeeFacts", "reasons", "tradeOffs", "versions");

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockHolder holder;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @Inject
    IdentityPort identity;

    @Inject
    RemoteBuddy buddy;

    @BeforeEach
    void useTheRunClockForDocuments() {
        // The documents tests' shared @Alternative clock would pin the time; the journey needs the run clock.
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void aSupplyReleaseAllocatesOneHolderPerCarWithinLimitsAndRetainsQuotesAndExplanations() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String carla = s.token("sub-carla", "employee");
        String bruno = s.token("sub-bruno", "employee");

        assertEquals("oidc", identity.mode());
        assertEquals("local-synthetic", buddy.mode());
        List<String> handlers = holder.handlerIds();
        assertTrue(handlers.containsAll(List.of("stock-release", "buddy-allocation", "buddy-expiry")), handlers.toString());
        assertFalse(handlers.contains("buddy-pending-operations"), "local mode has nothing remote to reconcile");
        assertEquals(2, s.count("SELECT count(*) FROM stock_cars WHERE state = 'unreleased'"));
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds"));
        // A second employee has only a recorded body fact: the real producer must preserve a partial comparison.
        try (var c = dataSource.getConnection(); var ps = c.prepareStatement("UPDATE employee_account_records SET record = "
                + "jsonb_set(record, '{contracts,0,vehicle}', '{\"body\":\"estate\"}'::jsonb) WHERE employee_id = ?")) {
            ps.setString(1, BRUNO); assertEquals(1, ps.executeUpdate());
        }

        // One presenter tick: the app's own supply path releases both cars and the same tick allocates them.
        JsonNode tick = s.tick(presenter, "journey-local-1");
        assertEquals("completed", tick.get("state").asText());
        List<String> order = new ArrayList<>();
        tick.get("handlerOrder").forEach(h -> order.add(h.get("handlerId").asText()));
        assertTrue(order.indexOf("stock-release") >= 0 && order.indexOf("stock-release") < order.indexOf("buddy-allocation"),
                order.toString());
        JsonNode release = BuddyJourneySupport.outcome(tick, "stock-release");
        assertEquals("ok", release.get("status").asText());
        assertEquals("stock-released", release.get("value").get("kind").asText());
        assertEquals(2, release.get("value").get("orderUuids").size());
        JsonNode allocated = BuddyJourneySupport.outcome(tick, "buddy-allocation");
        assertEquals("ok", allocated.get("status").asText());
        assertEquals(1, allocated.get("value").get("allocations").asInt());
        assertEquals(1, allocated.get("value").get("states").get("allocated").asInt());
        assertEquals(2, s.count("SELECT count(*) FROM stock_cars WHERE state = 'released' "
                + "AND attributes->'release'->>'releasedAt' IS NOT NULL"));

        // One allocation, from the stock-released event the release stage emitted.
        assertEquals(1, s.count("SELECT count(*) FROM allocation_runs"));
        JsonNode run = s.json("SELECT jsonb_build_object('trigger', trigger_type, 'state', state, 'outcome', outcome, "
                + "'plan', plan)::text FROM allocation_runs");
        assertEquals("stock-released", run.get("trigger").asText());
        assertEquals("completed", run.get("state").asText());
        assertEquals("allocated", run.get("outcome").get("state").asText());
        int maxActive = run.get("plan").get("maxActive").asInt();
        assertEquals(1, maxActive);
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'stock-released'"));

        // The policy order for the contended car: earliest renewal first (Paula, Carla, Bruno).
        List<String> contendersForCar1 = s.column("SELECT employee_id FROM allocation_contenders WHERE order_uuid = ? "
                + "ORDER BY ordinal", CAR_1);
        assertEquals(List.of(PAULA, CARLA, BRUNO), contendersForCar1);
        assertEquals(List.of(BRUNO), s.column("SELECT employee_id FROM allocation_contenders WHERE order_uuid = ?", CAR_2));
        assertEquals("renewalDueThenFitThenSeededLottery", run.get("plan").get("rule").asText());

        // The plan replayed in ordinal order must equal what was claimed: one holder per car, one car per employee.
        List<String> plan = s.column("SELECT employee_id || '|' || order_uuid FROM allocation_contenders ORDER BY ordinal");
        Set<String> takenEmployees = new HashSet<>();
        Set<String> takenCars = new HashSet<>();
        List<String> expected = new ArrayList<>();
        for (String row : plan) {
            String[] parts = row.split("\\|");
            if (takenEmployees.contains(parts[0]) || takenCars.contains(parts[1])) continue;
            takenEmployees.add(parts[0]);
            takenCars.add(parts[1]);
            expected.add(row);
        }
        List<String> held = s.column("SELECT employee_id || '|' || order_uuid FROM custody_holds WHERE state = 'active' "
                + "ORDER BY order_uuid");
        assertEquals(expected.stream().sorted().toList(), held.stream().sorted().toList());
        assertEquals(List.of(PAULA + "|" + CAR_1, BRUNO + "|" + CAR_2), held);
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ?", CARLA));
        assertEquals(2, s.count("SELECT count(*) FROM allocation_attempts WHERE status = 'claimed'"));
        s.assertCustodyInvariants(maxActive);
        assertEquals(2, s.count("SELECT count(*) FROM custody_holds WHERE state = 'active' AND hold_type = 'buddy-offer'"));

        // The quote is retained whole and equals the plan's quote for the claimed contender.
        assertEquals(2, s.count("SELECT count(*) FROM buddy_quotes"));
        for (String employee : List.of(PAULA, BRUNO)) {
            JsonNode quote = s.json("SELECT quote::text FROM buddy_quotes WHERE employee_id = ?", employee);
            JsonNode planned = s.json("SELECT c.quote::text FROM allocation_contenders c JOIN buddy_quotes q "
                    + "ON q.order_uuid = c.order_uuid AND q.employee_id = c.employee_id WHERE q.employee_id = ?", employee);
            for (String key : QUOTE) {
                assertTrue(quote.has(key) && !quote.get(key).isNull(), employee + " quote lacks " + key);
                assertEquals(Canonical.json(planned.get(key)), Canonical.json(quote.get(key)), key);
            }
            assertEquals("eligible", quote.get("gateStatus").asText());
            assertEquals("gcsp-policy-v1", quote.get("versions").get("policy").asText());
            assertTrue(quote.get("reasons").size() > 0 && quote.get("terms").has("validUntil"));
        }

        // Every evaluated employee keeps decisions with reasons and blockers, eligible or not.
        assertEquals(3, s.count("SELECT count(*) FROM allocation_evaluations"));
        for (String employee : List.of(PAULA, CARLA, BRUNO)) {
            JsonNode evaluation = s.json("SELECT evaluation::text FROM allocation_evaluations WHERE employee_id = ?", employee);
            assertEquals(2, evaluation.get("decisions").size(), employee);
            for (JsonNode d : evaluation.get("decisions")) {
                assertTrue(d.has("reasons") && d.has("blockers") && d.has("gateStatus"), d.toString());
            }
        }
        JsonNode carlaOnCar2 = s.json("SELECT d::text FROM allocation_evaluations e, jsonb_array_elements(e.evaluation->'decisions') d "
                + "WHERE e.employee_id = ? AND d->>'orderUuid' = ?", CARLA, CAR_2);
        assertNotEquals("eligible", carlaOnCar2.get("gateStatus").asText());
        assertTrue(carlaOnCar2.get("blockers").size() > 0, "an ineligible car carries its blocker");

        // The winners see their own offer through the offers routes; the loser sees nothing of it.
        String paulaOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", PAULA);
        String brunoOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", BRUNO);
        assertEquals(2, s.count("SELECT count(*) FROM buddy_offers WHERE state = 'active'"));
        JsonNode current = BuddyJourneySupport.value(get(paula, API + "/offers/current"), 200);
        assertEquals(1, current.get("value").get("offers").size());
        assertEquals(paulaOffer, current.get("value").get("offers").get(0).get("offerId").asText());
        JsonNode view = BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).get("value");
        assertEquals("pending", view.get("state").asText());
        assertEquals("awaiting-decision", view.get("reason").asText());
        assertEquals(CAR_1, view.get("quote").get("orderUuid").asText());
        JsonNode comparison = view.path("comparison");
        assertEquals("available", comparison.path("status").asText(), comparison.toString());
        assertTrue(comparison.path("comparisonAvailable").asBoolean());
        assertEquals(1100, comparison.path("currentCar").path("facts").path("points").path("value").asInt());
        JsonNode pin = s.json("SELECT quote->'currentCarComparison' FROM buddy_quotes WHERE employee_id = ?", PAULA);
        assertEquals("available", pin.path("display").path("state").asText());
        assertEquals(3, pin.path("binding").path("employeeVersion").asInt());
        assertFalse(comparison.has("binding"));
        JsonNode partial = BuddyJourneySupport.value(get(bruno, API + "/offers/" + brunoOffer), 200).path("value").path("comparison");
        assertEquals("partial", partial.path("status").asText());
        assertTrue(partial.path("comparisonAvailable").asBoolean());
        assertEquals(1, partial.path("currentCar").path("facts").size());
        assertEquals("estate", partial.path("currentCar").path("facts").path("body").path("value").asText());
        assertEquals(7, partial.path("unknowns").size());
        assertEquals(brunoOffer, BuddyJourneySupport.value(get(bruno, API + "/offers/current"), 200).get("value")
                .get("offers").get(0).get("offerId").asText());
        assertEquals(0, BuddyJourneySupport.value(get(carla, API + "/offers/current"), 200).get("value").get("offers").size());
        get(carla, API + "/offers/" + paulaOffer).then().statusCode(403);

        // Activity: winners show an offer and offer-held; the loser shows no-match and never the others' offers.
        JsonNode paulaActivity = BuddyJourneySupport.value(get(paula, API + "/activity"), 200).get("value");
        assertEquals("offer", paulaActivity.get("state").asText());
        assertEquals("offer-held", paulaActivity.get("lastSuccessfulCheck").get("outcome").asText());
        assertEquals(paulaOffer, paulaActivity.get("currentOffer").get("offerRef").get("offerId").asText());
        JsonNode brunoActivity = BuddyJourneySupport.value(get(bruno, API + "/activity"), 200).get("value");
        assertEquals("offer", brunoActivity.get("state").asText());
        assertEquals("offer-held", brunoActivity.get("lastSuccessfulCheck").get("outcome").asText());
        assertEquals(brunoOffer, brunoActivity.get("currentOffer").get("offerRef").get("offerId").asText());
        String carlaBody = get(carla, API + "/activity").then().statusCode(200).extract().asString();
        JsonNode carlaActivity = BuddyJourneySupport.JSON.readTree(carlaBody).get("value");
        assertEquals("searching", carlaActivity.get("state").asText());
        assertEquals("no-match", carlaActivity.get("lastSuccessfulCheck").get("outcome").asText());
        assertEquals(0, carlaActivity.get("offers").size());
        assertTrue(carlaActivity.get("currentOffer").isNull());
        assertFalse(carlaBody.contains(paulaOffer) || carlaBody.contains(brunoOffer));
        assertEquals("ok", carlaActivity.get("sourceStatus").asText());

        // Replaying the tick id, and a later tick with a fresh id, add no hold, offer, quote or allocation.
        JsonNode replay = s.tick(presenter, "journey-local-1");
        assertEquals("completed", replay.get("state").asText());
        s.advance(presenter, 60);
        JsonNode later = s.tick(presenter, "journey-local-2");
        assertEquals("completed", later.get("state").asText());
        assertEquals("no-release", BuddyJourneySupport.outcome(later, "stock-release").get("value").get("kind").asText());
        assertEquals(0, BuddyJourneySupport.outcome(later, "buddy-allocation").get("value").get("allocations").asInt());
        assertEquals(2, s.count("SELECT count(*) FROM custody_holds"));
        assertEquals(2, s.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(2, s.count("SELECT count(*) FROM buddy_quotes"));
        assertEquals(1, s.count("SELECT count(*) FROM allocation_runs"));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'stock-released'"));
        assertEquals(2, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        s.assertCustodyInvariants(maxActive);

        // These three source revisions change after the quote; neither GET nor startup may rebuild its pin.
        try (var c = dataSource.getConnection(); var ps = c.prepareStatement("UPDATE employee_account_records SET record = "
                + "jsonb_set(jsonb_set(record, '{contracts,0,vehicle,points}', '999'::jsonb), '{contracts,0,model}', "
                + "'\"Changed current source model\"'::jsonb), version = version + 1 WHERE employee_id = ?")) {
            ps.setString(1, PAULA); assertEquals(1, ps.executeUpdate());
        }
        try (var c = dataSource.getConnection(); var ps = c.prepareStatement("UPDATE employees SET version = version + 1 "
                + "WHERE employee_id = ?")) { ps.setString(1, PAULA); assertEquals(1, ps.executeUpdate()); }
        try (var c = dataSource.getConnection(); var ps = c.prepareStatement("UPDATE entitlement_slots SET version = version + 1 "
                + "WHERE employee_id = ?")) { ps.setString(1, PAULA); assertEquals(1, ps.executeUpdate()); }
        JsonNode reloaded = BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).path("value").path("comparison");
        assertEquals(comparison, reloaded);
        assertTrue(holder.clock().tick(holder.scope("comparison-restart"), "comparison-restart", s.clockVersion(presenter),
                TickKind.STARTUP) instanceof ClockResult.Ok);
        assertEquals(pin, s.json("SELECT quote->'currentCarComparison' FROM buddy_quotes WHERE employee_id = ?", PAULA));
        assertEquals(comparison, BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).path("value").path("comparison"));
        assertEquals(2, s.count("SELECT count(*) FROM buddy_quotes"));
        assertEquals(2, s.count("SELECT count(*) FROM custody_holds"));
        assertEquals(2, s.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(2, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
    }
}
