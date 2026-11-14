package gcsp.api.allocation;

import java.util.List;

/** The typed answer of one trigger-consumption pass. */
public sealed interface TriggerResult {

    /** One consumed trigger: its allocation and the allocation's final state. */
    record Item(String allocationId, String triggerType, String sourceEventId, String state) {}

    /** The triggers consumed this pass and the cursor after them. */
    record Consumed(List<Item> allocations, long cursorRevision, String cursorEventId) implements TriggerResult {}

    /** An allocation was uncertain or unavailable; the cursor stays before it, so the next pass resumes there. */
    record Pending(String code, boolean retryable) implements TriggerResult {}

    /** A trigger or its allocation cannot be used; the cursor stays before it and nothing is skipped. */
    record Refused(String code, String message) implements TriggerResult {}
}
