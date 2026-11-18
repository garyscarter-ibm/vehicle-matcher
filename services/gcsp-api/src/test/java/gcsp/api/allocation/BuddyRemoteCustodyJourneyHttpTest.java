package gcsp.api.allocation;

import static gcsp.api.allocation.BuddyJourneySeed.BRUNO;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_1;
import static gcsp.api.allocation.BuddyJourneySeed.CAR_3;
import static gcsp.api.allocation.BuddyJourneySeed.CARLA;
import static gcsp.api.allocation.BuddyJourneySeed.PAULA;
import static gcsp.api.allocation.BuddyJourneySupport.API;
import static gcsp.api.allocation.BuddyJourneySupport.get;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.clock.TickKind;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import gcsp.api.remote.RemoteOperationServer;
import gcsp.api.remote.RemoteOperationServer.Execute;
import gcsp.api.remote.RemoteOperationServer.Reconcile;
import gcsp.api.clock.RunClockDocumentClock;
import gcsp.api.documents.DocumentClock;
import gcsp.api.documents.RunClockBackedTestClock;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** AC2: remote claims, lost answers, restart, expiry and release keep truthful custody through the started app. */
@QuarkusTest
@TestProfile(BuddyJourneyProfiles.Remote.class)
class BuddyRemoteCustodyJourneyHttpTest {

    @ConfigProperty(name = "gcsp.test.signing-jwk")
    String signingJwk;

    @InjectBuddyRemote
    RemoteOperationServer remote;

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RunClockHolder holder;

    @Inject
    RunClockDocumentClock runClockDocuments;

    @Inject
    RemoteBuddy buddy;

    @BeforeEach
    void useTheRunClockForDocuments() {
        // The documents tests' shared @Alternative clock would pin the time; the journey needs the run clock.
        QuarkusMock.installMockForType(new RunClockBackedTestClock(runClockDocuments), DocumentClock.class);
    }

