package gcsp.api.offers;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.ordering.OrderingProviderPort;
import gcsp.api.ordering.OrderingScope;
import gcsp.api.ordering.OrderingService;
import gcsp.api.ordering.OrderingTerms;
import gcsp.api.ordering.SyntheticOrderingProvider;
import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Actual persisted handoff outcomes, including a real synthetic execute whose acknowledgement was lost. */
class OfferBrowserDecisionPgTest {
    private DecisionEnv env;
    @BeforeEach void open() throws SQLException { env = DecisionEnv.open(true); }
    @AfterEach void close() throws SQLException { if (env != null) env.close(); }

    private void clock() throws SQLException {
        env.pg.update("INSERT INTO run_clocks (environment_id, run_id, clock_instant, clock_version, scenario_version, "
                + "fixture_version, starts_at, named_times) VALUES (?, 'run-1', ?, 1, 'browser-proof', 'browser-proof', ?, '{}'::jsonb)",
                OffersPg.ENV, java.sql.Timestamp.from(DecisionEnv.NOW), java.sql.Timestamp.from(DecisionEnv.NOW));
    }

    private ObjectNode command() throws SQLException {
        return env.accept("browser-accept", 1, 1, null).put("runId", "run-1").put("expectedQuoteVersion", 1);
    }

    private OfferOutcome decide(ObjectNode command) {
        return env.decisions.decideForEmployee(DecisionEnv.employee(DecisionEnv.EMPLOYEE), env.offerId, command);
    }

    @Test
    void aMissingDecisionClockRollsBackEveryDecisionAndCustodyWrite() throws Exception {
        OfferOutcome answer = decide(command());
        assertEquals(503, answer.http());
        assertEquals(0, env.written());
        assertEquals("active", env.text("SELECT state FROM custody_holds"));
    }

    @Test
    void lostAcknowledgementStaysPendingAndAnExplicitReconcileReadsTheActualOrder() throws Exception {
        clock();
        LostAcknowledgement provider = new LostAcknowledgement(new SyntheticOrderingProvider(env.source()));
        env.ordering = new OrderingService(env.source(), new OrderingTerms(DecisionEnv.policy(true), ctx -> env.now[0]), provider);
        ObjectNode command = command();
        OfferOutcome answer = decide(command);
        assertEquals(200, answer.http(), answer.code());
        JsonNode first = answer.value();
        assertEquals("accepted", first.path("state").asText());
        assertEquals("handoff-pending", first.at("/selection/operationState").asText());
        assertTrue(first.at("/selection/order").isNull());
        assertEquals(1, provider.executed);
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, env.count("SELECT count(*) FROM selection_orders"));
        assertEquals(first, decide(command).value());
        emit("pending", command, first);

