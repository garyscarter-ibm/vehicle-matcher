package gcsp.api.appointments;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.DefaultBean;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.util.function.Supplier;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Chooses the appointment provider once at startup (an unknown name stops startup) and builds the service when
 * persistence is on. Later Stories replace the unconfigured stage and readiness ports below.
 */
@ApplicationScoped
@Startup
public class AppointmentsWiring {

    public static final String NONE = "none";
    public static final String SYNTHETIC = "synthetic";
    public static final String LIVE = "live";
    static final String ACTOR = "appointments-http";
    private static final Logger LOG = Logger.getLogger(AppointmentsWiring.class);

    @ConfigProperty(name = "gcsp.appointments.provider", defaultValue = NONE)
    String providerName;

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    AppointmentPolicy policy;

    @Inject
    Instance<OrderStagePort> stages;

    @Inject
    Instance<HandoverReadinessPort> readiness;

    private volatile String mode;
    private AppointmentService service;

    @PostConstruct
    void init() {
        mode = normalise(providerName);
        LOG.infof("GCSP appointments provider: %s", mode);
    }

    @PreDestroy
    void close() {
        synchronized (this) {
            if (service != null) service.close();
        }
    }

    /** none, synthetic or live; anything else stops startup. Static so every refusal is unit-testable. */
    public static String normalise(String name) {
        String n = name == null || name.isBlank() ? NONE : name.trim();
        if (!NONE.equals(n) && !SYNTHETIC.equals(n) && !LIVE.equals(n)) {
            throw new IllegalStateException("Unknown gcsp.appointments.provider '" + n + "'; supported: none, synthetic, live");
        }
        return n;
    }

    /** The provider for a validated mode; only synthetic reads the datasource. */
    public static AppointmentProvider select(String name, Supplier<DataSource> dataSource) {
        return switch (normalise(name)) {
            case SYNTHETIC -> new SyntheticAppointments(dataSource.get());
            case LIVE -> new LiveAppointmentsStub();
            default -> new UnconfiguredAppointments();
        };
    }

    public String mode() {
        return mode;
    }

    public boolean available() {
        return persistence.active();
    }

    /** Null while persistence is off, so callers answer unavailable instead of guessing. */
    public synchronized AppointmentService service() {
        if (service == null && persistence.active()) {
            DataSource ds = dataSource.get();
            service = new AppointmentService(ds, policy, select(mode, () -> ds), stages.get(), new TickClock(ds), readiness.get());
        }
        return service;
    }

    /** The active run's scope; a caller's identity or request never chooses the environment or run. */
    public RunContext scope() {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), ACTOR);
    }

    @Produces
    @DefaultBean
    @Singleton
    OrderStagePort unconfiguredStages() {
        return new UnconfiguredOrderStage();
    }

    @Produces
    @DefaultBean
    @Singleton
    HandoverReadinessPort unconfiguredReadiness() {
        return new UnconfiguredHandoverReadiness();
    }
}
