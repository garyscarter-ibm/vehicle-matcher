package gcsp.api.appointments;

import gcsp.api.persistence.RunContext;

/** No stage producer is wired: every read is unavailable, so no appointment ever opens. */
public final class UnconfiguredOrderStage implements OrderStagePort {

    @Override
    public StageRead read(RunContext context, String orderUuid) {
        return new StageRead.Unavailable("unavailable", "stage-producer-not-configured");
    }
}
