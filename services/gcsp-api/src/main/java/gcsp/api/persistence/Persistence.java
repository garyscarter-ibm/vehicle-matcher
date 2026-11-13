package gcsp.api.persistence;

import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import io.quarkus.runtime.StartupEvent;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Wires the runner and guard over the Quarkus datasource, and claims the environment at startup. */
@ApplicationScoped
public class Persistence {

    @ConfigProperty(name = "quarkus.datasource.active", defaultValue = "true")
    boolean active;

    @ConfigProperty(name = "gcsp.environment-id")
    java.util.Optional<String> environmentId;

    @ConfigProperty(name = "gcsp.database.expected-name")
    java.util.Optional<String> expectedDatabase;

    @ConfigProperty(name = "gcsp.reset-allowed", defaultValue = "false")
    boolean resetAllowed;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private volatile TransactionRunner runner;
    private volatile EnvironmentGuard guard;

    public boolean active() {
        return active;
    }

    public synchronized TransactionRunner runner() {
        if (!active) throw new IllegalStateException("Persistence is not configured");
        if (runner == null) runner = new TransactionRunner(dataSource.get());
        return runner;
    }

    public synchronized EnvironmentGuard guard() {
        if (!active) throw new IllegalStateException("Persistence is not configured");
        if (guard == null) {
            guard = new EnvironmentGuard(dataSource.get(), expectedDatabase.orElse(""), environmentId.orElse(""),
                    resetAllowed);
        }
        return guard;
    }

    void onStart(@Observes StartupEvent event) {
        if (active) guard().claim();
    }
}
