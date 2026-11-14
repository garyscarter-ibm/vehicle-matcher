package gcsp.api.documents;

import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.Optional;

/** A mock of the shared test clock that answers from the real run clock, for tests that tick through the API. */
public final class RunClockBackedTestClock extends DocumentsTestPorts.Clock {

    private final DocumentClock real;

    public RunClockBackedTestClock(DocumentClock real) {
        this.real = real;
    }

    @Override
    public Optional<Instant> now(RunContext ctx) {
        return real.now(ctx);
    }
}
