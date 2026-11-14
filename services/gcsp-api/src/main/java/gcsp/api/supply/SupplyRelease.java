package gcsp.api.supply;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/** Builds the release engine and the released-stock reads over the Quarkus datasource, only when persistence is on. */
@ApplicationScoped
public class SupplyRelease {

    static final String ACTOR = "presenter";

    @Inject
    Persistence persistence;

    @Inject
    SupplySelection selection;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private StockRelease release;
    private ReleasedStock stock;

    public boolean available() {
        return persistence.active();
    }

    public synchronized StockRelease release() {
        if (release == null) release = new StockRelease(source(), selection.policy(), selection.provider());
        return release;
    }

    public synchronized ReleasedStock stock() {
        if (stock == null) stock = new ReleasedStock(source());
        return stock;
    }

    /** The active run's scope; the caller's identity never chooses the environment or run. */
    public RunContext scope() {
        var run = persistence.guard().currentRun();
        return new RunContext(run.environmentId(), run.runId(), ACTOR);
    }

    /** Pending ticks for the run, counted through the pending partial index. */
    public long pendingTicks(RunContext scope) throws SQLException {
        String sql = "SELECT count(*) FROM supply_release_ticks WHERE environment_id = ? AND run_id = ? "
                + "AND state = 'pending'";
        try (Connection c = source().getConnection(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    private AgroalDataSource source() {
        if (!persistence.active()) throw new IllegalStateException("Persistence is not configured");
        return dataSource.get();
    }
}
