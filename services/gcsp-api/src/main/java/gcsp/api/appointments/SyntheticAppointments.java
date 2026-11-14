package gcsp.api.appointments;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.RunContext;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;
import javax.sql.DataSource;

/**
 * Explicitly synthetic: every outcome is fictional, derived from the operation and recorded once per operation id in
 * synthetic_appointment_receipts, over its own connection and outside the service's transaction.
 */
public final class SyntheticAppointments implements AppointmentProvider {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ProviderAnswer.Unsupported INVALID =
            new ProviderAnswer.Unsupported("invalid-appointment-operation", "invalid-appointment-operation");
    private static final String INSERT = "INSERT INTO synthetic_appointment_receipts "
            + "(environment_id, run_id, operation_id, input_digest, outcome) VALUES (?, ?, ?, ?, ?::jsonb) "
            + "ON CONFLICT (environment_id, run_id, operation_id) DO NOTHING";
    private static final String SELECT = "SELECT input_digest, outcome::text FROM synthetic_appointment_receipts "
            + "WHERE environment_id = ? AND run_id = ? AND operation_id = ?";

    private final DataSource dataSource;

    public SyntheticAppointments(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public String mode() {
        return "synthetic";
    }

    @Override
    public SlotOffer offerSlots(Instant now, SlotPolicy policy) {
        return Slots.build(now, policy).<SlotOffer>map(SlotOffer.Offered::new)
                .orElseGet(() -> new SlotOffer.Unsupported("invalid-slot-policy", "invalid-slot-policy"));
    }

    @Override
    public ProviderAnswer write(ProviderOperation op, Instant now) {
        if (op == null || !op.valid()) return INVALID;
        JsonNode p = op.payload();
        return switch (op.step()) {
            case "request" -> {
                Instant at = Iso.parse(p.path("requestedAt").asText(null));
                yield at == null ? INVALID : record(op, new ProviderAnswer.Accepted(op.operationId(), op.orderUuid(),
                        "request", op.slot(), reference(op), at));
            }
            case "confirm" -> confirm(op, now);
            case "accept" -> {
                Instant at = Iso.parse(p.path("acceptedAt").asText(null));
                Slot proposed = Slot.fromJson(p.get("proposedSlot"));
                yield at == null || proposed == null ? INVALID : record(op, new ProviderAnswer.Scheduled(op.operationId(),
                        op.orderUuid(), "accept", proposed, reference(op), at));
            }
            default -> {
                Instant at = Iso.parse(p.path("completedAt").asText(null));
                yield at == null ? INVALID : record(op, new ProviderAnswer.Completed(op.operationId(), op.orderUuid(),
                        "complete", op.slot(), reference(op), at));
            }
        };
    }

    /** Before confirmAfter nothing is recorded; afterwards the pinned scenario schedules or proposes, once. */
    private ProviderAnswer confirm(ProviderOperation op, Instant now) {
        JsonNode p = op.payload();
        Instant after = Iso.parse(p.path("confirmAfter").asText(null));
        if (after == null || now == null) return INVALID;
        if (now.isBefore(after)) return new ProviderAnswer.InProgress(op.operationId(), op.orderUuid(), "confirm");
        boolean propose = p.path("scenario").path("proposeChange").isBoolean() && p.get("scenario").get("proposeChange").asBoolean();
        if (!propose) {
            return record(op, new ProviderAnswer.Scheduled(op.operationId(), op.orderUuid(), "confirm", op.slot(),
                    reference(op), now));
        }
        Optional<Slot> alternative = Slots.alternativeAfter(op.slot(), SlotPolicy.fromJson(p.get("slotPolicy")));
        if (alternative.isEmpty()) return INVALID;
        JsonNode reason = p.path("scenario").path("proposalReason");
        return record(op, new ProviderAnswer.Proposed(op.operationId(), op.orderUuid(), "confirm", op.slot(),
                reference(op), now, alternative.get(), reference(op), reason.isTextual() ? reason.asText() : null));
    }

    /** The stored outcome for this operation, not-found when never received, or conflict if its input changed. */
    @Override
    public ProviderAnswer reconcile(ProviderOperation op) {
        if (op == null || !op.valid()) return INVALID;
        try (Connection c = dataSource.getConnection()) {
            Stored found = read(c, op);
            if (found == null) return new ProviderAnswer.NotFound(op.operationId(), op.orderUuid(), op.step());
            return found.digest.equals(op.inputDigest()) ? AnswerJson.fromJson(found.outcome)
                    : new ProviderAnswer.Conflict("idempotency-input-changed");
        } catch (SQLException | java.io.IOException e) {
            throw new IllegalStateException("Synthetic appointment receipts are unreadable", e);
        }
    }

    private record Stored(String digest, JsonNode outcome) {}

    /** Records the answer once per operation id; a replay with the same digest returns what was stored first. */
    private ProviderAnswer record(ProviderOperation op, ProviderAnswer answer) {
        RunContext ctx = op.context();
        try (Connection c = dataSource.getConnection()) {
            try (PreparedStatement ps = c.prepareStatement(INSERT)) {
                ps.setString(1, ctx.environmentId());
                ps.setString(2, ctx.runId());
                ps.setString(3, op.operationId());
                ps.setString(4, op.inputDigest());
                ps.setString(5, AnswerJson.toJson(answer).toString());
                ps.executeUpdate();
            }
            Stored stored = read(c, op);
            if (stored == null) throw new IllegalStateException("Synthetic appointment receipt was not stored");
            return stored.digest.equals(op.inputDigest()) ? AnswerJson.fromJson(stored.outcome)
                    : new ProviderAnswer.Conflict("idempotency-input-changed");
        } catch (SQLException | java.io.IOException e) {
            throw new IllegalStateException("Synthetic appointment receipts are unwritable", e);
        }
    }

    private static Stored read(Connection c, ProviderOperation op) throws SQLException, java.io.IOException {
        try (PreparedStatement ps = c.prepareStatement(SELECT)) {
            ps.setString(1, op.context().environmentId());
            ps.setString(2, op.context().runId());
            ps.setString(3, op.operationId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new Stored(rs.getString(1), JSON.readTree(rs.getString(2))) : null;
            }
        }
    }

    /** SYN-APT- plus the first 12 hex of the digest of ["synthetic-appointment", operationId], upper case. */
    static String reference(ProviderOperation op) {
        return reference(op.operationId());
    }

    static String reference(String operationId) {
        ArrayNode key = JSON.createArrayNode().add("synthetic-appointment").add(operationId);
        return "SYN-APT-" + Canonical.digest(key).substring(0, 12).toUpperCase();
    }
}
