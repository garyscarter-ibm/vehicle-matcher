package gcsp.api.learning;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

/** The default profile resolves the service with the unbound outcome port and the wall clock; persistence is off. */
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
        assertFalse(outcomes.bound());
        assertEquals("wall-clock", clock.now(new gcsp.api.persistence.RunContext("e", "r", "a")).clockVersion());
        assertEquals("forbidden", service.readRecords(LearningDb.employee()).status());
    }
}
