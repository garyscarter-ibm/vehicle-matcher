package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalResult;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The pure mappings of the real stage, readiness and handover adapters. */
class PortMappingTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void approvalAnswersMapToStageReads() {
        ObjectNode value = JSON.createObjectNode().put("orderUuid", "o-1");
        assertEquals(value, ((StageRead.Ok) ApprovalsOrderStage.map(new ApprovalResult.Ok(value, false))).value());
        assertInstanceOf(StageRead.NotFound.class, ApprovalsOrderStage.map(new ApprovalResult.NotFound("x")));
        assertInstanceOf(StageRead.Forbidden.class, ApprovalsOrderStage.map(new ApprovalResult.Forbidden("c", "x")));
        StageRead.Unavailable u = (StageRead.Unavailable) ApprovalsOrderStage.map(
                new ApprovalResult.Unavailable("selection-pending", "x", true, false, "not-ready"));
        assertEquals("unavailable", u.status());
        assertEquals("selection-pending", u.code());
        assertEquals("invalid", ((StageRead.Unavailable) ApprovalsOrderStage.map(new ApprovalResult.Invalid("bad", "x"))).status());
        assertEquals("conflict", ((StageRead.Unavailable) ApprovalsOrderStage.map(new ApprovalResult.Conflict("c", "x", false))).status());
    }

    @Test
    void documentsReadinessMapsAndAnUnopenedOrderIsNotReady() {
        ObjectNode n = JSON.createObjectNode().put("ready", true).put("state", "ready").put("documentsComplete", true)
                .put("vehicleReady", true).put("documentsRevision", 7L);
        n.putArray("blocking").add("signed-order-form");
        HandoverReadiness.Ok ok = (HandoverReadiness.Ok) DocumentsHandoverReadiness.map(Optional.of(n));
        assertTrue(ok.ready());
        assertEquals("ready", ok.state());
        assertEquals(List.of("signed-order-form"), ok.blocking());
        assertEquals("7", ok.documentsRevision());
        HandoverReadiness.Ok none = (HandoverReadiness.Ok) DocumentsHandoverReadiness.map(Optional.empty());
        assertFalse(none.ready());
        assertEquals("not-open", none.state());
    }

    @Test
    void handoverNeedsTheCompletedStageFromPolicy() {
        AppointmentConfig.Step done = new AppointmentConfig.Step("retailer", "Your handover is complete.");
        AppointmentConfig.Step wait = new AppointmentConfig.Step("retailer", "wait");
        Instant at = Instant.parse("2026-11-16T10:00:00Z");
        AppointmentConfig with = config(new AppointmentConfig.Outcomes(Map.of("completed", done), wait, "handover", "appointment-no-show"));
        var h = AppointmentHandover.handover(with, at, "ref-1").orElseThrow();
        assertEquals("handover", h.stage());
        assertEquals(at, h.at());
        assertEquals("retailer", h.owner());
        assertEquals("ref-1", h.providerReference());
        assertTrue(AppointmentHandover.handover(
                config(new AppointmentConfig.Outcomes(Map.of("completed", done), wait, null, "appointment-no-show")), at, "ref-1").isEmpty());
    }

    private static AppointmentConfig config(AppointmentConfig.Outcomes outcomes) {
        return new AppointmentConfig("v1", "sent to ordering", "approved", null, 0, 1000, null, null, outcomes, List.of());
    }
}
