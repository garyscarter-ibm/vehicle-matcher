package gcsp.api.appointments;

import java.time.Instant;

/** Live-shaped boundary: no retailer calendar is reachable, so every call is refused and nothing is written. */
public final class LiveAppointmentsStub implements AppointmentProvider {

    public static final String CODE = "live-appointments-unsupported";
    public static final String REASON = "Live appointment booking is not connected yet. The appointment stays as it is.";

    @Override
    public String mode() {
        return "live";
    }

    @Override
    public SlotOffer offerSlots(Instant now, SlotPolicy policy) {
        return new SlotOffer.Unsupported(CODE, REASON);
    }

    @Override
    public ProviderAnswer write(ProviderOperation operation, Instant now) {
        return new ProviderAnswer.Unsupported(CODE, REASON);
    }

    @Override
    public ProviderAnswer reconcile(ProviderOperation operation) {
        return new ProviderAnswer.Unsupported(CODE, REASON);
    }
}
