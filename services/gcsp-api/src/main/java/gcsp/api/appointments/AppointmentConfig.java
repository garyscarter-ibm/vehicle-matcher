package gcsp.api.appointments;

import java.util.List;
import java.util.Map;

/** The appointment rules at one pinned policy version (Node loadAppointmentPolicy with the outcomes key). */
public record AppointmentConfig(
        String policyVersion,
        String openingStage,
        String openingState,
        SlotPolicy slotPolicy,
        int confirmDelaySeconds,
        int providerTimeoutMs,
        Scenario scenario,
        Ownership ownership,
        Outcomes outcomes,
        List<Assumption> assumptions) {

    public AppointmentConfig {
        assumptions = List.copyOf(assumptions);
    }

    /** Who acts next and what they are told. */
    public record Step(String owner, String nextStep) {}

    public record Scenario(boolean proposeChange, String proposedSlot, String proposalReason) {}

    /** states holds not-requested, requested, change-proposed and scheduled. */
    public record Ownership(Map<String, Step> states, Step ineligible, Step pending, Step blocked) {
        public Ownership {
            states = Map.copyOf(states);
        }
    }

    /** states holds completed and no-show; notReady answers a completion before readiness. */
    public record Outcomes(Map<String, Step> states, Step notReady) {
        public Outcomes {
            states = Map.copyOf(states);
        }
    }

    /** The shown facts of one policy row. */
    public record Assumption(String key, String status, String unit, String basis, String source, String sourceDate,
            String policyVersion) {}
}
