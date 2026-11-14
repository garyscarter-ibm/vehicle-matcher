package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.List;

/** The acknowledged selection-order handoff (producer: FUCQ-468). Orders list keyset by orderUuid ascending. */
public interface OrderSourcePort {

    String mode();

    Found find(RunContext ctx, String orderUuid);

    Listing list(RunContext ctx, String after, int limit);

    /** source mirrors Node decodeSelectionOrder's source object; renewalId is the producer's validated slot renewal. */
    record SelectionOrder(String orderUuid, String employeeId, String entitlementSlotId, String renewalId,
            String route, JsonNode source, List<String> approvalStages, String policyVersion, Instant receivedAt,
            String operationId, String providerReference) {}

    sealed interface Found {}

    record Ready(SelectionOrder order) implements Found {}

    /** code is selection-pending or selection-handoff-failed. */
    record NotReady(String employeeId, String code, String reason) implements Found {}

    /** The record exists but cannot be read (selection-source-invalid). */
    record Invalid(String employeeId) implements Found {}

    record NotFound() implements Found {}

    /** More than one acknowledged record for the order. */
    record Duplicate(String employeeId) implements Found {}

    record Unavailable(String code) implements Found, Listing {}

    sealed interface Listing {}

    record InvalidRow(String orderUuid, String employeeId) {}

    /** Ready orders ascending by orderUuid, the unreadable rows seen in the same range, and the next cursor. */
    record Page(List<SelectionOrder> orders, List<InvalidRow> invalid, String nextAfter) implements Listing {}
}