        // Rebuild the service over the same database; only an explicit ordering reconciliation drives the provider.
        env.decisions = env.service(DecisionEnv.policy(true));
        String operation = first.path("operationId").asText();
        env.pg.update("UPDATE selection_orders SET handoff_lease_until = NULL");
        String slot = env.text("SELECT slot_id FROM custody_holds");
        env.ordering.reconcile(new OrderingScope(OffersPg.ENV, "run-1", DecisionEnv.EMPLOYEE, slot, DecisionEnv.POLICY), operation);
        JsonNode settled = decide(command).value();
        assertEquals("acknowledged", settled.at("/selection/operationState").asText());
        assertEquals("confirmed", settled.at("/selection/order/status").asText());
        assertEquals(first.path("serverNow"), settled.path("serverNow"));
        assertEquals(first.path("clockVersion"), settled.path("clockVersion"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(1, provider.executed);
        emit("reconciled", command, settled);
    }

    @Test
    void aDefinitiveOrderingRefusalKeepsTheRecordedSelectionAndShowsItsFailure() throws Exception {
        clock();
        env.ordering = new OrderingService(env.source(), new OrderingTerms(DecisionEnv.policy(true), ctx -> env.now[0]),
                new OrderingProviderPort() {
                    public String mode() { return "synthetic"; }
                    public String provider() { return "browser-refusal-proof"; }
                    public ProviderResponse reconcile(OrderingScope scope, ProviderRequest request) {
                        return ProviderResponse.of(Status.NOT_FOUND, scope, request, null);
                    }
                    public ProviderResponse execute(OrderingScope scope, ProviderRequest request) {
                        return ProviderResponse.of(Status.REJECTED, scope, request, "ordering-declined");
                    }
                });
        ObjectNode command = command();
        OfferOutcome answer = decide(command);
        assertEquals(200, answer.http(), answer.code());
        assertEquals("accepted", answer.value().path("state").asText());
        assertEquals("handoff-failed", answer.value().at("/selection/operationState").asText());
        assertEquals("ordering-declined", answer.value().at("/selection/failure/reason").asText());
        assertTrue(answer.value().at("/selection/order").isNull());
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(answer.value(), decide(command).value());
        emit("refused", command, answer.value());
    }

    @Test
    void retainedQuoteAndCurrentOrderingPolicyKeepATruthfulAcceptedReceipt() throws Exception {
        clock();
        JsonNode original = DecisionEnv.JSON.readTree(java.nio.file.Files.readString(
                java.nio.file.Path.of("../../server/gcsp/policy/seed-v1.json")));
        String currentVersion = DecisionEnv.POLICY + "+current-ordering";
        JsonNode current = DecisionEnv.JSON.readTree(original.toString().replace(DecisionEnv.POLICY, currentVersion));
        ((ObjectNode) current).put("effectiveFrom", "2026-11-13T00:00:00.000Z");
        var policy = new gcsp.api.policy.PolicyService(run -> java.util.List.of(original, current));
        env.decisions = env.service(policy);
        var principal = new gcsp.api.identity.Principal("sub-" + DecisionEnv.EMPLOYEE, java.util.List.of("employee"),
                OffersPg.ENV, "run-1", DecisionEnv.EMPLOYEE, currentVersion, java.util.List.of("account:read"));
        String slot = env.text("SELECT slot_id FROM custody_holds");
        var scope = new OrderingScope(OffersPg.ENV, "run-1", DecisionEnv.EMPLOYEE, slot, currentVersion);
        var terms = (OrderingTerms.TermsOk) new OrderingTerms(policy, ctx -> env.now[0]).terms(scope, env.now[0]);
        ObjectNode command = command().put("termsDigest", terms.value().path("termsDigest").asText());
        OfferOutcome answer = env.decisions.decideForEmployee(principal, env.offerId, command);
        assertEquals(200, answer.http(), "A committed retained quote decision must remain readable");
        assertEquals("accepted", answer.value().path("state").asText());
        assertEquals(DecisionEnv.POLICY, answer.value().path("policyVersion").asText());
        assertTrue(answer.value().path("selection").isNull(), "Never relabel current ordering terms as the quote's policy");
        assertEquals(currentVersion, env.text("SELECT policy_version FROM selection_orders"));
        assertEquals("allocated", env.text("SELECT state FROM custody_holds"));
        assertEquals(1, env.count("SELECT count(*) FROM offer_decisions"));
        assertEquals(answer.value(), env.decisions.decideForEmployee(principal, env.offerId, command).value());
        emit("retained-policy", command, answer.value());
    }

    private void emit(String label, ObjectNode command, JsonNode receipt) {
        ObjectNode row = DecisionEnv.JSON.createObjectNode().put("case", label).put("employeeId", DecisionEnv.EMPLOYEE);
        row.set("input", command.deepCopy().put("offerId", env.offerId));
        row.set("receipt", receipt);
        System.out.println("F466_CASE " + row);
    }

    private static final class LostAcknowledgement implements OrderingProviderPort {
        private final OrderingProviderPort inner;
        private boolean unreachable;
        int executed;
        LostAcknowledgement(OrderingProviderPort inner) { this.inner = inner; }
        public String mode() { return inner.mode(); }
        public String provider() { return inner.provider(); }
        public ProviderResponse reconcile(OrderingScope scope, ProviderRequest request) {
            if (unreachable) throw new IllegalStateException("provider temporarily unreachable");
            return inner.reconcile(scope, request);
        }
        public ProviderResponse execute(OrderingScope scope, ProviderRequest request) {
            inner.execute(scope, request); executed++; unreachable = true;
            throw new IllegalStateException("acknowledgement lost after the actual execute");
        }
    }
}
