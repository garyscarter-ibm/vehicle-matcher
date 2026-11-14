package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import java.util.List;

/** Order and case identity owned by other Stories (lifecycle stages FUCQ-470, employees and slots). */
public interface DocumentCasePort {

    /** A lifecycle.stages.v1 read: status ok carries value; not-found, unsupported, forbidden, unavailable do not. */
    record StageRead(String status, String code, JsonNode value) {}

    /** Orders the producer can list; failed carries per-order diagnostics {orderUuid, status, code}. */
    record OrderList(String status, String code, List<String> orderUuids, List<JsonNode> failed, int failedCount) {}

    /** The order's own renewal authority from the stage read; never the employee's default slot. */
    record OrderAuthority(String entitlementSlotId, String renewalId, String renewalAuthority) {}

    sealed interface CaseCheck {
        record Valid(String schemeId) implements CaseCheck {}
        /** stage-employee-unknown, stage-slot-mismatch or stage-renewal-mismatch. */
        record Refused(String reason) implements CaseCheck {}
        record Unavailable(String reason) implements CaseCheck {}
    }

    sealed interface Owner {
        record Owned(String employeeId) implements Owner {}
        record NotFound() implements Owner {}
        record Unavailable(String reason) implements Owner {}
    }

    StageRead readStage(RunContext ctx, String orderUuid);

    OrderList listOrders(RunContext ctx);

    CaseCheck checkCase(RunContext ctx, String employeeId, OrderAuthority order);

    /** The trusted selection-order owner, checked before any per-order producer detail reaches an employee. */
    Owner ownerOf(RunContext ctx, String orderUuid);
}
