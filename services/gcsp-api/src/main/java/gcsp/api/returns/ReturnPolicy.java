package gcsp.api.returns;

import java.util.List;
import java.util.Map;

/** The pinned return rules for one policy version, as read from the retained policy; never carries a default. */
public record ReturnPolicy(String policyVersion, List<Choice> choices, Map<String, Rule> rules, Ownership ownership,
        String openingStage, String openingState, SlotPolicy slotPolicy, int confirmDelaySeconds, int providerTimeoutMs,
        Scenario scenario, OutcomeConfig outcome, List<Assumption> assumptions) {

    public record Choice(String id, String label) {}

    /** A choice's rule; same-visit has no slots, no day window and no end-of-handover bound (false, 0, null). */
    public record Rule(List<String> requiresHandoverStates, String location, String slot, boolean notBeforeHandoverEnd,
            int maxDaysAfterHandover, SlotPolicy slots) {}

    public record OwnerStep(String owner, String nextStep) {}

    public record Ownership(Map<String, OwnerStep> states, OwnerStep ineligible, OwnerStep pending, OwnerStep blocked) {}

    public record Scenario(boolean proposeChange, String proposedSlot, String proposalReason) {}

    public record OutcomeConfig(boolean enabled, String outcome, int delaySecondsAfterSlotEnd, String exceptionType,
            OwnerStep returned, OwnerStep missed) {}

    /** The provenance of one keyed assumption (key, status, unit, basis, source, sourceDate, policyVersion). */
    public record Assumption(String key, String status, String unit, String basis, String source, String sourceDate,
            String policyVersion) {}
}
