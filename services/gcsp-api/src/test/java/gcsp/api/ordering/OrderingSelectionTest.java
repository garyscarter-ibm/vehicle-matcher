package gcsp.api.ordering;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/** The startup rule for the ordering provider: no silent fallback, an unknown name stops startup. */
class OrderingSelectionTest {

    @Test
    void blankMeansNoneAndTheTwoKnownNamesPass() {
        for (String name : new String[] {null, "", "  ", "none"}) assertEquals("none", OrderingSelection.validate(name));
        assertEquals("synthetic", OrderingSelection.validate(" synthetic "));
    }

    @Test
    void anUnknownNameThrows() {
        assertThrows(IllegalStateException.class, () -> OrderingSelection.validate("live"));
        assertThrows(IllegalStateException.class, () -> OrderingSelection.validate("Synthetic"));
    }
}
