package gcsp.api.approvals;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of an approvals read or tick; the HTTP slice maps it. Uncertain means inspect, never resubmit blindly. */
public sealed interface ApprovalResult {

    String code();

    String reason();

    boolean retryable();

    record Ok(JsonNode value, boolean replayed) implements ApprovalResult {
        public String code() {
            return replayed ? "replayed" : "ok";
        }

        public String reason() {
            return null;
        }

        public boolean retryable() {
            return false;
        }
    }

    record Invalid(String code, String reason) implements ApprovalResult {
        public boolean retryable() {
            return false;
        }
    }

    record NotFound(String reason) implements ApprovalResult {
        public String code() {
            return "not-found";
        }

        public boolean retryable() {
            return false;
        }
    }

    record Forbidden(String code, String reason) implements ApprovalResult {
        public boolean retryable() {
            return false;
        }
    }

    record Conflict(String code, String reason, boolean retryable) implements ApprovalResult {}

    /** policyWide marks a refusal that affects every order; state is "not-ready" for a selection still in flight. */
    record Unavailable(String code, String reason, boolean retryable, boolean policyWide, String state)
            implements ApprovalResult {}

    record Uncertain(String operationId) implements ApprovalResult {
        public String code() {
            return "outcome-uncertain";
        }

        public String reason() {
            return "The outcome is unknown; inspect it before any resubmit.";
        }

        public boolean retryable() {
            return false;
        }
    }
}
