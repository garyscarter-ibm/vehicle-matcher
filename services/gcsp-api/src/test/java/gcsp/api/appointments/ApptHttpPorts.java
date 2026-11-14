package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;

/** Test stage and readiness ports for the HTTP profiles; static state so a test sets each order before it calls. */
public final class ApptHttpPorts {

    static final StubStages STAGES = new StubStages();
    static final StubReadiness READINESS = new StubReadiness();

    private ApptHttpPorts() {}

    @Alternative
    @ApplicationScoped
    public static class Stages implements OrderStagePort {
        @Override
        public StageRead read(RunContext context, String orderUuid) {
            return STAGES.read(context, orderUuid);
        }
    }

    @Alternative
    @ApplicationScoped
    public static class Readiness implements HandoverReadinessPort {
        @Override
        public HandoverReadiness read(RunContext context, String orderUuid) {
            return READINESS.read(context, orderUuid);
        }
    }
}
