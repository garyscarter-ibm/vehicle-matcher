package gcsp.api.appointments;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Ports of Node buildSlots and alternativeAfter (adapters/synthetic-appointments.js), arithmetic unchanged. */
public final class Slots {

    private static final long DAY = 86_400_000L;
    private static final DateTimeFormatter ID = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmm'Z'").withZone(ZoneOffset.UTC);

    private Slots() {}

    /** Slots start earliestLeadDays after the UTC date of now and repeat at the sorted daily times. */
    public static Optional<List<Slot>> build(Instant now, SlotPolicy policy) {
        if (now == null || policy == null || !policy.valid()) return Optional.empty();
        long today = Math.floorDiv(now.toEpochMilli(), DAY) * DAY;
        List<String> starts = policy.dailyStartTimes().stream().sorted().toList();
        List<Slot> slots = new ArrayList<>();
        for (int d = 0; d < policy.daysOffered(); d++) {
            for (String time : starts) {
                slots.add(slotAt(today + (policy.earliestLeadDays() + d) * DAY + clock(time), policy.slotMinutes()));
            }
        }
        return Optional.of(slots);
    }

    /** The next daily start after the slot (the next day's first start when it was the last), from policy alone. */
    public static Optional<Slot> alternativeAfter(Slot slot, SlotPolicy policy) {
        if (slot == null || !slot.valid() || policy == null || !policy.valid()) return Optional.empty();
        long start = Iso.parse(slot.start()).toEpochMilli();
        long day = Math.floorDiv(start, DAY) * DAY;
        List<Long> times = policy.dailyStartTimes().stream().sorted().map(Slots::clock).toList();
        for (long t : times) {
            if (day + t > start) return Optional.of(slotAt(day + t, policy.slotMinutes()));
        }
        return Optional.of(slotAt(day + DAY + times.get(0), policy.slotMinutes()));
    }

    private static Slot slotAt(long startMs, int minutes) {
        Instant start = Instant.ofEpochMilli(startMs);
        return new Slot("slot-" + ID.format(start), Iso.format(start), Iso.format(Instant.ofEpochMilli(startMs + minutes * 60_000L)));
    }

    private static long clock(String hhmm) {
        return (Long.parseLong(hhmm.substring(0, 2)) * 60 + Long.parseLong(hhmm.substring(3, 5))) * 60_000L;
    }
}
