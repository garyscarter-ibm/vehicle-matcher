package gcsp.api.supply;

import java.time.Instant;

/** Port to the central policy: release size, lead time and the stock source's maximum age. */
public interface ReleasePolicy {

    PolicyReading read(String runId, Instant asOf);
}
