package gcsp.api.returns;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.time.Instant;
import java.util.Optional;
import org.jboss.logging.Logger;

/** Reconciles open return operations once at startup; it never writes to the provider and never stops startup. */
@ApplicationScoped
public class ReturnStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    private static final Logger LOG = Logger.getLogger(ReturnStartup.class);

    @Inject
    Persistence persistence;

    @Inject
    ReturnService service;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the reconcile-only pass and returns the orders it looked at; failures are logged, not thrown. */
    public int reconcileOnce() {
        if (!persistence.active() || ReturnSelection.NONE.equals(service.selection().providerName())) {
            summary = "skipped";
            return 0;
        }
        try {
            RunContext scope = service.scope(ReturnPlans.SYSTEM_ACTOR);
            Optional<Instant> now = service.clockNow(scope);
            if (now.isEmpty()) {
                summary = "skipped";
                return 0;
            }
            ReturnPlans.Summary s = service.plans().progress(scope, now.get(), false);
            summary = "reconciled:" + s.orders();
            LOG.infof("GCSP returns startup reconcile: %d orders, %d applied, %d waiting, %d failed", s.orders(),
                    s.applied(), s.waiting(), s.failed().size());
            return s.orders();
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP returns startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
            return 0;
        }
    }

    /** not-run, skipped, reconciled:N or failed. */
    public String summary() {
        return summary;
    }
}
