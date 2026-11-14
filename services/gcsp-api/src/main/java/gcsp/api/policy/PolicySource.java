package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** Supplies the retained policy versions. PolicyService validates and snapshots whatever it returns. */
public interface PolicySource {

    List<JsonNode> loadVersions(String runId) throws PolicySourceException;

    /** Drops anything cached for the run; the next load re-checks the store. */
    default void invalidate(String runId) {
    }
}
