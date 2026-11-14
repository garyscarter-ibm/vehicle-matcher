package gcsp.api.notify;

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

/** Drains pending notifications on one daemon thread; a failed tick is logged by exception class only, then retried. */
@ApplicationScoped
public class NotificationDrain {

    private static final Logger LOG = Logger.getLogger(NotificationDrain.class);
    private static final Duration MIN = Duration.ofSeconds(1);
    private static final Duration MAX = Duration.ofMinutes(10);

    @ConfigProperty(name = "gcsp.notify.drain-interval")
    Duration interval;

    @Inject
    Persistence persistence;

    @Inject
    Notifications notifications;

    private ScheduledExecutorService executor;

    void started(@Observes StartupEvent event) {
        if (interval.compareTo(MIN) < 0 || interval.compareTo(MAX) > 0) {
            throw new IllegalStateException("gcsp.notify.drain-interval must be from 1s to 10m");
        }
        if (!persistence.active()) return;
        notifications.dispatcher();  // built now, so an invalid public base URL stops startup
        executor = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "notification-drain");
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleWithFixedDelay(this::drainNow, interval.toMillis(), interval.toMillis(), TimeUnit.MILLISECONDS);
    }

    void stopping(@Observes ShutdownEvent event) {
        if (executor != null) executor.shutdownNow();
    }

    void drainNow() {
        try {
            notifications.dispatcher().dispatchPending();
        } catch (Throwable t) {
            LOG.warnf("Notification drain tick failed (%s); the next tick retries", t.getClass().getSimpleName());
        }
    }
}
