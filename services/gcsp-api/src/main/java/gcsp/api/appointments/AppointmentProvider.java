package gcsp.api.appointments;

import java.time.Instant;

/** The retailer calendar boundary. Calls may throw or time out; the service treats either as an unknown outcome. */
public interface AppointmentProvider {

    /** "synthetic", "live" or "none". */
    String mode();

    SlotOffer offerSlots(Instant now, SlotPolicy policy);

    /** Dispatches on the operation's step: request, confirm, accept or complete. */
    ProviderAnswer write(ProviderOperation operation, Instant now);

    /** What the provider holds for this operation: its stored outcome, or not-found. */
    ProviderAnswer reconcile(ProviderOperation operation);
}
