package gcsp.api.supply;

import gcsp.api.persistence.Persistence;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.util.List;
import org.jboss.logging.Logger;

/** Finishes delivered but pending ticks once at startup; it never pulls new releases and never stops startup. */
@ApplicationScoped
public class SupplyStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    private static final Logger LOG = Logger.getLogger(SupplyStartup.class);

    @Inject
    Persistence persistence;

    @Inject
    SupplySelection selection;

    @Inject
    SupplyRelease supply;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the pass and returns the number of pending ticks it processed; failures are logged, not thrown. */
    public int reconcileOnce() {
        if (!persistence.active() || SupplySelection.NONE.equals(selection.provider().mode())) {
            summary = "skipped";
            return 0;
        }
        try {
            List<ReleaseResult> results = supply.release().reconcilePending(supply.scope(), 100);
            long done = results.stream().filter(r -> r.status() == ReleaseResult.Status.OK).count();
            summary = "reconciled:" + results.size();
            LOG.infof("GCSP supply startup reconcile: %d pending ticks processed, %d completed", results.size(), done);
            return results.size();
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP supply startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** not-run, skipped, reconciled:N or failed. */
    public String summary() {
        return summary;
    }
}
