package gcsp.api.returns;

import gcsp.api.persistence.RunContext;

/** The order's selection record, owned by other Stories and read only here. */
public interface ReturnSourcePort {

    ReturnSourceReading read(RunContext ctx, String orderUuid);

    /** Reported by readiness: none until an adapter replaces the unconfigured default. */
    default String mode() {
        return "configured";
    }
}
