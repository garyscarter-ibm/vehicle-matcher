package gcsp.api.clock;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import org.jboss.logging.Logger;

/** Builds the run clock over the Quarkus datasource when persistence is on, and runs its startup pass once. */
@ApplicationScoped
public class RunClockHolder {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    private static final Logger LOG = Logger.getLogger(RunClockHolder.class);

    @Inject
    Persistence persistence;

    @Inject
    PolicyService policy;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    @Any
    Instance<TickHandler> handlers;

    private RunClock clock;
    private volatile String summary = "not-run";

    public boolean available() {
        return persistence.active();
    }

    /** Throws IllegalArgumentException for an invalid handler registration. */
    public synchronized RunClock clock() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        if (clock == null) {
            List<TickHandler> found = new ArrayList<>();
            handlers.forEach(found::add);
            AgroalDataSource source = dataSource.get();
            clock = new RunClock(source, persistence.runner(), policy, found, InstantSource.system());
        }
        return clock;
    }

    /** The active run's scope for this actor; a caller never chooses the environment or run. */
    public RunContext scope(String actorId) {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), actorId);
    }

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        if (!persistence.active()) {
            summary = "skipped";
            return;
        }
        var run = persistence.guard().currentRun();
        // A bad handler registration or stage stops startup with its message.
        clock().verifyHandlers(run.environmentId(), run.runId());
        reconcileOnce();
    }

    /** Runs the startup pass; failures are logged by code, not thrown. */
    public ClockResult reconcileOnce() {
        try {
            var run = persistence.guard().currentRun();
            ClockResult result = clock().reconcileStartup(run.environmentId(), run.runId());
            if (result instanceof ClockResult.Failure failure) {
                summary = "failed:" + failure.code();
                LOG.warnf("GCSP clock startup pass did not finish (%s); startup continues", failure.code());
            } else {
                summary = "completed";
                LOG.info("GCSP clock startup pass completed");
            }
            return result;
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP clock startup pass failed (%s); startup continues", e.getClass().getSimpleName());
            return ClockResult.unavailable("startup-failed", "The startup clock pass failed.", true);
        }
    }

    /** not-run, skipped, completed, failed or failed:code. */
    public String summary() {
        return summary;
    }
}
