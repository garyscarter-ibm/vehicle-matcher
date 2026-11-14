package gcsp.api.appointments;

import java.time.Instant;

/** No provider is wired (mode none): every call is unavailable, and nothing falls back to the synthetic one. */
public final class UnconfiguredAppointments implements AppointmentProvider {

    @Override
    public String mode() {
        return "none";
    }

    @Override
    public SlotOffer offerSlots(Instant now, SlotPolicy policy) {
        return new SlotOffer.Unavailable();
    }

    @Override
    public ProviderAnswer write(ProviderOperation operation, Instant now) {
        return new ProviderAnswer.Unknown();
    }

    @Override
    public ProviderAnswer reconcile(ProviderOperation operation) {
        return new ProviderAnswer.Unknown();
    }
}
