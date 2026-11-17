package gcsp.api.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalResult;
import gcsp.api.approvals.OrderSourcePort;
import java.sql.Connection;
import org.junit.jupiter.api.Test;

/** The real case port: stage and owner mappings, and the employee, slot and renewal checks on native PostgreSQL. */
class LifecycleDocumentCasesTest {

    private static DocumentCasePort.OrderAuthority order(String slot, String renewal) {
        return new DocumentCasePort.OrderAuthority(slot, renewal, renewal == null ? "missing" : "validated");
    }

    @Test
    void approvalAnswersKeepTheirStatus() {
        ObjectNode value = DocumentsPg.JSON.createObjectNode();
        assertEquals("ok", LifecycleDocumentCases.stage(new ApprovalResult.Ok(value, false)).status());
        assertEquals("not-found", LifecycleDocumentCases.stage(new ApprovalResult.NotFound("x")).status());
        assertEquals("forbidden", LifecycleDocumentCases.stage(new ApprovalResult.Forbidden("c", "x")).status());
        DocumentCasePort.StageRead u = LifecycleDocumentCases.stage(
                new ApprovalResult.Unavailable("selection-pending", "x", true, false, "not-ready"));
        assertEquals("unavailable", u.status());
        assertEquals("selection-pending", u.code());
        assertEquals("invalid", LifecycleDocumentCases.stage(new ApprovalResult.Invalid("bad", "x")).status());
        assertEquals("conflict", LifecycleDocumentCases.stage(new ApprovalResult.Conflict("c", "x", false)).status());
    }

    @Test
    void ownerComesFromTheSelectionRecord() {
        assertEquals("e-1", ((DocumentCasePort.Owner.Owned) LifecycleDocumentCases.owner(
                new OrderSourcePort.NotReady("e-1", "selection-pending", "x"))).employeeId());
        assertEquals("e-2", ((DocumentCasePort.Owner.Owned) LifecycleDocumentCases.owner(
                new OrderSourcePort.Duplicate("e-2"))).employeeId());
        assertInstanceOf(DocumentCasePort.Owner.NotFound.class, LifecycleDocumentCases.owner(new OrderSourcePort.NotFound()));
        assertEquals("down", ((DocumentCasePort.Owner.Unavailable) LifecycleDocumentCases.owner(
                new OrderSourcePort.Unavailable("down"))).reason());
    }

    @Test
    void caseChecksFollowTheNodeOwnerRules() throws Exception {
        try (DocumentsPg pg = DocumentsPg.create(); Connection c = pg.pool().getConnection()) {
            pg.update("INSERT INTO employees (environment_id, run_id, employee_id, attributes) VALUES (?, 'run-1', "
                    + "'e-paula', '{\"schemeId\":\"choices-fs-uk\"}'::jsonb)", DocumentsPg.ENV);
            pg.update("INSERT INTO employees (environment_id, run_id, employee_id) VALUES (?, 'run-1', 'e-alex')",
                    DocumentsPg.ENV);
            pg.update("INSERT INTO entitlement_slots (environment_id, run_id, slot_id, employee_id, capacity, attributes) "
                    + "VALUES (?, 'run-1', 'slot-paula', 'e-paula', 1, '{\"renewalId\":\"renewal-1\"}'::jsonb)",
                    DocumentsPg.ENV);
            assertEquals("stage-employee-unknown", refused(LifecycleDocumentCases.check(c, pg.ctx, "e-nobody", order(null, null))));
            assertEquals("choices-fs-uk", valid(LifecycleDocumentCases.check(c, pg.ctx, "e-paula", order(null, null))));
            assertEquals("stage-slot-mismatch", refused(LifecycleDocumentCases.check(c, pg.ctx, "e-paula", order("slot-gone", null))));
            assertEquals("stage-slot-mismatch", refused(LifecycleDocumentCases.check(c, pg.ctx, "e-alex", order("slot-paula", null))));
            assertEquals("stage-renewal-mismatch",
                    refused(LifecycleDocumentCases.check(c, pg.ctx, "e-paula", order("slot-paula", "renewal-2"))));
            assertEquals("choices-fs-uk", valid(LifecycleDocumentCases.check(c, pg.ctx, "e-paula", order("slot-paula", "renewal-1"))));
            assertEquals("choices-fs-uk", valid(LifecycleDocumentCases.check(c, pg.ctx, "e-paula", order("slot-paula", null))));
            assertEquals(null, valid(LifecycleDocumentCases.check(c, pg.ctx, "e-alex", order(null, null))));
        }
    }

    private static String refused(DocumentCasePort.CaseCheck check) {
        return ((DocumentCasePort.CaseCheck.Refused) check).reason();
    }

    private static String valid(DocumentCasePort.CaseCheck check) {
        return ((DocumentCasePort.CaseCheck.Valid) check).schemeId();
    }
}
