package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

/** Reads whole assumption entries at one pinned policy version; FUCQ-457's PolicyService will implement it. */
public interface ApprovalPolicyPort {

    Read entries(String policyVersion, List<String> keys);

    sealed interface Read {}

    /** The entries that exist at the version, keyed by assumption key; a requested key may be absent. */
    record Found(String policyVersion, Map<String, JsonNode> entries) implements Read {}

    record VersionNotFound() implements Read {}

    /** The source itself failed (for example policy-source-unavailable or policy-source-invalid). */
    record Unavailable(String code) implements Read {}
}
