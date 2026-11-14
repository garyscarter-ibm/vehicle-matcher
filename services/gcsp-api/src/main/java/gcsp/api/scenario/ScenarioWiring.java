package gcsp.api.scenario;

import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.Startup;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.time.InstantSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Chooses the scenario provider once at startup (an unknown name stops startup). Only "demo" ever seeds anything, and
 * only a run that has no scenario row; a restart never reseeds or resets.
 */
@ApplicationScoped
@Startup
public class ScenarioWiring {

    /** After Persistence's claim, before the clock's startup pass, so its handlers see the prepared people. */
    static final int BEFORE_CLOCK_PASS = jakarta.interceptor.Interceptor.Priority.APPLICATION + 750;
    private static final Logger LOG = Logger.getLogger(ScenarioWiring.class);

    @ConfigProperty(name = "gcsp.scenario.provider", defaultValue = ScenarioProvider.NONE)
    String providerName;

    @Inject
    Persistence persistence;

    @Inject
    RunClockHolder holder;

    @Inject
    PolicyService policy;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile String mode;
    private volatile String summary = "not-run";
    private ScenarioService service;

    @PostConstruct
    void init() {
        mode = ScenarioProvider.normalise(providerName);
        LOG.infof("GCSP scenario provider: %s", mode);
    }

    public boolean demo() {
        return ScenarioProvider.DEMO.equals(mode);
    }

    /** True when scenario controls can answer: provider demo and persistence on. */
    public boolean available() {
        return demo() && persistence.active();
    }

    public synchronized ScenarioService service() {
        if (!available()) throw new IllegalStateException("Scenario controls are not configured");
        if (service == null) {
            DemoPreparationFile file = DemoPreparationFile.load();
            AgroalDataSource source = dataSource.get();
            var clock = holder.clock();
            service = new ScenarioService(source, persistence.reset(), clock,
                    new DemoPreparation(source, persistence.runner(), clock, policy, InstantSource.system(), file), file);
        }
        return service;
    }

    void onStart(@Observes @Priority(BEFORE_CLOCK_PASS) StartupEvent event) {
        startupPass();
    }

    /** Prepares the active run when it has no scenario row; never stops startup and logs codes only. */
    public ClockResult startupPass() {
        if (!available()) {
            summary = "skipped";
            return ClockResult.unavailable("scenarios-not-configured", "Scenario controls are not configured.", false);
        }
        try {
            var run = holder.activeRun();
            ClockResult result = service().startup(run.environmentId(), run.runId());
            if (result instanceof ClockResult.Failure failure) {
                summary = "failed:" + failure.code();
                LOG.warnf("GCSP scenario preparation did not finish (%s); startup continues", failure.code());
            } else {
                summary = "completed";
                LOG.info("GCSP scenario preparation checked");
            }
            return result;
        } catch (RuntimeException e) {
            summary = "failed";
            LOG.warnf("GCSP scenario preparation failed (%s); startup continues", e.getClass().getSimpleName());
            return ClockResult.unavailable("startup-failed", "The scenario startup pass failed.", true);
        }
    }

    /** not-run, skipped, completed, failed or failed:code. */
    public String summary() {
        return summary;
    }
}
