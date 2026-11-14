package gcsp.api.appointments;

import java.util.List;

/** The provider's answer to "which slots can be requested now". */
public sealed interface SlotOffer {

    record Offered(List<Slot> slots) implements SlotOffer {
        public Offered {
            slots = List.copyOf(slots);
        }
    }

    record Unsupported(String code, String reason) implements SlotOffer {}

    record Unavailable() implements SlotOffer {}
}
