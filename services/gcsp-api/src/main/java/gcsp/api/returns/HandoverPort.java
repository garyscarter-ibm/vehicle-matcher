package gcsp.api.returns;

import gcsp.api.persistence.RunContext;

/** The new car's handover appointment (FUCQ-472, a sibling Story); read only. */
public interface HandoverPort {

    HandoverReading read(RunContext ctx, String orderUuid);
}
