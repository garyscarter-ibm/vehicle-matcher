package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;

/** No documents service is wired: readiness is unavailable, so no handover can be completed. */
public final class UnconfiguredHandoverReadiness implements HandoverReadinessPort {

    @Override
    public HandoverReadiness read(RunContext context, String orderUuid) {
        return new HandoverReadiness.Unavailable();
    }
}
