package gcsp.api.cases;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.Optional;

/** Reads the pinned renewalCase.* policy rows; a bounded read with no provider I/O, as it runs inside commands. */
public interface CasePolicyPort {

    /** The whole assumption rows ({key, value, unit, status, basis, ...}) of exactly this version, or empty. */
    Optional<Map<String, JsonNode>> assumptions(String policyVersion);
}