    @Test
    void lostAnswersNeverFreeUncertainStockAndRestartAndExpiryReconcileTruthfully() throws Exception {
        BuddyJourneySupport s = new BuddyJourneySupport(dataSource, signingJwk);
        String presenter = s.token("sub-presenter", "presenter");
        String paula = s.token("sub-paula", "employee");
        String carla = s.token("sub-carla", "employee");
        assertEquals("remote", buddy.mode());
        assertTrue(holder.handlerIds().containsAll(List.of("buddy-allocation", "buddy-expiry", "buddy-pending-operations")),
                holder.handlerIds().toString());
        assertEquals(2, s.count("SELECT count(*) FROM stock_cars WHERE state = 'unreleased'"));
        long maxActive = 1;

        // Lost execute: the remote applies Paula's claim but its answer never arrives.
        remote.onExecute(Execute.APPLY_THEN_DROP);
        JsonNode t1 = s.tick(presenter, "remote-1");
        assertEquals("completed", t1.get("state").asText());
        assertEquals("stock-released", BuddyJourneySupport.outcome(t1, "stock-release").get("value").get("kind").asText());
        assertEquals(1, BuddyJourneySupport.outcome(t1, "buddy-allocation").get("value").get("allocations").asInt());
        String paulaOp = s.text("SELECT operation_id FROM custody_holds WHERE employee_id = ?", PAULA);
        String paulaHold = s.text("SELECT hold_id FROM custody_holds WHERE employee_id = ?", PAULA);
        assertEquals("claim-pending", s.text("SELECT state FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals(CAR_1, s.text("SELECT order_uuid FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals("pending", s.text("SELECT state FROM pending_operations WHERE operation_id = ?", paulaOp));
        assertEquals(1, s.count("SELECT attempts FROM pending_operations WHERE operation_id = ?", paulaOp));
        assertEquals(0, s.count("SELECT count(*) FROM buddy_offers"));
        assertEquals(0, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1'"));
        assertEquals(1, remote.posts(paulaOp));
        assertEquals(1, remote.effects(paulaOp));
        assertEquals(0, BuddyJourneySupport.value(get(paula, API + "/offers/current"), 200).get("value").get("offers").size());
        assertEquals("claim-pending", s.text("SELECT status FROM allocation_attempts WHERE operation_id = ?", paulaOp));
        // Carla and Bruno also want car 1, but nothing else can take it while the claim is uncertain.
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", CAR_1));
        s.assertCustodyInvariants(maxActive);

        // Lost reconcile, and a second release of stock: the pending claim keeps car 1, the second car goes to Carla.
        remote.onReconcile(Reconcile.FAIL_500);
        s.advance(presenter, 600);
        JsonNode t2 = s.tick(presenter, "remote-2");
        assertEquals("completed", t2.get("state").asText());
        assertEquals("stock-released", BuddyJourneySupport.outcome(t2, "stock-release").get("value").get("kind").asText());
        JsonNode reconciled = BuddyJourneySupport.outcome(t2, "buddy-pending-operations").get("value");
        assertEquals(1, reconciled.get("pending").asInt());
        assertEquals(0, reconciled.get("settled").asInt());
        assertEquals("claim-pending", s.text("SELECT state FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals("pending", s.text("SELECT state FROM pending_operations WHERE operation_id = ?", paulaOp));
        assertEquals(0, s.count("SELECT count(*) FROM buddy_offers WHERE employee_id = ?", PAULA));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ? AND state = 'claim-pending'", CAR_1));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", CAR_1));
        assertEquals(1, remote.gets(paulaOp));
        assertEquals(CAR_3, s.text("SELECT order_uuid FROM custody_holds WHERE employee_id = ?", CARLA));
        assertEquals("active", s.text("SELECT state FROM custody_holds WHERE employee_id = ?", CARLA));
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ?", BRUNO));
        s.assertCustodyInvariants(maxActive);
        JsonNode lost = BuddyJourneySupport.value(get(paula, API + "/activity"), 200).get("value");
        assertTrue(lost.get("currentOffer").isNull(), "an unconfirmed claim is not shown as an offer");

        // Restart path: a later clock, the remote now answers confirmed; the startup stages reconcile the claim.
        // A started app runs reconcileOnce once and caches it, so the restart is a startup-kind tick on the run clock.
        JsonNode quoteBefore = s.json("SELECT quote::text FROM buddy_quotes WHERE employee_id = ?", PAULA);
        String quoteId = s.text("SELECT quote_id FROM buddy_quotes WHERE employee_id = ?", PAULA);
        s.advance(presenter, 300);
        RunContext scope = holder.scope("test-restart");
        ClockResult restarted = holder.clock().tick(scope, "startup-restart-1", s.clockVersion(presenter), TickKind.STARTUP);
        assertTrue(restarted instanceof ClockResult.Ok, restarted.toString());
        JsonNode startup = ((ClockResult.Ok) restarted).value();
        assertEquals("startup", startup.get("kind").asText());
        assertEquals("completed", startup.get("state").asText());
        assertEquals(1, BuddyJourneySupport.outcome(startup, "buddy-pending-operations").get("value").get("settled").asInt());
        assertEquals("active", s.text("SELECT state FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals("acknowledged", s.text("SELECT state FROM pending_operations WHERE operation_id = ?", paulaOp));
        assertEquals(1, s.count("SELECT count(*) FROM buddy_offers WHERE employee_id = ?", PAULA));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'notification.offer.v1' "
                + "AND payload->>'offerId' = (SELECT offer_id FROM buddy_offers WHERE employee_id = '" + PAULA + "')"));
        assertEquals(quoteId, s.text("SELECT quote_id FROM buddy_offers WHERE employee_id = ?", PAULA));
        assertEquals(1, s.count("SELECT count(*) FROM buddy_quotes WHERE employee_id = ?", PAULA));
        assertEquals(Canonical.json(quoteBefore), Canonical.json(s.json("SELECT quote::text FROM buddy_quotes WHERE employee_id = ?", PAULA)));
        assertEquals(1, remote.posts(paulaOp));
        assertEquals(1, remote.effects(paulaOp));
        String paulaOffer = s.text("SELECT offer_id FROM buddy_offers WHERE employee_id = ?", PAULA);
        JsonNode offered = BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).get("value");
        assertEquals("pending", offered.get("state").asText());
        assertEquals("awaiting-decision", offered.get("reason").asText());
        assertEquals(quoteId, offered.get("quote").get("quoteId").asText());
        JsonNode activity = BuddyJourneySupport.value(get(paula, API + "/activity"), 200).get("value");
        assertEquals("offer", activity.get("state").asText());
        assertEquals(paulaOffer, activity.get("currentOffer").get("offerRef").get("offerId").asText());
        s.assertCustodyInvariants(maxActive);

        // Expiry: only Paula's hold is due. Its release is sent but the acknowledgement is lost.
        String expiresAt = s.text("SELECT expires_at::text FROM custody_holds WHERE hold_id = ?", paulaHold);
        assertNotNull(expiresAt);
        s.advance(presenter, 6400);
        remote.onExecute(Execute.APPLY_THEN_DROP);
        JsonNode t4 = s.tick(presenter, "remote-4");
        assertEquals("completed", t4.get("state").asText());
        assertEquals(1, BuddyJourneySupport.outcome(t4, "buddy-expiry").get("value").get("releases").asInt());
        assertEquals("release-pending", s.text("SELECT state FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals("release-pending", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        String releaseOp = s.text("SELECT operation_id FROM buddy_operations WHERE operation_type = 'buddy-release'");
        assertEquals("pending", s.text("SELECT state FROM pending_operations WHERE operation_id = ?", releaseOp));
        assertEquals(1, remote.effects(releaseOp));
        assertEquals(1, s.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", CAR_1));
        assertEquals("active", s.text("SELECT state FROM custody_holds WHERE employee_id = ?", CARLA));
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ?", BRUNO));
        JsonNode closing = BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).get("value");
        assertEquals("release-pending", closing.get("reason").asText());
        s.assertCustodyInvariants(maxActive);

        // The release is confirmed on the next tick: the hold closes, the offer expires, then Bruno may have car 1.
        s.advance(presenter, 60);
        JsonNode t5 = s.tick(presenter, "remote-5");
        assertEquals("completed", t5.get("state").asText());
        assertEquals("acknowledged", s.text("SELECT state FROM pending_operations WHERE operation_id = ?", releaseOp));
        assertEquals("expired", s.text("SELECT state FROM custody_holds WHERE hold_id = ?", paulaHold));
        assertEquals("expired", s.text("SELECT state FROM buddy_offers WHERE offer_id = ?", paulaOffer));
        assertEquals("released", s.text("SELECT state FROM stock_cars WHERE order_uuid = ?", CAR_1));
        assertEquals(1, s.count("SELECT count(*) FROM outbox_events WHERE event_type = 'buddy-expired' AND payload->>'holdId' = ?",
                paulaHold));
        assertEquals(1, remote.effects(releaseOp));
        assertEquals("expired", BuddyJourneySupport.value(get(paula, API + "/offers/" + paulaOffer), 200).get("value")
                .get("state").asText());
        assertEquals("offer-closed", BuddyJourneySupport.value(get(paula, API + "/activity"), 200).get("value")
                .get("state").asText());
        assertEquals(1, s.count("SELECT count(*) FROM allocation_runs WHERE trigger_type = 'buddy-expired'"));
        // Whoever holds car 1 now is exactly one other employee, and never the one who let it lapse.
        List<String> holders = s.column("SELECT employee_id FROM custody_holds WHERE order_uuid = ? "
                + "AND state IN ('active', 'claim-pending', 'release-pending', 'selection-pending', 'allocated')", CAR_1);
        assertEquals(List.of(BRUNO), holders);
        assertEquals(0, s.count("SELECT count(*) FROM custody_holds WHERE employee_id = ? AND state <> 'expired'", PAULA));
        assertEquals(2, s.count("SELECT count(*) FROM custody_holds WHERE order_uuid = ?", CAR_1));
        assertEquals(1, s.count("SELECT count(*) FROM buddy_offers WHERE employee_id = ? AND state = 'active'", BRUNO));
        assertEquals(1, BuddyJourneySupport.value(get(carla, API + "/offers/current"), 200).get("value").get("offers").size());
        s.assertCustodyInvariants(maxActive);
    }
}
