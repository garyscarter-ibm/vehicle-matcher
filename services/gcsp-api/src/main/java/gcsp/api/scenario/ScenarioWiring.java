package gcsp.api.scenario;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;

import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.account.AccountSelection;
import gcsp.api.brief.BriefServiceHolder;
import gcsp.api.notify.MailTransportSelection;
import gcsp.api.ordering.OrderingProviderBindings;
import gcsp.api.ordering.OrderingSelection;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyService;
import gcsp.api.supply.SupplySelection;
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
import java.util.HashSet;
import java.util.Set;
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
    public static final int BEFORE_CLOCK_PASS = jakarta.interceptor.Interceptor.Priority.APPLICATION + 750;
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

    @Inject
    BriefServiceHolder briefs;

    @Inject
    AccountSelection accounts;

    @Inject
    SupplySelection supply;

    @Inject
    MailTransportSelection mail;

    @Inject
    OrderingProviderBindings ordering;

    @ConfigProperty(name = "gcsp.allocation.candidates.provider", defaultValue = "none")
    String candidatesProvider;

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
            var brief = briefs.service().orElseThrow();
            MainJourneyStart start = new MainJourneyStart(brief, policy, clock, file);
            service = new ScenarioService(source, persistence.reset(), clock,
                    new DemoPreparation(source, persistence.runner(), clock, policy, InstantSource.system(), file,
                            capabilities(), start::load), file);
        }
        return service;
    }

    private Set<String> capabilities() {
        Set<String> ready = new HashSet<>();
        boolean account = AccountSelection.REPOSITORY.equals(accounts.mode());
        if (account) {
            ready.add("brief-confirmation");
            ready.add("brief-change");
        }
        if (!SupplySelection.NONE.equals(supply.provider().mode()) && !SupplySelection.NONE.equals(supply.policyMode())) {
            ready.add("stock-release");
        }
        if (account && "recommendation".equals(candidatesProvider.trim())) {
            ready.add("buddy-allocation");
            ready.add("buddy-offers");
        }
        if ("captured".equals(mail.transport().name())) ready.add("captured-notifications");
        ready.add("offer-decisions");
        if (!OrderingSelection.NONE.equals(ordering.mode())) ready.add("order-handoff");
        return Set.copyOf(ready);
    }

    void onStart(@Observes @Priority(BEFORE_CLOCK_PASS) StartupEvent event) {
        if (available()) requireResetDatabase(dataSource.get());
        startupPass();
    }

    /** demo seeds fictional people, so it stops startup unless this database was claimed with reset allowed. */
    static void requireResetDatabase(DataSource source) {
        boolean allowed;
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(
                "SELECT reset_allowed FROM environment_identity"); ResultSet rs = ps.executeQuery()) {
            allowed = rs.next() && rs.getBoolean(1);
        } catch (SQLException e) {
            throw new IllegalStateException("GCSP_SCENARIO_PROVIDER=demo could not read the database identity (SQLState "
                    + e.getSQLState() + ")");
        }
        if (!allowed) {
            throw new IllegalStateException("GCSP_SCENARIO_PROVIDER=demo needs a database claimed with "
                    + "GCSP_RESET_ALLOWED=true; this database does not allow reset, so nothing is seeded");
        }
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
