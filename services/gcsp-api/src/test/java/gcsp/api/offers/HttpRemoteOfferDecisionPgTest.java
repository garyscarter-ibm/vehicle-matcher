package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.allocation.ReconcileResult;
import gcsp.api.allocation.RemoteBuddy;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickKind;
import gcsp.api.clock.TickRequest;
import gcsp.api.clock.bound.OfferDecisionTickHandler;
import gcsp.api.persistence.RunContext;
import gcsp.api.remote.RemoteOperationServer;
import gcsp.api.remote.RemoteOperationServer.Execute;
import gcsp.api.remote.RemoteOperationServer.Reconcile;
import java.sql.SQLException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Component evidence: a seeded remote-offered offer and a direct service Principal over real loopback HTTP and PostgreSQL.
 * It is not browser sign-in, remote claim-to-offer production, OIDC, email or the whole journey.
 */
class HttpRemoteOfferDecisionPgTest {

    private static final String POST = "POST:offer-selection";
    private static final String GET = "GET:reconcile";
    private static final String TYPE = "operation_type = 'offer-selection'";

    private RemoteOperationServer remote;
    private DecisionEnv env;

    @BeforeEach
    void open() throws Exception {
        remote = RemoteOperationServer.start();
        env = DecisionEnv.open(true);
        env.makeRemoteOffered(remote.buddy());
    }

    @AfterEach
    void close() throws Exception {
        try {
            if (env != null) env.close();
        } finally {
            if (remote != null) remote.close();
        }
    }

    private String op(String column) throws SQLException {
        return env.text("SELECT " + column + " FROM pending_operations WHERE " + TYPE);
    }

    private OfferOutcome accept() throws SQLException {
        return env.decide(env.accept("cmd-1", 1, 1, null));
    }

