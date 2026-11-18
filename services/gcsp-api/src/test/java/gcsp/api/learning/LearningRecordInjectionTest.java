package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** The production record source is bound; a missing run clock is unavailable when persistence is off. */
@QuarkusTest
class LearningRecordInjectionTest {

    @Inject
    LearningRecordService service;

    @Inject
    LearningOutcomeRows outcomes;

    @Inject
    LearningClock clock;

    @Test
    void defaultBeansResolve() {
        assertTrue(outcomes.bound());
        assertNull(clock.now(new gcsp.api.persistence.RunContext("e", "r", "a")));
        assertEquals("forbidden", service.readRecords(LearningDb.employee()).status());
    }
}
