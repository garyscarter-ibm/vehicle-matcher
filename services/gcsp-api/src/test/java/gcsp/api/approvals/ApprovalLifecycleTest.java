package gcsp.api.approvals;

import static gcsp.api.approvals.ApprovalFixture.FULL;
import static gcsp.api.approvals.ApprovalFixture.SHORT;
import static gcsp.api.approvals.ApprovalFixture.order;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.approvals.ApprovalStatusProvider.Request;
import gcsp.api.approvals.ApprovalStatusProvider.Response;
import gcsp.api.approvals.ApprovalStatusProvider.Status;
import gcsp.api.persistence.RunContext;
import java.sql.SQLException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Stage order, tick progression, decline, live stub, uncertain writes and truthful acknowledgement checks. */
class ApprovalLifecycleTest {

    @Test
    void stageOrderFollowsTheCanonicalListAndThePinnedSnapshotGoverns() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.orders.ready(order("o-hr", "paula", FULL));
            JsonNode view = f.view("o-hr");
            assertEquals(List.of("selection received", "HR approval", "sales-manager approval", "sent to ordering"),
                    texts(view.get("stageList")));
            assertEquals(List.of("selection received:approved", "HR approval:not-started",
                    "sales-manager approval:not-started", "sent to ordering:not-started"), ApprovalFixture.states(view));
            assertEquals(0, view.get("lifecycleRevision").asInt());
            assertEquals("validated", view.get("renewalAuthority").asText());
            assertEquals("lifecycle.stages.v1", view.get("contractVersion").asText());
            assertEquals(0, f.count("SELECT count(*) FROM approval_orders"), "revision 0 writes nothing");

