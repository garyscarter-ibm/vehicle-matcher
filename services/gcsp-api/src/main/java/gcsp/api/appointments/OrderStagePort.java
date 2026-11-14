package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;

/** The order lifecycle stage reader (lifecycle.stages.v1). FUCQ-470 implements it; tests use a stub. */
public interface OrderStagePort {

    StageRead read(RunContext context, String orderUuid);
}
