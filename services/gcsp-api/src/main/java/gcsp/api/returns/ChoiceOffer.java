package gcsp.api.returns;

import java.util.List;

/** What one return choice offers now: its slots, or why none (code is set when a provider offer failed). */
record ChoiceOffer(boolean available, List<AppointmentSlot> slots, String reason, String code) {

    static ChoiceOffer closed(String reason, String code) {
        return new ChoiceOffer(false, List.of(), reason, code);
    }
}
