package gcsp.api.supply;

import java.time.Instant;
import java.util.Map;

/** The run's own dated named times (its clock row); empty when the run has none, so the policy template applies. */
public interface RunCueLookup {

    RunCueLookup NONE = runId -> Map.of();

    /** Named instants of the run's clock. Throws unchecked when they cannot be read. */
    Map<String, Instant> namedTimes(String runId);
}
