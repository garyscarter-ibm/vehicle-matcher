package gcsp.api.policy;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.TransactionRunner;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import javax.sql.DataSource;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** The datasource, configured environment and command runner the policy classes use; inactive without persistence. */
@ApplicationScoped
public class PolicyDatabase {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @ConfigProperty(name = "gcsp.environment-id")
    java.util.Optional<String> environmentId;

    private DataSource direct;
    private String directEnvironment;
    private TransactionRunner directRunner;

    PolicyDatabase() {
    }

    /** For tests and plain wiring: an explicit datasource and environment. */
    public PolicyDatabase(DataSource dataSource, String environmentId) {
        this.direct = dataSource;
        this.directEnvironment = environmentId;
        this.directRunner = new TransactionRunner(dataSource);
    }

    public boolean active() {
        return direct != null || persistence.active();
    }

    public DataSource dataSource() {
        return direct != null ? direct : dataSource.get();
    }

    public String environmentId() {
        return direct != null ? directEnvironment : environmentId.orElse("");
    }

    public TransactionRunner runner() {
        return direct != null ? directRunner : persistence.runner();
    }
}
