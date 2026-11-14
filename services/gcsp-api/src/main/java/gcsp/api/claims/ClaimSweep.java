package gcsp.api.claims;

import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/** Expires due claims and reconciles open remote operations on one daemon thread; a failed tick is logged by class only. */
@ApplicationScoped
public class ClaimSweep {

    static final String ACTOR = "system:manual-claims";
    static final int BATCH = 100;
    private static final Logger LOG = Logger.getLogger(ClaimSweep.class);
    private static final Duration MIN = Duration.ofSeconds(1);
    private static final Duration MAX = Duration.ofMinutes(10);

    @ConfigProperty(name = "gcsp.claims.sweep-interval")
    Duration interval;

    @Inject
    Persistence persistence;

    @Inject
    ManualClaimsHolder holder;

    private ScheduledExecutorService executor;

    void started(@Observes StartupEvent event) {
        checkInterval(interval);
        if (!persistence.active()) return;
        executor = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "claim-sweep");
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleWithFixedDelay(this::sweepNow, interval.toMillis(), interval.toMillis(), TimeUnit.MILLISECONDS);
    }

    void stopping(@Observes ShutdownEvent event) {
        if (executor != null) executor.shutdownNow();
    }

    static void checkInterval(Duration value) {
        if (value.compareTo(MIN) < 0 || value.compareTo(MAX) > 0) {
            throw new IllegalStateException("gcsp.claims.sweep-interval must be from 1s to 10m");
        }
    }

    /** One tick: expire due holds, then reconcile open remote operations, in the active run. */
    void sweepNow() {
        try {
            if (!persistence.active()) return;
            var claims = holder.claims();
            if (claims.isEmpty()) return;
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            ClaimScope system = new ClaimScope(run.environmentId(), run.runId(), ACTOR, ACTOR, "");
            claims.get().expireDue(system, BATCH);
            claims.get().reconcileOpen(system, BATCH);
        } catch (Throwable t) {
            LOG.warnf("Claim sweep tick failed (%s); the next tick retries", t.getClass().getSimpleName());
        }
    }
}