            // The seed lists HR approval; an order pinned to the shorter list drops it everywhere.
            f.orders.ready(order("o-short", "alex", SHORT));
            JsonNode shortView = f.view("o-short");
            assertEquals(List.of("selection received", "sales-manager approval", "sent to ordering"),
                    texts(shortView.get("stageList")));
            JsonNode listed = ApprovalFixture.value(f.service.list(f.ctx(), f.greg.greg, null, 10));
            assertEquals(texts(shortView.get("stageList")), texts(listed.get("orders").get(1).get("stageList")));
            JsonNode done = f.untilDone("o-short", 12);
            assertEquals("sent-to-ordering", done.get("outcome").asText());
            assertFalse(texts(done.get("stageList")).contains("HR approval"));
        }
    }

    @Test
    void ticksAdvanceEachStageKeepsItsReferenceAndReplayingATickChangesNothing() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.orders.ready(order("o-1", "paula", FULL));
            ApprovalService.TickInput first = f.nextTick();
            ApprovalResult r = f.service.tick(f.ctx(), first);
            assertInstanceOf(ApprovalResult.Ok.class, r);
            JsonNode v = f.view("o-1");
            assertEquals("HR approval", v.get("currentStage").asText());
            assertEquals("HR", v.get("owner").asText());
            assertEquals("HR decision", v.get("nextStep").asText());
            assertEquals("pending", v.get("stages").get(1).get("state").asText());
            assertEquals(1, v.get("lifecycleRevision").asInt());
            assertEquals(first.now().toString().substring(0, 19), v.get("asOf").asText().substring(0, 19));

            long revision = f.revision();
            List<Long> snapshot = f.snapshot();
            ApprovalResult replay = f.service.tick(f.ctx(), first);
            assertTrue(((ApprovalResult.Ok) replay).replayed());
            assertEquals(snapshot, f.snapshot());
            assertEquals(revision, f.revision());

            f.ticks(1);
            assertEquals("pending", f.view("o-1").get("stages").get(1).get("state").asText(), "HR waits its two ticks");
            f.ticks(1);
            v = f.view("o-1");
            assertEquals("approved", v.get("stages").get(1).get("state").asText());
            assertTrue(v.get("stages").get(1).get("providerReference").asText().startsWith("synthetic-ordering-status:v1:"));
            assertEquals("sales-manager approval", v.get("currentStage").asText());
            assertEquals("sales manager", v.get("owner").asText());

            JsonNode done = f.untilDone("o-1", 12);
            assertEquals("sent-to-ordering", done.get("outcome").asText());
            assertEquals("ordering", done.get("owner").asText());
            Set<String> references = new HashSet<>();
            for (JsonNode s : done.get("stages")) {
                assertEquals("approved", s.get("state").asText());
                assertFalse(s.get("providerReference").isNull());
                references.add(s.get("providerReference").asText());
            }
            assertEquals(4, references.size(), "each stage has its own distinct reference");
            assertEquals(4, f.count("SELECT count(*) FROM approval_revisions"));
            int finalRevision = done.get("lifecycleRevision").asInt();
            f.ticks(1);
            assertEquals(finalRevision, f.view("o-1").get("lifecycleRevision").asInt(), "further ticks are no-ops");
            assertEquals(1, f.count("SELECT count(*) FROM approval_decisions WHERE order_uuid = 'o-1' AND stage = 'HR approval'"));
        }
    }

    @Test
    void declineScenarioDeclinesTheNamedStageAndEmitsOneEvent() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.policy.edit("lifecycle.approval.declineScenario.v1", e -> ((com.fasterxml.jackson.databind.node.ObjectNode) e.get("value"))
                    .put("enabled", true));
            f.orders.ready(order("o-d", "paula", FULL));
            JsonNode done = f.untilDone("o-d", 12);
            assertEquals("declined", done.get("outcome").asText());
            assertEquals("scheme team", done.get("owner").asText());
            assertEquals(List.of("selection received:approved", "HR approval:approved", "sales-manager approval:declined",
                    "sent to ordering:not-started"), ApprovalFixture.states(done));
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'approval-declined'"));
            JsonNode payload = ApprovalStoreRead.json(f.text("SELECT payload::text FROM outbox_events WHERE event_type = 'approval-declined'"));
            assertEquals("paula", payload.get("employeeId").asText());
            assertEquals("renewal-paula", payload.get("renewalId").asText());
            assertEquals("o-d", payload.get("orderUuid").asText());
            assertEquals("sales-manager-declined", payload.get("reasonCode").asText());
            assertEquals(done.get("stages").get(2).get("at").asText(), payload.get("occurredAt").asText());
            assertTrue(payload.get("fictional").asBoolean());
            f.ticks(2);
            assertEquals(1, f.count("SELECT count(*) FROM outbox_events WHERE event_type = 'approval-declined'"));
        }
    }

    @Test
    void liveStubLeavesTheStagePendingAndBlockedWithoutChangingTheRevision() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.use(new LiveApprovalStatusStub());
            f.orders.ready(order("o-l", "paula", FULL));
            f.ticks(5);
            JsonNode v = f.view("o-l");
            assertEquals("HR approval", v.get("currentStage").asText());
            assertEquals("pending", v.get("stages").get(1).get("state").asText());
            assertEquals("live-ordering-unsupported", v.get("blocked").get("code").asText());
            assertFalse(v.get("provider").get("synthetic").asBoolean());
            assertEquals("live", v.get("provider").get("mode").asText());
            int before = v.get("lifecycleRevision").asInt();
            f.ticks(1);
            assertEquals(before, f.view("o-l").get("lifecycleRevision").asInt());
            assertEquals("unsupported", f.text("SELECT phase FROM approval_decisions WHERE order_uuid = 'o-l'"));
        }
    }

    @Test
    void anUncertainWriteIsReconciledNotRequestedAgainAndApproves() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            Flaky flaky = new Flaky(new SyntheticApprovalStatus(f.pool()));
            f.use(flaky);
            f.orders.ready(order("o-u", "paula", FULL));
            f.ticks(3);
            JsonNode v = f.view("o-u");
            assertEquals("pending", v.get("stages").get(1).get("state").asText());
            assertEquals("provider-uncertain", v.get("blocked").get("code").asText());
            assertEquals("uncertain", f.text("SELECT phase FROM approval_decisions WHERE order_uuid = 'o-u'"));
            f.ticks(1);
            v = f.view("o-u");
            assertEquals("approved", v.get("stages").get(1).get("state").asText());
            assertTrue(v.get("blocked").isNull());
            assertEquals(List.of("request", "reconcile"), flaky.calls, "reconciled, not re-requested");
            assertEquals(1, f.count("SELECT count(*) FROM approval_synthetic_decisions"));
        }
    }

    @Test
    void aMismatchedOrMalformedAcknowledgementNeverApproves() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            for (String fault : List.of("stage", "state", "operation", "order", "reference", "blank", "status")) {
                String id = "o-m-" + fault;
                f.orders.byId.clear();
                f.use(new Mismatched(new SyntheticApprovalStatus(f.pool()), fault));
                f.orders.ready(order(id, "paula", FULL));
                f.ticks(8);
                JsonNode v = f.view(id);
                assertEquals("HR approval", v.get("currentStage").asText(), fault);
                assertEquals("pending", v.get("stages").get(1).get("state").asText(), fault);
                assertEquals("in-progress", v.get("outcome").asText(), fault);
                assertNull(f.text("SELECT provider_reference FROM approval_decisions WHERE order_uuid = ?", id), fault);
            }
        }
    }

    @Test
    void noProviderAndMissingElapsedConfirmationNeverApproveByTimeAlone() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.use(new UnconfiguredApprovalStatus());
            f.orders.ready(order("o-n", "paula", FULL));
            f.ticks(30);
            JsonNode v = f.view("o-n");
            assertEquals("pending", v.get("stages").get(1).get("state").asText());
            assertEquals("provider-uncertain", v.get("blocked").get("code").asText());
            assertEquals("none", v.get("provider").get("mode").asText());
        }
    }

    @Test
    void restartContinuesFromDurableStateAndStartupReconcileNeverCountsOrStarts() throws Exception {
        try (ApprovalFixture f = ApprovalFixture.create()) {
            f.use(new Flaky(new SyntheticApprovalStatus(f.pool())));
            f.orders.ready(order("o-r", "paula", FULL));
            f.ticks(3);
            assertEquals("uncertain", f.text("SELECT phase FROM approval_decisions WHERE order_uuid = 'o-r'"));
            f.orders.ready(order("o-new", "alex", FULL));
            long ticks = f.count("SELECT count(*) FROM approval_ticks");
            long elapsed = f.count("SELECT sum(ticks_elapsed) FROM approval_decisions");

            ApprovalService restarted = f.newService(f.pool(), new SyntheticApprovalStatus(f.pool()));
            ApprovalResult r = restarted.reconcile(f.ctx(), 10);
            JsonNode out = ApprovalFixture.value(r);
            assertEquals(1, out.get("settled").asInt());
            assertEquals("approved", ApprovalFixture.value(restarted.read(f.ctx(), f.greg.greg, "o-r")).get("stages").get(1).get("state").asText());
            assertEquals(ticks, f.count("SELECT count(*) FROM approval_ticks"), "no tick recorded");
            assertEquals(elapsed, f.count("SELECT sum(ticks_elapsed) FROM approval_decisions"), "no tick counted");
            assertEquals(0, f.count("SELECT count(*) FROM approval_orders WHERE order_uuid = 'o-new'"), "no order started");

            // A later tick through the restarted service carries on from the stored state.
            f.service = restarted;
            f.ticks(1);
            assertEquals("sales-manager approval", f.view("o-r").get("currentStage").asText());
            assertEquals(1, f.count("SELECT count(*) FROM approval_orders WHERE order_uuid = 'o-new'"));
        }
    }

    private static List<String> texts(JsonNode array) {
        return java.util.stream.StreamSupport.stream(array.spliterator(), false).map(JsonNode::asText).toList();
    }

    /** The first request is stored by the provider and then throws; later calls pass through. */
    static final class Flaky implements ApprovalStatusProvider {
        private final ApprovalStatusProvider inner;
        final List<String> calls = new java.util.ArrayList<>();
        private boolean fail = true;

        Flaky(ApprovalStatusProvider inner) {
            this.inner = inner;
        }

        public String mode() {
            return inner.mode();
        }

        public String provider() {
            return inner.provider();
        }

        public Response requestDecision(RunContext ctx, Request r) {
            calls.add("request");
            Response response = inner.requestDecision(ctx, r);
            if (fail) {
                fail = false;
                throw new IllegalStateException("timeout after the provider stored the decision");
            }
            return response;
        }

        public Response reconcile(RunContext ctx, Request r) {
            calls.add("reconcile");
            return inner.reconcile(ctx, r);
        }
    }

    /** Acknowledges with one deliberate defect so the service must refuse to treat it as the intended decision. */
    static final class Mismatched implements ApprovalStatusProvider {
        private final ApprovalStatusProvider inner;
        private final String fault;

        Mismatched(ApprovalStatusProvider inner, String fault) {
            this.inner = inner;
            this.fault = fault;
        }

        public String mode() {
            return inner.mode();
        }

        public String provider() {
            return inner.provider();
        }

        public Response requestDecision(RunContext ctx, Request r) {
            return bend(inner.requestDecision(ctx, r));
        }

        public Response reconcile(RunContext ctx, Request r) {
            return bend(inner.reconcile(ctx, r));
        }

        private Response bend(Response r) {
            if (r.status() != Status.CONFIRMED) return r;
            return switch (fault) {
                case "stage" -> new Response(r.status(), r.operationId(), r.orderUuid(), "sent to ordering", r.state(),
                        r.providerReference(), r.decidedAt(), null, null, true);
                case "state" -> new Response(r.status(), r.operationId(), r.orderUuid(), r.stage(), "declined",
                        r.providerReference(), r.decidedAt(), null, null, true);
                case "operation" -> new Response(r.status(), "approval:other", r.orderUuid(), r.stage(), r.state(),
                        r.providerReference(), r.decidedAt(), null, null, true);
                case "order" -> new Response(r.status(), r.operationId(), "another-order", r.stage(), r.state(),
                        r.providerReference(), r.decidedAt(), null, null, true);
                case "reference" -> new Response(r.status(), r.operationId(), r.orderUuid(), r.stage(), r.state(), null,
                        r.decidedAt(), null, null, true);
                case "blank" -> new Response(r.status(), r.operationId(), r.orderUuid(), r.stage(), r.state(), " ",
                        r.decidedAt(), null, null, true);
                default -> new Response(Status.UNKNOWN, r.operationId(), r.orderUuid(), r.stage(), r.state(),
                        r.providerReference(), r.decidedAt(), null, null, true);
            };
        }
    }

    /** Tiny helper so tests read stored JSON without importing the service's own store. */
    static final class ApprovalStoreRead {
        static JsonNode json(String text) throws SQLException {
            return ApprovalStore.json(text);
        }
    }
}
