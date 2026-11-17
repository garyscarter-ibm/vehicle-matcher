package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.approvals.HandoverPort;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.time.Instant;
import java.util.Optional;

/** A completed handover as the order's final tracker stage, from stored state only (never the stage port). */
@ApplicationScoped
public class AppointmentHandover implements HandoverPort {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AppointmentPolicy policy;

    @Override
    public Optional<Handover> completed(RunContext ctx, String orderUuid, Instant asOf) {
        if (!persistence.active()) return Optional.empty();
        try (Connection c = dataSource.get().getConnection()) {
            Optional<AppointmentStore.Row> row = AppointmentStore.row(c, ctx, orderUuid);
            if (row.isEmpty() || !"completed".equals(row.get().state())) return Optional.empty();
            JsonNode outcome = row.get().outcome();
            boolean done = outcome != null && "completed".equals(outcome.path("state").asText(null));
            Instant at = done ? Iso.parse(outcome.path("at").asText(null)) : null;
            if (at == null) return Optional.empty();
            String reference = outcome.hasNonNull("providerReference") ? outcome.get("providerReference").asText() : null;
            PolicyResult<AppointmentConfig> config = policy.config(ctx.runId(), row.get().policyVersion(), asOf != null ? asOf : at);
            return config instanceof PolicyResult.Ok<AppointmentConfig> ok ? handover(ok.value(), at, reference)
                    : Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    /** Empty when the policy names no completed stage, so the view stays as it was. */
    static Optional<Handover> handover(AppointmentConfig config, Instant at, String reference) {
        AppointmentConfig.Step done = config.outcomes().states().get("completed");
        String stage = config.outcomes().completedStage();
        if (done == null || stage == null) return Optional.empty();
        return Optional.of(new Handover(stage, at, done.owner(), done.nextStep(), reference));
    }
}
