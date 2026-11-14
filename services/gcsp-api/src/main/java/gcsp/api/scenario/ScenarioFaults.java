package gcsp.api.scenario;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.WorkResult;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

/** The presenter's synthetic faults for the active run, one keyed row per adapter; ordering has no Java adapter yet. */
@ApplicationScoped
public class ScenarioFaults {

    public static final String STOCK = "stock";
    public static final List<String> ADAPTERS = List.of(STOCK);
    public static final List<String> MODES = List.of("none", "unavailable", "stale");
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final String READ_SQL = "SELECT mode FROM scenario_faults WHERE environment_id = ? AND run_id = ? "
            + "AND adapter = ?";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    /** The run's stock fault; none when no row, or persistence is off. Throws IllegalStateException when unreadable. */
    public String stockMode(RunContext scope) {
        if (!persistence.active()) return "none";
        try (Connection c = dataSource.get().getConnection(); PreparedStatement ps = c.prepareStatement(READ_SQL)) {
            ps.setString(1, scope.environmentId());
            ps.setString(2, scope.runId());
            ps.setString(3, STOCK);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : "none";
            }
        } catch (SQLException e) {
            throw new IllegalStateException("The fault could not be read", e);
        }
    }

    public ClockResult read(RunContext scope) {
        try {
            return ClockResult.ok(view(scope, stockMode(scope)));
        } catch (IllegalStateException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not be reached.", true);
        }
    }

    /** Sets the run's fault in one command; the same command id replays, other input under it is a conflict. */
    public ClockResult set(RunContext scope, String commandId, String adapter, String mode) {
        ObjectNode input = F.objectNode().put("adapter", adapter).put("mode", mode);
        Outcome done;
        try {
            done = persistence.runner().execute(scope, new Command("scenario.fault.set", "scenario:fault:" + commandId,
                    input), tx -> {
                tx.write("INSERT INTO scenario_faults (environment_id, run_id, adapter, mode) VALUES (?, ?, ?, ?) "
                        + "ON CONFLICT (environment_id, run_id, adapter) DO UPDATE SET mode = EXCLUDED.mode, "
                        + "version = scenario_faults.version + 1, updated_at = now()", scope.environmentId(),
                        scope.runId(), adapter, mode);
                return WorkResult.ok(view(scope, mode));
            });
        } catch (RuntimeException e) {
            return ClockResult.unavailable("database-unavailable", "The database could not be reached.", true);
        }
        if (done instanceof Outcome.Committed c) return ClockResult.ok(c.result());
        if (done instanceof Outcome.Conflict c) {
            return "stale-run".equals(c.code()) ? ClockResult.staleRun() : ClockResult.conflict(c.code(), c.message(), null);
        }
        if (done instanceof Outcome.Refused r) return ClockResult.invalid(r.code(), r.message());
        if (done instanceof Outcome.Uncertain u) return ClockResult.uncertain(u.operationId());
        return ClockResult.unavailable("database-unavailable", "The database could not complete the request.", true);
    }

    private static ObjectNode view(RunContext scope, String stockMode) {
        ObjectNode out = F.objectNode().put("runId", scope.runId());
        ArrayNode faults = out.putArray("faults");
        ObjectNode stock = faults.addObject().put("adapter", STOCK).put("mode", stockMode);
        MODES.forEach(stock.putArray("modes")::add);
        stock.put("available", true);
        faults.addObject().put("adapter", "ordering").put("available", false).put("reason", "not available yet");
        return out;
    }
}
