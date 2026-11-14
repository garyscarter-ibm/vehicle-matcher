package gcsp.api.returns;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/** Builds the one ReturnPlans lazily over the Agroal datasource and the port beans; unavailable without persistence. */
@ApplicationScoped
public class ReturnService {

    private static final String OPEN_SQL = "SELECT count(*) FROM pending_operations p JOIN return_operations o "
            + "ON o.environment_id = p.environment_id AND o.run_id = p.run_id AND o.operation_id = p.operation_id "
            + "WHERE p.environment_id = ? AND p.run_id = ? AND p.state IN ('intent', 'pending')";

    @Inject
    Persistence persistence;

    @Inject
    ReturnSelection selection;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    ReturnSourcePort sources;

    @Inject
    HandoverPort handovers;

    private ReturnPlans plans;

    public boolean available() {
        return persistence.active();
    }

    public synchronized ReturnPlans plans() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        if (plans == null) {
            AgroalDataSource ds = dataSource.get();
            plans = new ReturnPlans(selection.policy(), sources, handovers, selection.clock(), selection.provider(),
                    selection.currentCar(), persistence.runner(), ds);
        }
        return plans;
    }

    /** The active run's scope; the caller's identity never chooses the environment or run. */
    public RunContext scope(String actor) {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), actor);
    }

    /** The demo clock for the run; empty until a presenter tick has set it. */
    public Optional<Instant> clockNow(RunContext scope) {
        return selection.clock().now(scope);
    }

    public ReturnSelection selection() {
        return selection;
    }

    public String sourceMode() {
        return sources.mode();
    }

    public String handoverMode() {
        return handovers.mode();
    }

    /** Return operations still awaiting a provider answer, by the open-operations partial index. */
    public long openOperations(RunContext scope) throws SQLException {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(OPEN_SQL)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    @PreDestroy
    synchronized void close() {
        if (plans != null) plans.close();
    }
}
