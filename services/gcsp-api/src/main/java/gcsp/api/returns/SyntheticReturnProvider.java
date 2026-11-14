package gcsp.api.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import gcsp.api.persistence.Canonical;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import javax.sql.DataSource;
import org.postgresql.util.PGobject;

/**
 * The deterministic synthetic provider (ports synthetic-appointments.js and synthetic-return-outcomes.js). Every
 * answer is fictional, derived from the operation, and receipted once per operation id in its own short transaction.
 */
public final class SyntheticReturnProvider implements ReturnProviderPort {

    public static final String INVALID = "invalid-return-operation";
    public static final String UNAVAILABLE_CODE = "return-provider-unavailable";
    private static final long DAY_MS = 86_400_000L;

    private final DataSource dataSource;

    public SyntheticReturnProvider(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @Override
    public String mode() {
        return "synthetic";
    }

    @Override
    public Offer offerSlots(SlotPolicy policy, Instant now) {
        List<AppointmentSlot> slots = policy == null || now == null ? null : buildSlots(policy, now);
        return slots == null
                ? new Offer(Status.UNSUPPORTED, List.of(), "invalid-slot-policy", "invalid-slot-policy", true)
                : new Offer(Status.OK, slots, null, null, true);
    }

    /** Slots start earliestLeadDays after the demo-clock date and repeat at the keyed UTC times (buildSlots). */
    public static List<AppointmentSlot> buildSlots(SlotPolicy policy, Instant now) {
        if (!policy.usable()) return null;
        long today = Math.floorDiv(now.toEpochMilli(), DAY_MS) * DAY_MS;
        List<String> starts = policy.dailyStartTimes().stream().sorted().toList();
        List<AppointmentSlot> slots = new ArrayList<>();
        for (int d = 0; d < policy.daysOffered(); d++) {
            for (String time : starts) {
                slots.add(slotAt(today + (policy.earliestLeadDays() + d) * DAY_MS + clock(time), policy.slotMinutes()));
            }
        }
        return slots;
    }

    /** The next daily start after the requested slot, or the next day's first start when it was the last. */
    public static AppointmentSlot alternativeAfter(AppointmentSlot slot, SlotPolicy policy) {
        if (slot == null || !slot.valid() || policy == null || !policy.usable()) return null;
        long start = slot.start().toEpochMilli();
        long day = Math.floorDiv(start, DAY_MS) * DAY_MS;
        List<Long> times = policy.dailyStartTimes().stream().sorted().map(SyntheticReturnProvider::clock).toList();
        for (long t : times) {
            if (day + t > start) return slotAt(day + t, policy.slotMinutes());
        }
        return slotAt(day + DAY_MS + times.get(0), policy.slotMinutes());
    }

    private static long clock(String hhmm) {
        return (Integer.parseInt(hhmm.substring(0, 2)) * 60L + Integer.parseInt(hhmm.substring(3, 5))) * 60_000L;
    }

    private static AppointmentSlot slotAt(long startMs, int minutes) {
        Instant start = Instant.ofEpochMilli(startMs);
        String stamp = java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmm'Z'")
                .withZone(java.time.ZoneOffset.UTC).format(start);
        return new AppointmentSlot("slot-" + stamp, start, start.plus(Duration.ofMinutes(minutes)));
    }

    @Override
    public Result requestSlot(Operation op) {
        if (!valid(op, STEP_REQUEST) || at(op.payload(), "requestedAt") == null) return invalid(op);
        Instant at = at(op.payload(), "requestedAt");
        return record(op, base(op, Status.ACCEPTED, at, op.slot(), null, null, null));
    }

    @Override
    public Result confirm(Operation op, Instant now) {
        if (!valid(op, STEP_CONFIRM) || at(op.payload(), "confirmAfter") == null || now == null) return invalid(op);
        if (now.isBefore(at(op.payload(), "confirmAfter"))) {
            return base(op, Status.IN_PROGRESS, null, null, null, null, null);
        }
        JsonNode scenario = op.payload().path("scenario");
        if (scenario.path("proposeChange").asBoolean(false)) {
            AppointmentSlot proposed = alternativeAfter(op.slot(), SlotPolicy.fromJson(op.payload().get("slotPolicy")));
            if (proposed == null) return invalid(op);
            String reason = scenario.path("proposalReason").asText(null);
            Result r = base(op, Status.PROPOSED, now, op.slot(), proposed, reference(op), reason);
            return record(op, r);
        }
        return record(op, base(op, Status.SCHEDULED, now, op.slot(), null, null, null));
    }

    @Override
    public Result acceptProposal(Operation op) {
        AppointmentSlot proposed = op == null || op.payload() == null ? null : AppointmentSlot.fromJson(op.payload().get("proposedSlot"));
        if (!valid(op, STEP_ACCEPT) || at(op.payload(), "acceptedAt") == null || proposed == null) return invalid(op);
        return record(op, base(op, Status.SCHEDULED, at(op.payload(), "acceptedAt"), proposed, null, null, null));
    }

    @Override
    public Result confirmOutcome(Operation op, Instant now) {
        String outcome = op == null || op.payload() == null ? null : op.payload().path("outcome").asText(null);
        if (!valid(op, STEP_OUTCOME) || at(op.payload(), "confirmAfter") == null || now == null
                || !("returned".equals(outcome) || "missed".equals(outcome))) {
            return invalid(op);
        }
        if (now.isBefore(at(op.payload(), "confirmAfter"))) {
            return base(op, Status.IN_PROGRESS, null, null, null, null, null);
        }
        Status status = "returned".equals(outcome) ? Status.RETURNED : Status.MISSED;
        return record(op, base(op, status, now, op.slot(), null, null, null));
    }

    /** The stored answer for this operation, not-found when the provider never received it, conflict if its input changed. */
    @Override
    public Result reconcile(Operation op) {
        if (op == null || !ReturnJson.text(op.operationId(), 128) || !ReturnJson.text(op.runId(), 128)
                || !ReturnJson.text(op.environmentId(), 128) || !ReturnJson.text(op.inputDigest(), 64)) {
            return invalid(op);
        }
        try (Connection c = dataSource.getConnection()) {
            Stored stored = read(c, op);
            if (stored == null) return base(op, Status.NOT_FOUND, null, null, null, null, null);
            return stored.digest().equals(op.inputDigest()) ? stored.result() : changed(op);
        } catch (SQLException e) {
            return unavailable(op);
        }
    }

    private boolean valid(Operation op, String step) {
        return op != null && step.equals(op.step()) && ReturnJson.text(op.operationId(), 128)
                && ReturnJson.text(op.runId(), 128) && ReturnJson.text(op.environmentId(), 128)
                && ReturnJson.text(op.orderUuid(), 128) && op.slot() != null && op.slot().valid()
                && op.payload() != null && op.inputDigest() != null && op.inputDigest().matches("^[0-9a-f]{64}$");
    }

    private static Instant at(JsonNode payload, String field) {
        return payload == null ? null : ReturnJson.parse(payload.path(field).asText(null));
    }

    /** SYN-APT- for appointment steps and SYN-RET- for the outcome, over the sha-256 of ["synthetic-...", operationId]. */
    static String reference(Operation op) {
        boolean outcome = STEP_OUTCOME.equals(op.step());
        ArrayNode in = ReturnJson.JSON.createArrayNode().add(outcome ? "synthetic-return-outcome" : "synthetic-appointment")
                .add(op.operationId());
        return (outcome ? "SYN-RET-" : "SYN-APT-") + Canonical.digest(in).substring(0, 12).toUpperCase(Locale.ROOT);
    }

    private static Result base(Operation op, Status status, Instant at, AppointmentSlot slot, AppointmentSlot proposed,
            String proposalId, String reason) {
        boolean answered = status != Status.IN_PROGRESS && status != Status.NOT_FOUND;
        return new Result(status, op.operationId(), op.orderUuid(), op.step(), slot, proposed, proposalId,
                answered ? reference(op) : null, at, null, reason, true);
    }

    private static Result invalid(Operation op) {
        return new Result(Status.UNSUPPORTED, op == null ? null : op.operationId(), op == null ? null : op.orderUuid(),
                op == null ? null : op.step(), null, null, null, null, null, INVALID, INVALID, true);
    }

    private static Result changed(Operation op) {
        return new Result(Status.CONFLICT, op.operationId(), op.orderUuid(), op.step(), null, null, null, null, null,
                "idempotency-input-changed", "This operation was already received with different input.", true);
    }

    private static Result unavailable(Operation op) {
        return new Result(Status.UNAVAILABLE, op.operationId(), op.orderUuid(), op.step(), null, null, null, null, null,
                UNAVAILABLE_CODE, "The synthetic provider could not record the call.", true);
    }

    private record Stored(String digest, Result result) {}

    private static final String READ = "SELECT input_digest, response::text FROM return_provider_receipts "
            + "WHERE environment_id = ? AND run_id = ? AND operation_id = ?";

    private static Stored read(Connection c, Operation op) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(READ)) {
            ps.setString(1, op.environmentId());
            ps.setString(2, op.runId());
            ps.setString(3, op.operationId());
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                try {
                    Result r = Result.fromJson(ReturnJson.JSON.readTree(rs.getString(2)));
                    if (r == null) throw new SQLException("Stored provider receipt is unreadable");
                    return new Stored(rs.getString(1), r);
                } catch (java.io.IOException e) {
                    throw new SQLException("Stored provider receipt is unreadable");
                }
            }
        }
    }

    /** Receipts the answer once: a repeat gets the stored response, a changed digest a conflict. */
    private Result record(Operation op, Result answer) {
        try (Connection c = dataSource.getConnection()) {
            c.setAutoCommit(false);
            try {
                Stored prior = read(c, op);
                if (prior == null) {
                    PGobject json = new PGobject();
                    json.setType("jsonb");
                    json.setValue(answer.toJson().toString());
                    try (PreparedStatement ps = c.prepareStatement("INSERT INTO return_provider_receipts (environment_id, "
                            + "run_id, operation_id, step, input_digest, response) VALUES (?, ?, ?, ?, ?, ?) "
                            + "ON CONFLICT DO NOTHING")) {
                        ps.setString(1, op.environmentId());
                        ps.setString(2, op.runId());
                        ps.setString(3, op.operationId());
                        ps.setString(4, op.step());
                        ps.setString(5, op.inputDigest());
                        ps.setObject(6, json);
                        if (ps.executeUpdate() == 1) {
                            c.commit();
                            return answer;
                        }
                    }
                    prior = read(c, op);
                    if (prior == null) throw new SQLException("Provider receipt vanished");
                }
                c.rollback();
                return prior.digest().equals(op.inputDigest()) ? prior.result() : changed(op);
            } catch (SQLException e) {
                c.rollback();
                throw e;
            }
        } catch (SQLException e) {
            return unavailable(op);
        }
    }
}
