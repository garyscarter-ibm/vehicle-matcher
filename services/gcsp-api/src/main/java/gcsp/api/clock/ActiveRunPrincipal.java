package gcsp.api.clock;

import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.sql.DataSource;

/** Moves a principal whose configured run was reset onto the active run; an unknown run id stays as it is. */
@ApplicationScoped
public class ActiveRunPrincipal {

    private static final String READ = "SELECT (SELECT run_id FROM runs WHERE environment_id = ? AND status = 'active'), "
            + "EXISTS (SELECT 1 FROM runs WHERE environment_id = ? AND run_id = ?)";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    public Principal bind(Principal p) {
        return persistence.active() ? bind(p, dataSource.get()) : p;
    }

    public Principal bind(Principal p, DataSource source) {
        if (p.runId() == null || p.runId().isBlank() || p.environmentId() == null) return p;
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(READ)) {
            ps.setString(1, p.environmentId());
            ps.setString(2, p.environmentId());
            ps.setString(3, p.runId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return p;
                String active = rs.getString(1);
                if (active == null || active.equals(p.runId()) || !rs.getBoolean(2)) return p;
                return new Principal(p.subject(), p.roles(), p.environmentId(), active, p.employeeId(),
                        p.policyVersion(), p.capabilities());
            }
        } catch (java.sql.SQLException | RuntimeException e) {
            return p;
        }
    }
}
