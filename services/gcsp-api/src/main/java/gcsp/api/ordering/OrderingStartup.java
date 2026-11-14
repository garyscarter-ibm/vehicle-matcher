package gcsp.api.ordering;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import org.jboss.logging.Logger;

/** Reconciles open handoffs once at startup: completes employee-confirmed handoffs, never creates a new order intent. */
@ApplicationScoped
public class OrderingStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    static final String ACTOR = "ordering-startup";
    private static final Logger LOG = Logger.getLogger(OrderingStartup.class);

    @Inject
    Persistence persistence;

    @Inject
    OrderingServiceHolder holder;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the pass and returns the number of handoffs examined; failures are logged, not thrown. */
    public int reconcileOnce() {
        if (!persistence.active() || OrderingSelection.NONE.equals(holder.provider())) {
            summary = "skipped";
            return 0;
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            RunContext scope = new RunContext(run.environmentId(), run.runId(), ACTOR);
            OrderingResult result = holder.service().orElseThrow().reconcileOpen(scope, 100);
            if (!(result instanceof OrderingResult.Ok ok)) {
                summary = "failed";
                LOG.warn("GCSP ordering startup reconcile refused; startup continues");
                return 0;
            }
            JsonNode v = ok.value();
            summary = "reconciled:" + v.path("examined").asInt();
            LOG.infof("GCSP ordering startup reconcile: %d examined, %d settled, %d still pending",
                    v.path("examined").asInt(), v.path("settled").asInt(), v.path("stillPending").asInt());
            return v.path("examined").asInt();
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP ordering startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** not-run, skipped, reconciled:N or failed. */
    public String summary() {
        return summary;
    }
}
