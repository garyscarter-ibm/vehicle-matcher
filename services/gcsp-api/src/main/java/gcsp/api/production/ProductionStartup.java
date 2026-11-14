package gcsp.api.production;

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

/** Reconciles open Production requests once at startup; it never submits and never stops startup. */
@ApplicationScoped
public class ProductionStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    static final String ACTOR = "system:production";
    private static final Logger LOG = Logger.getLogger(ProductionStartup.class);

    @Inject
    Persistence persistence;

    @Inject
    ProductionSelection selection;

    @Inject
    ProductionServiceHolder holder;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the reconcile-only pass and returns the requests it looked at; failures are logged, not thrown. */
    public int reconcileOnce() {
        if (!persistence.active() || ProductionSelection.NONE.equals(selection.providerName())) {
            summary = "skipped";
            return 0;
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            RunContext scope = new RunContext(run.environmentId(), run.runId(), ACTOR);
            ProductionResult result = holder.service().orElseThrow().reconcile(scope, 100);
            if (!(result instanceof ProductionResult.Ok ok)) {
                summary = "failed";
                LOG.warnf("GCSP production startup reconcile did not run (%s); startup continues", result.getClass().getSimpleName());
                return 0;
            }
            JsonNode v = ok.value();
            summary = "reconciled:" + v.path("reconciled").asInt();
            LOG.infof("GCSP production startup reconcile: %d requests, %d applied, %d queued", v.path("reconciled").asInt(),
                    v.path("applied").asInt(), v.path("queued").asInt());
            return v.path("reconciled").asInt();
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP production startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** not-run, skipped, reconciled:N or failed. */
    public String summary() {
        return summary;
    }
}
