package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;

/** Handover readiness reader. FUCQ-471 (gcsp.api.documents) implements it later; tests use a stub. */
public interface HandoverReadinessPort {

    HandoverReadiness read(RunContext context, String orderUuid);
}
