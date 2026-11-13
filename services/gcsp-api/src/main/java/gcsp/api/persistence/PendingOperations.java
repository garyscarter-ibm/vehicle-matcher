package gcsp.api.persistence;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.SQLException;
import java.util.Set;

/**
 * External I/O custody: record intent in one command, call the provider outside any transaction, then finalize in
 * a second command by version CAS (design doc, "External I/O"). A duplicate or late acknowledgement is stale-version.
 */
public final class PendingOperations {

    private static final Set<String> FINAL_STATES = Set.of("pending", "acknowledged", "refused");

    private PendingOperations() {}

    /** Inserts the durable intent at version 1; the unique idempotency key stops a second intent for the same call. */
    public static void recordIntent(Tx tx, String operationId, String type, String idempotencyKey, JsonNode input)
            throws SQLException {
        RunContext c = tx.context();
        tx.write("INSERT INTO pending_operations (environment_id, run_id, operation_id, operation_type, "
                + "idempotency_key, input_digest, state) VALUES (?, ?, ?, ?, ?, ?, 'intent')",
                c.environmentId(), c.runId(), operationId, type, idempotencyKey, Canonical.digest(input));
    }

    /** Moves an open operation to pending, acknowledged or refused only if its version is still the one read. */
    public static void finalize(Tx tx, String operationId, long expectedVersion, String newState,
            String providerReference, JsonNode outcome) throws SQLException {
        if (!FINAL_STATES.contains(newState)) throw new IllegalArgumentException("Not a finalizing state");
        RunContext c = tx.context();
        tx.cas("UPDATE pending_operations SET state = ?, provider_reference = ?, outcome = ?, "
                + "attempts = attempts + 1, version = version + 1, updated_at = now() "
                + "WHERE environment_id = ? AND run_id = ? AND operation_id = ? AND version = ? "
                + "AND state IN ('intent', 'pending')",
                newState, providerReference, outcome, c.environmentId(), c.runId(), operationId, expectedVersion);
    }

    /** A timeout or malformed acknowledgement: stays open (and any hold keeps occupying) for a later retry. */
    public static void markPending(Tx tx, String operationId, long expectedVersion, JsonNode outcome)
            throws SQLException {
        finalize(tx, operationId, expectedVersion, "pending", null, outcome);
    }

    public static long version(Tx tx, String operationId) throws SQLException {
        RunContext c = tx.context();
        return tx.first("SELECT version FROM pending_operations WHERE environment_id = ? AND run_id = ? "
                + "AND operation_id = ?", rs -> rs.getLong(1), c.environmentId(), c.runId(), operationId)
                .orElseThrow(() -> new TxConflict("operation-not-found", "No such operation"));
    }
}
