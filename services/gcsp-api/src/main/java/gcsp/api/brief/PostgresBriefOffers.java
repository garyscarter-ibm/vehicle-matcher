package gcsp.api.brief;

import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import javax.sql.DataSource;

/** The employee's offers from buddy_offers; a read failure is unavailable, never an empty list. */
@ApplicationScoped
public class PostgresBriefOffers implements BriefOfferPort {

    private static final String SQL = "SELECT offer_id, state, brief_version FROM buddy_offers "
            + "WHERE environment_id = ? AND run_id = ? AND employee_id = ? ORDER BY created_at, offer_id";

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    private BooleanSupplier active;
    private Supplier<DataSource> source;

    PostgresBriefOffers() {}

    PostgresBriefOffers(BooleanSupplier active, Supplier<DataSource> source) {
        this.active = active;
        this.source = source;
    }

    @Override
    public List<Offer> offers(String environmentId, String runId, String employeeId) {
        boolean on = active != null ? active.getAsBoolean() : persistence.active();
        if (!on) return List.of();
        try (Connection c = (source != null ? source.get() : dataSource.get()).getConnection();
                PreparedStatement ps = c.prepareStatement(SQL)) {
            ps.setString(1, environmentId);
            ps.setString(2, runId);
            ps.setString(3, employeeId);
            List<Offer> out = new ArrayList<>();
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(new Offer(rs.getString(1), rs.getString(2), rs.getLong(3)));
            }
            return out;
        } catch (SQLException e) {
            throw new PolicyRules.Unavailable("Offers could not be read");
        }
    }
}
