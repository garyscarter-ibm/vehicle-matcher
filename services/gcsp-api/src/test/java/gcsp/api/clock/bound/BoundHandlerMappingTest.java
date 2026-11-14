package gcsp.api.clock.bound;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.appointments.AppointmentResult;
import gcsp.api.approvals.ApprovalResult;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickKind;
import gcsp.api.clock.TickRequest;
import gcsp.api.persistence.RunContext;
import gcsp.api.returns.ReturnPlans;
import gcsp.api.documents.DocumentOutcome;
import gcsp.api.notify.DispatchResult;
import gcsp.api.supply.ReleaseResult;
import org.junit.jupiter.api.Test;

/** How each bound handler turns its service's answer into a handler outcome the tick runner understands. */
class BoundHandlerMappingTest {

    private static final JsonNodeFactory N = JsonNodeFactory.instance;

    private static ReleaseResult release(ReleaseResult.Status status, String code, boolean retryable, JsonNode value) {
        return new ReleaseResult(status, code, "reason", retryable, "t-1", false, value);
    }

    @Test
    void stockReleaseOkKeepsTheOutcomeAndMarksReplay() {
        ObjectNode value = N.objectNode().put("kind", "stock-released");
        HandlerOutcome out = StockReleaseHandler.map(new ReleaseResult(ReleaseResult.Status.OK, "ok", null, false,
                "t-1", true, value));
        ObjectNode kept = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class, out).value();
        assertEquals("stock-released", kept.get("kind").asText());
        assertEquals(true, kept.get("replayed").asBoolean());
        assertEquals(1, value.size(), "the service's own value is not changed");
    }

    @Test
    void stockReleaseStaleRunIsReportedAsStaleRun() {
        HandlerOutcome out = StockReleaseHandler.map(release(ReleaseResult.Status.CONFLICT, "stale-run", false, null));
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false), out);
    }

    @Test
    void stockReleaseOtherFailuresKeepStatusCodeAndRetryable() {
        assertEquals(new HandlerOutcome.Failed("unavailable", "supply-provider-not-configured", true),
                StockReleaseHandler.map(release(ReleaseResult.Status.UNAVAILABLE, "supply-provider-not-configured", true,
                        null)));
        assertEquals(new HandlerOutcome.Failed("conflict", "release-clock-changed", false),
                StockReleaseHandler.map(release(ReleaseResult.Status.CONFLICT, "release-clock-changed", false, null)));
        assertEquals(new HandlerOutcome.Failed("uncertain", "outcome-uncertain", false),
                StockReleaseHandler.map(release(ReleaseResult.Status.UNCERTAIN, "outcome-uncertain", false, null)));
    }

    @Test
    void documentsOkPassesTheSummaryAndAnythingElseFails() {
        ObjectNode summary = N.objectNode().put("opened", 2);
        assertEquals(new HandlerOutcome.Ok(summary), DocumentsTickHandler.map(DocumentOutcome.ok(summary)));
        assertEquals(new HandlerOutcome.Failed("unavailable", "documents-unavailable", true),
                DocumentsTickHandler.map(DocumentOutcome.unavailable("documents-unavailable", "x")));
        assertEquals(new HandlerOutcome.Failed("conflict", "stale-version", true),
                DocumentsTickHandler.map(DocumentOutcome.conflict("stale-version", "x", true)));
        assertEquals(new HandlerOutcome.Failed("invalid", "invalid-document-command", false),
                DocumentsTickHandler.map(DocumentOutcome.invalid("tickId", "x")));
    }

    @Test
    void outboxCountsAreOkAndTheOtherAnswersFail() {
        ObjectNode counts = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class,
                OutboxDispatchHandler.map(new DispatchResult.Counts(3, 2, 1))).value();
        assertEquals(3, counts.get("sent").asInt());
        assertEquals(2, counts.get("retrying").asInt());
        assertEquals(1, counts.get("failed").asInt());
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false),
                OutboxDispatchHandler.map(new DispatchResult.StaleRun()));
        assertEquals(new HandlerOutcome.Failed("unavailable", "notifications-unavailable", true),
                OutboxDispatchHandler.map(new DispatchResult.Unavailable()));
    }

    @Test
    void approvalsAnswersMapToOkPendingStaleRunOrFailed() {
        ObjectNode value = N.objectNode().put("orders", 2);
        assertEquals(new HandlerOutcome.Ok(value), ApprovalsTickHandler.map(new ApprovalResult.Ok(value, false)));
        assertEquals(new HandlerOutcome.Pending("t-1", "approval", "uncertain"),
                ApprovalsTickHandler.map(new ApprovalResult.Uncertain("t-1")));
        assertEquals(new HandlerOutcome.Failed("stale-run", "stale-run", false),
                ApprovalsTickHandler.map(new ApprovalResult.Conflict("stale-run", "x", false)));
        assertEquals(new HandlerOutcome.Failed("conflict", "tick-input-changed", false),
                ApprovalsTickHandler.map(new ApprovalResult.Conflict("tick-input-changed", "x", false)));
        assertEquals(new HandlerOutcome.Failed("unavailable", "approval-policy-unavailable", true),
                ApprovalsTickHandler.map(new ApprovalResult.Unavailable("approval-policy-unavailable", "x", true, true, null)));
    }

    @Test
    void appointmentsAnswersMapAndTheSystemPrincipalIsAPresenter() {
        ObjectNode value = N.objectNode().put("orders", 1);
        assertEquals(new HandlerOutcome.Ok(value), AppointmentsTickHandler.map(new AppointmentResult.Ok(value)));
        assertEquals(new HandlerOutcome.Pending("c-1", "appointment", "uncertain"),
                AppointmentsTickHandler.map(new AppointmentResult.Pending("c-1")));
        assertEquals(new HandlerOutcome.Failed("conflict", "clock-backwards", false),
                AppointmentsTickHandler.map(new AppointmentResult.Conflict("clock-backwards", "x")));
        assertEquals(new HandlerOutcome.Failed("unavailable", "appointments-unavailable", true),
                AppointmentsTickHandler.map(new AppointmentResult.Unavailable("appointments-unavailable", "x", true)));
        var who = AppointmentsTickHandler.system(request(TickKind.PRESENTER));
        assertEquals(java.util.List.of("presenter"), who.roles());
        assertEquals("system:clock", who.subject());
        assertEquals("run-1", who.runId());
    }

    @Test
    void returnOutcomesSummaryIsOkAndStartupTicksSkipEverySibling() {
        var summary = new ReturnPlans.Summary(3, 1, 1, 0, 0, 1, java.util.List.of(new ReturnPlans.Failure("o-1", "x")));
        ObjectNode out = (ObjectNode) assertInstanceOf(HandlerOutcome.Ok.class, ReturnOutcomesTickHandler.map(summary)).value();
        assertEquals(3, out.get("orders").asInt());
        assertEquals("o-1", out.get("failed").get(0).get("orderUuid").asText());
        HandlerOutcome skipped = StartupSkip.OUTCOME;
        assertEquals("startup-owned-by-service", ((ObjectNode) ((HandlerOutcome.Ok) skipped).value()).get("skipped").asText());
        assertEquals(true, request(TickKind.STARTUP).startup());
        assertEquals(false, request(TickKind.PRESENTER).startup());
    }

    private static TickRequest request(TickKind kind) {
        return new TickRequest(new RunContext("env", "run-1", "a"), "t-1", java.time.Instant.parse("2026-11-14T09:00:00Z"), 2,
                "p-1", "op-1", kind);
    }
}
