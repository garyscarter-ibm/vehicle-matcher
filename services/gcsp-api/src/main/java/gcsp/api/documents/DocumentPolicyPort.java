package gcsp.api.documents;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Optional;

/** One policy assumption by key at a pinned version; the Java PolicyService (FUCQ-457) implements it. */
public interface DocumentPolicyPort {

    record Assumption(String key, JsonNode value, String unit, String status, String basis, String source,
            String sourceDate, String policyVersion) {}

    /** Empty when the key or version is unavailable; callers never substitute a default. */
    Optional<Assumption> assumption(String key, String policyVersion);
}