    private void assertPending(String lastKnown) throws SQLException {
        assertEquals("selection-pending", env.text("SELECT state FROM custody_holds"));
        assertEquals("decision-pending", env.text("SELECT state FROM buddy_offers"));
        assertEquals("released", env.text("SELECT state FROM stock_cars"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted'"));
        assertEquals("pending", op("state"));
        assertEquals(lastKnown, op("outcome->>'lastKnownState'"));
    }

    private void assertAccepted() throws SQLException {
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals("accepted", env.text("SELECT state FROM buddy_offers"));
        assertEquals("allocated", env.text("SELECT state FROM stock_cars"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions WHERE decision = 'accept' AND command_id = 'cmd-1'"));
        assertEquals(1, env.count("SELECT count(*) FROM outbox_events WHERE event_type = 'offer-accepted' "
                + "AND event_id = 'offer-accepted:' || (SELECT hold_id FROM custody_holds)"));
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals("acknowledged", op("state"));
        assertEquals(3, env.count("SELECT version FROM stock_cars"));
        assertEquals(3, env.count("SELECT version FROM custody_holds"));
        assertEquals(3, env.count("SELECT version FROM buddy_offers"));
    }

    private void assertRestored() throws SQLException {
        assertEquals("active", env.text("SELECT state FROM custody_holds"));
        assertEquals("claim-1", env.text("SELECT operation_id FROM custody_holds"));
        assertEquals("active", env.text("SELECT state FROM buddy_offers"));
        assertEquals("refused", op("state"));
        assertEquals("selection-refused", op("outcome->>'state'"));
        assertEquals(0, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(0, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(DecisionEnv.NOW.plusSeconds(3600).toEpochMilli(),
                env.count("SELECT (extract(epoch FROM expires_at) * 1000)::bigint FROM custody_holds"));
        assertEquals(3, env.count("SELECT version FROM custody_holds"));
    }

    private HandlerOutcome startup(OfferDecisions service, RemoteBuddy buddy) {
        OfferDecisionTickHandler handler = new OfferDecisionTickHandler(() -> true, () -> buddy, () -> service);
        return handler.handle(new TickRequest(new RunContext(OffersPg.ENV, "run-1", "system:clock"), "tick-1",
                DecisionEnv.NOW, 1, DecisionEnv.POLICY, "op-1", TickKind.STARTUP));
    }

    @Test
    void anAppliedSelectionOverHttpConvertsTheAcceptOnce() throws Exception {
        remote.onExecute(Execute.APPLY);
        OfferOutcome o = accept();
        assertEquals(202, o.http(), o.code());
        assertEquals("pending", o.status());
        JsonNode v = o.value();
        assertEquals("accept", v.get("decision").textValue());
        assertEquals("pending", v.get("state").textValue());
        assertEquals("decision-pending", v.get("reason").textValue());
        assertTrue(v.get("reconciliationRequired").booleanValue());
        String opId = op("operation_id");
        assertEquals(opId, v.get("operationId").textValue());
        assertAccepted();
        assertEquals(List.of(POST), remote.calls());
        assertEquals(1, remote.posts(opId));
        assertEquals(1, remote.effects(opId));
        RemoteOperationServer.Request sent = remote.requests().get(0);
        assertEquals("run-1", sent.runId());
        assertEquals(env.text("SELECT order_uuid FROM custody_holds"), sent.orderUuid());
    }

    @Test
    void aLostAnswerIsConvertedAfterARestartByReconcileWithoutASecondEffect() throws Exception {
        remote.onExecute(Execute.APPLY_THEN_DROP);
        assertEquals(202, accept().http());
        assertPending("unknown");
        String opId = op("operation_id");
        assertEquals(1, remote.effects(opId));

        RemoteBuddy buddy = remote.buddy();
        OfferDecisions restarted = env.service(DecisionEnv.policy(true));
        JsonNode counts = assertInstanceOf(HandlerOutcome.Ok.class, startup(restarted, buddy)).value();
        assertEquals(1, counts.get("driven").asInt());
        assertEquals(1, counts.get("settled").asInt());
        assertAccepted();
        assertEquals(List.of(POST, GET), remote.calls());
        assertEquals(1, remote.posts(opId));
        assertEquals(1, remote.effects(opId));
        assertEquals(0, restarted.reconcileRemote(OffersPg.ENV, "run-1", 100).driven());
        assertEquals(List.of(POST, GET), remote.calls());
    }

    @Test
    void aRejectedSelectionOverHttpRestoresTheActiveOffer() throws Exception {
        remote.onExecute(Execute.REJECT);
        assertEquals(202, accept().http());
        assertRestored();
        assertEquals(List.of(POST), remote.calls());
        assertEquals(0, remote.effects(op("operation_id")));
        assertEquals(0, remote.totalEffects());
    }

    @Test
    void anUnconfirmedExecuteAndFailedLookupsLeaveItPendingWithoutAnotherPost() throws Exception {
        remote.onExecute(Execute.MISMATCH).onReconcile(Reconcile.MISMATCH, Reconcile.FAIL_500);
        assertEquals(202, accept().http());
        assertPending("unknown");
        String opId = op("operation_id");
        assertEquals(List.of(POST), remote.calls());

        ReconcileResult mismatched = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
        assertEquals(1, mismatched.pending());
        assertPending("unknown");
        ReconcileResult failed = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
        assertEquals(1, failed.pending());
        assertPending("unknown");

        assertEquals(List.of(POST, GET, GET), remote.calls());
        assertEquals(1, remote.posts(opId));
        assertEquals(0, remote.effects(opId));
        assertEquals(0, remote.totalEffects());
    }

    @Test
    void aLostRequestIsFoundAbsentByLookupThenExecutedOnceMore() throws Exception {
        remote.onExecute(Execute.DROP);
        assertEquals(202, accept().http());
        assertPending("unknown");
        String opId = op("operation_id");
        assertEquals(0, remote.effects(opId));

        ReconcileResult r = env.decisions.reconcileRemote(OffersPg.ENV, "run-1", 100);
        assertEquals(1, r.settled());
        assertAccepted();
        assertEquals(List.of(POST, GET, POST), remote.calls());
        assertEquals(2, remote.posts(opId));
        assertEquals(1, remote.effects(opId));
    }
}
