package gcsp.api.appointments;

import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.returns.AppointmentSlot;
import gcsp.api.returns.HandoverPort;
import gcsp.api.returns.HandoverReading;
import gcsp.api.returns.ReturnJson;
import gcsp.api.returns.UnconfiguredHandover;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.util.List;
import java.util.Optional;

/** The new car's handover appointment as returns reads it: stored state only, never a provider call. */
@ApplicationScoped
public class ReturnsHandover implements HandoverPort {

    @Inject
    Persistence persistence;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Override
    public String mode() {
        return persistence.active() ? "appointments" : "none";
    }

    @Override
    public HandoverReading read(RunContext ctx, String orderUuid) {
        if (!persistence.active()) return unavailable();
        try (Connection c = dataSource.get().getConnection()) {
            Optional<AppointmentStore.Row> row = AppointmentStore.row(c, ctx, orderUuid);
            if (row.isEmpty()) return new HandoverReading.NotFound();
            return found(row.get(), AppointmentStore.history(c, ctx, orderUuid));
        } catch (Exception e) {
            return unavailable();
        }
    }

    /** The state verbatim, the confirmed slot (null when absent or unparsable) and the last history reference. */
    static HandoverReading.Found found(AppointmentStore.Row row, List<AppointmentStore.Hist> history) {
        String reference = history.isEmpty() ? null : history.get(history.size() - 1).providerReference();
        return new HandoverReading.Found(row.state(), slot(row.slot()), reference);
    }

    static AppointmentSlot slot(Slot slot) {
        if (slot == null) return null;
        AppointmentSlot s = new AppointmentSlot(slot.slotId(), ReturnJson.parse(slot.start()), ReturnJson.parse(slot.end()));
        return s.valid() ? s : null;
    }

    private static HandoverReading unavailable() {
        return new HandoverReading.Unavailable(UnconfiguredHandover.CODE, true, "Your handover could not be read.");
    }
}
