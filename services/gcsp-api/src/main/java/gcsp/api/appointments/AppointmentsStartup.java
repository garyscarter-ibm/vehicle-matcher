package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.interceptor.Interceptor;
import org.jboss.logging.Logger;

/** Finishes open provider writes once at startup: reconcile only, never writes, never retries, never stops startup. */
@ApplicationScoped
public class AppointmentsStartup {

    /** Later than Persistence's default-priority observer, so the environment claim comes first. */
    static final int AFTER_PERSISTENCE = Interceptor.Priority.LIBRARY_AFTER;
    private static final Logger LOG = Logger.getLogger(AppointmentsStartup.class);

    @Inject
    AppointmentsWiring wiring;

    private volatile String summary = "not-run";

    void onStart(@Observes @Priority(AFTER_PERSISTENCE) StartupEvent event) {
        reconcileOnce();
    }

    /** Runs the pass once; every failure is logged, never thrown. */
    public void reconcileOnce() {
        if (!wiring.available() || AppointmentsWiring.NONE.equals(wiring.mode())) {
            summary = "skipped";
            return;
        }
        try {
            AppointmentService service = wiring.service();
            AppointmentResult result = service.reconcileOnStartup(wiring.scope());
            if (result instanceof AppointmentResult.Ok ok) {
                JsonNode v = ok.value();
                summary = "reconciled:" + v.path("orders").asInt();
                LOG.infof("GCSP appointments startup reconcile: %d open, %d applied, %d waiting, %d blocked, %d uncertain, %d failed",
                        v.path("orders").asInt(), v.path("applied").asInt(), v.path("waiting").asInt(),
                        v.path("blocked").asInt(), v.path("uncertain").asInt(), v.path("failed").size());
            } else {
                summary = "unavailable";
                LOG.infof("GCSP appointments startup reconcile did not run (%s); startup continues", describe(result));
            }
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP appointments startup reconcile failed (%s); startup continues", e.getClass().getSimpleName());
        }
    }

    /** not-run, skipped, reconciled:N, unavailable or failed. */
    public String summary() {
        return summary;
    }

    private static String describe(AppointmentResult r) {
        return r instanceof AppointmentResult.Unavailable u ? u.code() : r.getClass().getSimpleName();
    }
}
