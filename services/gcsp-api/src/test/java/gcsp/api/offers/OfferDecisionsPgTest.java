package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.sql.SQLException;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Local offer decline end to end over a real Postgres schema: the locked recheck, replay and the allocator event. */
class OfferDecisionsPgTest {

    private DecisionEnv env;

    @BeforeEach
    void open() throws SQLException {
        env = DecisionEnv.open(true);
    }

    @AfterEach
    void close() throws SQLException {
        if (env != null) env.close();
    }

    @Test
    void declineReleasesTheHoldBumpsTheCarAndEmitsTheAllocatorEvent() throws Exception {
        long carBefore = env.count("SELECT version FROM stock_cars");
        OfferOutcome o = env.decideOk();
        assertEquals(200, o.http(), o.code());
        JsonNode v = o.value();
        assertEquals("declined", v.get("state").textValue());
        assertEquals(2, v.get("offerVersion").asLong());
        assertEquals(2, v.get("holdVersion").asLong());
        assertEquals("waiting-for-next-offer", v.at("/followUp/state").textValue());
        assertEquals(0, v.get("availableActions").size());
        assertNull(v.get("replayed"));

        assertEquals("declined", env.text("SELECT state FROM buddy_offers"));
        assertEquals("released", env.text("SELECT state FROM custody_holds"));
        assertEquals("offer-declined", env.text("SELECT attributes->>'releaseReason' FROM custody_holds"));
        assertNotNull(env.text("SELECT attributes->>'releasedAt' FROM custody_holds"));
        assertEquals("released", env.text("SELECT state FROM stock_cars"));
        assertEquals(carBefore + 1, env.count("SELECT version FROM stock_cars"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'decline' AND reason_code = 'size'"));
        assertEquals("Size", env.text("SELECT reason->>'label' FROM offer_decisions"));
        assertEquals(1, env.count("SELECT count(*) FROM command_receipts WHERE command_type = 'offer.decide'"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-declined' "
                + "AND payload->>'holdId' IS NOT NULL AND payload->>'orderUuid' IS NOT NULL "
                + "AND payload->>'reasonCode' = 'size' AND payload->>'offerId' IS NOT NULL"));
    }

    @Test
    void theSameCommandReplaysTheStoredOutcomeAndWritesNothing() throws Exception {
        OfferOutcome first = env.decideOk();
        long written = env.written();
        long carVersion = env.count("SELECT version FROM stock_cars");
        OfferOutcome again = env.decideOk();
        assertEquals(200, again.http());
        assertTrue(again.value().get("replayed").booleanValue());
        assertEquals(first.value().get("decisionId"), again.value().get("decisionId"));
        assertEquals(written, env.written());
        assertEquals(carVersion, env.count("SELECT version FROM stock_cars"));
    }

    @Test
    void theSameCommandWithAChangedReasonIsRefused() throws Exception {
        env.decideOk();
        OfferOutcome o = env.decide(DecisionEnv.decline("cmd-1", "fuel", 1, 1));
        assertEquals(409, o.http());
        assertEquals("command-input-changed", o.code());
    }

    @Test
    void aSecondCommandAfterTheDeclineFindsNoPendingOffer() throws Exception {
        env.decideOk();
        OfferOutcome o = env.decide(DecisionEnv.decline("cmd-2", "size", 1, 1));
        assertEquals(409, o.http());
        assertEquals("offer-no-longer-pending", o.code());
        assertEquals("declined", o.current().get("state").textValue());
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
    }

    @Test
    void staleVersionsChangeNothing() throws Exception {
        for (ObjectNode body : new ObjectNode[] {DecisionEnv.decline("c1", "size", 2, 1), DecisionEnv.decline("c2", "size", 1, 2)}) {
            OfferOutcome o = env.decide(body);
            assertEquals(409, o.http());
            assertEquals("stale-version", o.code());
            assertEquals(1, o.current().get("offerVersion").asLong());
        }
        assertEquals("active", env.text("SELECT state FROM buddy_offers"));
        assertEquals(0, env.written());
    }

    @Test
    void theDeadlineIsInclusive() throws Exception {
        env.now[0] = DecisionEnv.NOW.plusSeconds(3600);
        OfferOutcome o = env.decideOk();
        assertEquals(409, o.http());
        assertEquals("deadline-passed", o.code());
        assertEquals("active", env.text("SELECT state FROM custody_holds"));
        assertEquals(0, env.written());
    }

    @Test
    void anotherEmployeeIsRefusedWithoutFacts() throws Exception {
        OfferOutcome o = env.decisions.decide(DecisionEnv.employee("E-1002"), env.offerId,
                DecisionEnv.decline("cmd-1", "size", 1, 1));
        assertEquals(403, o.http());
        assertEquals("offer-not-owned", o.code());
        assertEquals(0, env.written());
    }

    @Test
    void aRemoteHoldIsRefusedByTheLockedRecheck() throws Exception {
        env.pg.update("INSERT INTO pending_operations (environment_id, run_id, operation_id, operation_type, "
                + "idempotency_key, input_digest, state) VALUES (?, 'run-1', 'op-1', 'buddy-claim', 'k-1', ?, 'acknowledged')",
                OffersPg.ENV, "a".repeat(64));
        env.pg.update("INSERT INTO buddy_operations (environment_id, run_id, operation_id, operation_type, hold_id, payload) "
                + "SELECT environment_id, run_id, 'op-1', 'buddy-claim', hold_id, '{}'::jsonb FROM custody_holds");
        OfferOutcome o = env.decideOk();
        assertEquals(503, o.http());
        assertEquals("remote-decision-protocol-required", o.code());
        assertEquals(0, env.written());
    }

    @Test
    void aRemoteBuddyModeIsRefusedUpFront() throws Exception {
        env.mode = "remote";
        OfferOutcome o = env.decideOk();
        assertEquals(503, o.http());
        assertEquals("remote-decision-protocol-required", o.code());
    }

    @Test
    void anotherOccupantOfTheCarMeansTheSelectionChanged() throws Exception {
        env.pg.update("UPDATE stock_cars SET state = 'allocated'");
        OfferOutcome o = env.decideOk();
        assertEquals(409, o.http());
        assertEquals("selection-authority-changed", o.code());
        assertEquals(0, env.written());
    }

    @Test
    void aMissingReasonRegistryRefusesBeforeWriting() throws Exception {
        env.decisions = env.service(DecisionEnv.policy(false));
        OfferOutcome o = env.decideOk();
        assertEquals(503, o.http());
        assertEquals("decline-reasons-unavailable", o.code());
        assertEquals(0, env.written());
        assertEquals(503, env.decisions.reasons(env.owner(), env.offerId).http());
    }

    @Test
    void anUnknownReasonCodeIsInvalid() throws Exception {
        OfferOutcome o = env.decide(DecisionEnv.decline("cmd-1", "colour", 1, 1));
        assertEquals(400, o.http());
        assertEquals("invalid-offer-decision", o.code());
        assertEquals(0, env.written());
    }

    @Test
    void aRetiredRunIsRefusedAndNothingIsWritten() throws Exception {
        env.pg.rollRun("run-1", "run-2");
        OfferOutcome o = env.decideOk();
        assertEquals(409, o.http());
        assertEquals("stale-run", o.status());
        assertEquals(0, env.written());
    }

    @Test
    void theRunnerRefusesARunRetiredAfterTheAccessRead() throws Exception {
        OfferRecords stub = new OfferRecords() {
            public Lookup find(gcsp.api.persistence.RunContext ctx, String id) {
                return new Found(OfferFixtures.record(id, DecisionEnv.EMPLOYEE, "active", "active"));
            }

            public Listing listForEmployee(gcsp.api.persistence.RunContext ctx, String employeeId) {
                return new Unavailable();
            }
        };
        OfferAccess access = new OfferAccess(stub, ctx -> OfferFixtures.NOW);
        OfferDecisions late = new OfferDecisions(() -> true, env::source, access, DecisionEnv.policy(true),
                ctx -> OfferFixtures.NOW, () -> new gcsp.api.allocation.LocalSyntheticBuddy());
        env.pg.rollRun("run-1", "run-2");
        OfferOutcome o = late.decide(DecisionEnv.employee(DecisionEnv.EMPLOYEE), env.offerId,
                DecisionEnv.decline("cmd-1", "size", 7, 3));
        assertEquals(409, o.http());
        assertEquals("stale-run", o.status());
        assertEquals(0, env.written());
    }

    @Test
    void reasonsAreOwnerGatedAndListTheRegistry() throws Exception {
        OfferOutcome o = env.decisions.reasons(env.owner(), env.offerId);
        assertEquals(200, o.http());
        assertEquals(4, o.value().get("reasons").size());
        assertEquals(DecisionEnv.POLICY, o.value().get("policyVersion").textValue());
        assertEquals(403, env.decisions.reasons(DecisionEnv.employee("E-1002"), env.offerId).http());
    }

    @Test
    void followUpWaitsThenShowsTheNextOffer() throws Exception {
        assertEquals("offer-follow-up-not-found", env.decisions.followUp(env.owner(), env.offerId).code());
        env.decideOk();
        OfferOutcome waiting = env.decisions.followUp(env.owner(), env.offerId);
        assertEquals(200, waiting.http());
        assertEquals("waiting-for-next-offer", waiting.value().get("state").textValue());
        assertTrue(waiting.value().get("nextOfferId").isNull());
        assertEquals("unavailable", waiting.value().get("briefChange").textValue());

        String next = env.pg.seed("run-1", DecisionEnv.EMPLOYEE, "active", "active", Instant.now().plusSeconds(7200),
                Instant.now().plusSeconds(60));
        OfferOutcome after = env.decisions.followUp(env.owner(), env.offerId);
        assertEquals("next-offer", after.value().get("state").textValue());
        assertEquals(next, after.value().get("nextOfferId").textValue());
        assertEquals(403, env.decisions.followUp(DecisionEnv.employee("E-1002"), env.offerId).http());
    }

    @Test
    void theDecisionRowIsImmutable() throws Exception {
        env.decideOk();
        SQLException e = assertThrows(SQLException.class,
                () -> env.pg.update("UPDATE offer_decisions SET reason_code = 'fuel'"));
        assertEquals("23", e.getSQLState().substring(0, 2));
    }
}
