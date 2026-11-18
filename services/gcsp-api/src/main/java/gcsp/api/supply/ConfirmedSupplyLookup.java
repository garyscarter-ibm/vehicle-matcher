package gcsp.api.supply;

import java.util.Collection;
import java.util.Map;

/** Read port over the run's confirmed Production supply: one set lookup per pull, never per row. */
public interface ConfirmedSupplyLookup {

    /** A confirmed supply's model line and quantity, as Production confirmed it. */
    record Confirmed(String model, String derivative, int quantity) {}

    /** The confirmed supply among the given ids, keyed by supplyId; unknown ids are absent. Throws unchecked on failure. */
    Map<String, Confirmed> find(String runId, Collection<String> supplyIds);
}
