package gcsp.api.approvals;

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

/** Finishes open approval decisions once at startup; it never counts ticks, starts orders or stops startup. */
@ApplicationScoped
public class ApprovalStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    static final String ACTOR = "startup";
    private static final Logger LOG = Logger.getLogger(ApprovalStartup.class);

    @Inject
    Persistence persistence;

    @Inject
    ApprovalSelection selection;

    @Inject
    ApprovalServiceHolder holder;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the pass and returns the number of decisions examined; failures are logged, not thrown. */
    public int reconcileOnce() {
        if (!persistence.active() || ApprovalSelection.NONE.equals(selection.provider())) {
            summary = "skipped";
            return 0;
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            RunContext scope = new RunContext(run.environmentId(), run.runId(), ACTOR);
            ApprovalResult result = holder.service().orElseThrow().reconcile(scope, 100);
            if (!(result instanceof ApprovalResult.Ok ok)) {
                summary = "failed";
                LOG.warnf("GCSP approvals startup reconcile refused (%s); startup continues", result.code());
                return 0;
            }
            JsonNode v = ok.value();
            summary = "reconciled:" + v.path("examined").asInt();
            LOG.infof("GCSP approvals startup reconcile: %d examined, %d settled, %d still open",
                    v.path("examined").asInt(), v.path("settled").asInt(), v.path("open").asInt());
            return v.path("examined").asInt();
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP approvals startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** not-run, skipped, reconciled:N or failed. */
    public String summary() {
        return summary;
    }
}
