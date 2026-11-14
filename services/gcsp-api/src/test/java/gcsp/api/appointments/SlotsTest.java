package gcsp.api.appointments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class SlotsTest {

    static final SlotPolicy SEED = new SlotPolicy(2, 3, 60, List.of("09:00", "13:00"));
    static final Instant NOW = Instant.parse("2026-11-05T10:30:00.000Z");

    @Test
    void buildsSixSlotsFromTheUtcDayOfNow() {
        List<Slot> slots = Slots.build(NOW, SEED).orElseThrow();
        assertEquals(6, slots.size());
        assertEquals(new Slot("slot-20261107T0900Z", "2026-11-07T09:00:00.000Z", "2026-11-07T10:00:00.000Z"), slots.get(0));
        assertEquals(new Slot("slot-20261107T1300Z", "2026-11-07T13:00:00.000Z", "2026-11-07T14:00:00.000Z"), slots.get(1));
        assertEquals("slot-20261109T1300Z", slots.get(5).slotId());
    }

    @Test
    void timesAreSortedAndSlotLengthApplies() {
        List<Slot> slots = Slots.build(NOW, new SlotPolicy(0, 1, 90, List.of("13:00", "09:00"))).orElseThrow();
        assertEquals("slot-20261105T0900Z", slots.get(0).slotId());
        assertEquals("2026-11-05T10:30:00.000Z", slots.get(0).end());
        assertEquals("slot-20261105T1300Z", slots.get(1).slotId());
    }

    @Test
    void invalidInputsGiveNothing() {
        assertTrue(Slots.build(null, SEED).isEmpty());
        assertTrue(Slots.build(NOW, null).isEmpty());
        assertTrue(Slots.build(NOW, new SlotPolicy(0, 0, 60, List.of("09:00"))).isEmpty());
        assertTrue(Slots.build(NOW, new SlotPolicy(0, 1, 0, List.of("09:00"))).isEmpty());
        assertTrue(Slots.build(NOW, new SlotPolicy(-1, 1, 60, List.of("09:00"))).isEmpty());
        assertTrue(Slots.build(NOW, new SlotPolicy(0, 1, 60, List.of())).isEmpty());
        assertTrue(Slots.build(NOW, new SlotPolicy(0, 1, 60, List.of("9:00"))).isEmpty());
    }

    @Test
    void alternativeAfterTheLastSlotOfTheDayIsNextDaysFirst() {
        Slot thirteen = new Slot("slot-20261107T1300Z", "2026-11-07T13:00:00.000Z", "2026-11-07T14:00:00.000Z");
        assertEquals(new Slot("slot-20261108T0900Z", "2026-11-08T09:00:00.000Z", "2026-11-08T10:00:00.000Z"),
                Slots.alternativeAfter(thirteen, SEED).orElseThrow());
    }

    @Test
    void alternativeAfterTheFirstSlotIsTheNextTimeSameDay() {
        Slot nine = new Slot("slot-20261107T0900Z", "2026-11-07T09:00:00.000Z", "2026-11-07T10:00:00.000Z");
        assertEquals("slot-20261107T1300Z", Slots.alternativeAfter(nine, SEED).orElseThrow().slotId());
        assertTrue(Slots.alternativeAfter(new Slot("", "x", "y"), SEED).isEmpty());
        assertTrue(Slots.alternativeAfter(nine, new SlotPolicy(0, 1, 60, List.of())).isEmpty());
    }
}
