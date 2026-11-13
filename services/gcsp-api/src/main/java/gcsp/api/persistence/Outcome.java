package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;

/** The typed answer of one command transaction. */
public sealed interface Outcome {

    String code();

    boolean retryable();

    /** Committed (changed) or answered without change; replayed means the stored receipt was returned. */
    record Committed(JsonNode result, long runRevision, boolean replayed, boolean changed) implements Outcome {
        public String code() {
            return replayed ? "replayed" : changed ? "committed" : "unchanged";
        }

        public boolean retryable() {
            return false;
        }
    }

    record Conflict(String code, String message, boolean retryable) implements Outcome {}

    record Refused(String code, String message) implements Outcome {
        public boolean retryable() {
            return false;
        }
    }

    /** Commit outcome unknown; ask TransactionRunner.inspect with the operation id before any resubmit. */
    record Uncertain(String operationId) implements Outcome {
        public String code() {
            return "outcome-uncertain";
        }

        public boolean retryable() {
            return false;
        }
    }

    record Unavailable(String message) implements Outcome {
        public String code() {
            return "database-unavailable";
        }

        public boolean retryable() {
            return true;
        }
    }
}
