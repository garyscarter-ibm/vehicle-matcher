package gcsp.api.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import javax.sql.DataSource;
import org.jboss.logging.Logger;

/**
 * Delivers pending notification intents (outbox rows) one bounded drain at a time. Every state change is a
 * TransactionRunner command with a version CAS, so competing instances deliver each attempt once.
 */
public final class NotificationDispatcher {

    static final String ACTOR = "notification-dispatcher";
    static final Duration LEASE = Duration.ofSeconds(60);
    static final int BATCH = 100;

    private static final Logger LOG = Logger.getLogger(NotificationDispatcher.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final String DUE_SQL = "SELECT o.event_id, o.payload::text, d.state, coalesce(d.attempts, 0), "
            + "coalesce(d.version, 0) FROM outbox_events o LEFT JOIN notification_deliveries d "
            + "ON d.environment_id = o.environment_id AND d.run_id = o.run_id AND d.event_id = o.event_id "
            + "WHERE o.environment_id = ? AND o.run_id = ? AND o.state = 'pending' AND o.event_type LIKE 'notification.%' "
            + "AND (d.event_id IS NULL OR (d.state = 'retrying' AND d.next_attempt_at <= ?) "
            + "OR (d.state = 'sending' AND d.attempted_at <= ?)) ORDER BY o.created_at, o.event_id LIMIT " + BATCH;

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final DeliveryRules rules;
    private final OfferFacts facts;
    private final MailTransport transport;
    private final InstantSource clock;
    private final String environmentId;
    private final Optional<URI> base;

    public NotificationDispatcher(DataSource dataSource, DeliveryRules rules, OfferFacts facts, MailTransport transport,
            InstantSource clock, String environmentId, Optional<String> publicBaseUrl) {
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.rules = rules;
        this.facts = facts;
        this.transport = transport;
        this.clock = clock;
        this.environmentId = environmentId;
        this.base = publicBaseUrl.map(v -> PublicBase.parse(v).orElseThrow(
                () -> new IllegalArgumentException("The public base URL is not a valid public https URL")));
    }

    private record Candidate(String eventId, JsonNode payload, int attempts) {}

    private record Delivery(String state, int attempts, long version, Instant attemptedAt, Instant nextAttemptAt,
            JsonNode message) {}

    private record Prepared(String recipient, String name, OfferFacts.Offer offer) {}

    private record Failure(String code, boolean retryable) {}

    private enum Flow { NEXT, STALE, UNAVAILABLE }

    public DispatchResult dispatchPending() {
        try {
            Optional<String> runId = activeRun();
            if (runId.isEmpty()) return new DispatchResult.Unavailable();
            Instant now = clock.instant();
            if (!(rules.read(runId.get(), now) instanceof DeliveryRules.Rules r) || !r.valid()) {
                return new DispatchResult.Unavailable();
            }
            RunContext ctx = new RunContext(environmentId, runId.get(), ACTOR);
            int[] counts = new int[3];
            for (Candidate candidate : due(ctx, now)) {
                Flow flow = attempt(ctx, r, now, candidate, counts);
                if (flow == Flow.STALE) return new DispatchResult.StaleRun();
                if (flow == Flow.UNAVAILABLE) return new DispatchResult.Unavailable();
            }
            return new DispatchResult.Counts(counts[0], counts[1], counts[2]);
        } catch (SQLException e) {
            return new DispatchResult.Unavailable();
        }
    }

    private Optional<String> activeRun() throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement(
                        "SELECT run_id FROM runs WHERE environment_id = ? AND status = 'active'")) {
            ps.setString(1, environmentId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.of(rs.getString(1)) : Optional.empty();
            }
        }
    }

    private List<Candidate> due(RunContext ctx, Instant now) throws SQLException {
        List<Candidate> out = new ArrayList<>();
        try (Connection c = dataSource.getConnection(); PreparedStatement ps = c.prepareStatement(DUE_SQL)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setObject(3, now.atOffset(java.time.ZoneOffset.UTC));
            ps.setObject(4, now.minus(LEASE).atOffset(java.time.ZoneOffset.UTC));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    out.add(new Candidate(rs.getString(1), readJson(rs.getString(2)), rs.getInt(4)));
                }
            }
        }
        return out;
    }

    private Flow attempt(RunContext ctx, DeliveryRules.Rules rule, Instant now, Candidate cand, int[] counts)
            throws SQLException {
        int attemptNo = cand.attempts() + 1;
        Outcome claim = runner.execute(ctx, command("notify.claim", "attempt", cand.eventId(), attemptNo, null),
                tx -> claimWork(tx, cand, attemptNo, now));
        Flow stop = stopFlow(claim);
        if (stop != null) return stop;
        if (!(claim instanceof Outcome.Committed c) || !c.changed() || c.replayed() || c.result().path("version").isMissingNode()) {
            return Flow.NEXT;
        }
        long version = c.result().path("version").asLong();

        Delivery current = readDelivery(ctx, cand.eventId());
        if (current == null || !"sending".equals(current.state()) || current.attempts() != attemptNo
                || current.version() != version) {
            return Flow.NEXT;
        }

        // A confirmed provider acknowledgement wins even if the offer expired since.
        boolean accepted = false;
        try {
            accepted = transport.alreadyAccepted(ctx, cand.eventId());
        } catch (Exception e) {
            return finishFailed(ctx, rule, cand, attemptNo, version, now,
                    new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, true), counts);
        }
        if (accepted) return finishSent(ctx, cand, attemptNo, version, now, counts);

        Failure failure = null;
        OfferMessage message = null;
        Object prepared = prepare(ctx, cand, now);
        if (prepared instanceof Failure f) {
            failure = f;
        } else if (current.message() != null) {
            message = OfferMessage.fromJson(current.message());
        } else {
            OfferMessage rendered = renderFor((Prepared) prepared, cand, now);
            if (rendered == null) {
                failure = new Failure("message-invalid", false);
            } else {
                message = rendered;
                long expected = version;
                Outcome saved = runner.execute(ctx, command("notify.prepare", "prepare", cand.eventId(), attemptNo, null),
                        tx -> {
                            tx.cas("UPDATE notification_deliveries SET message = ?, version = version + 1, updated_at = ? "
                                    + "WHERE environment_id = ? AND run_id = ? AND event_id = ? AND version = ? "
                                    + "AND state = 'sending' AND attempts = ?", rendered.toJson(), now,
                                    ctx.environmentId(), ctx.runId(), cand.eventId(), expected, attemptNo);
                            return WorkResult.ok(JSON.createObjectNode().put("version", expected + 1));
                        });
                stop = stopFlow(saved);
                if (stop != null) return stop;
                if (!(saved instanceof Outcome.Committed sc) || !sc.changed() || sc.replayed()) return Flow.NEXT;
                version = expected + 1;
            }
        }

        if (failure == null) {
            DeliveryAttempt delivery = new DeliveryAttempt(cand.eventId(), attemptNo,
                    cand.payload().path("recipientEmployeeId").asText(null));
            failure = new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
            try {
                MailTransport.Result sent = transport.send(ctx, delivery, message);
                if (sent instanceof MailTransport.StaleRun) return Flow.STALE;
                if (sent instanceof MailTransport.Accepted) failure = null;
                else if (sent instanceof MailTransport.Failed f) {
                    failure = MailFailureCodes.TRANSPORT.contains(f.code())
                            ? new Failure(f.code(), f.retryable())
                            : new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, f.retryable());
                }
            } catch (Exception e) {
                // Exception text is never kept or logged; the attempt is simply retryable.
            }
        }
        return failure == null
                ? finishSent(ctx, cand, attemptNo, version, now, counts)
                : finishFailed(ctx, rule, cand, attemptNo, version, now, failure, counts);
    }

    private WorkResult claimWork(Tx tx, Candidate cand, int attemptNo, Instant now) throws SQLException {
        RunContext ctx = tx.context();
        Delivery row = readDelivery(tx.connection(), ctx, cand.eventId());
        ObjectNode result = JSON.createObjectNode();
        if (row == null) {
            if (attemptNo != 1) return WorkResult.ok(result);
            int rows = tx.write("INSERT INTO notification_deliveries (environment_id, run_id, event_id, state, attempts, "
                    + "attempted_at, created_at, updated_at) SELECT environment_id, run_id, event_id, 'sending', 1, ?, ?, ? "
                    + "FROM outbox_events WHERE environment_id = ? AND run_id = ? AND event_id = ? AND state = 'pending'",
                    now, now, now, ctx.environmentId(), ctx.runId(), cand.eventId());
            return WorkResult.ok(rows == 0 ? result : result.put("version", 1));
        }
        boolean due = row.attempts() + 1 == attemptNo && ("retrying".equals(row.state())
                && row.nextAttemptAt() != null && !row.nextAttemptAt().isAfter(now)
                || "sending".equals(row.state()) && row.attemptedAt() != null
                        && !row.attemptedAt().isAfter(now.minus(LEASE)));
        if (!due) return WorkResult.ok(result);
        tx.cas("UPDATE notification_deliveries SET state = 'sending', attempts = attempts + 1, attempted_at = ?, "
                + "next_attempt_at = NULL, error = NULL, version = version + 1, updated_at = ? "
                + "WHERE environment_id = ? AND run_id = ? AND event_id = ? AND version = ?", now, now,
                ctx.environmentId(), ctx.runId(), cand.eventId(), row.version());
        return WorkResult.ok(result.put("version", row.version() + 1));
    }

    /** Validates the intent against current facts: Prepared inputs to render, or a Failure to record. */
    private Object prepare(RunContext ctx, Candidate cand, Instant now) {
        JsonNode p = cand.payload();
        if (!"offer".equals(p.path("messageKind").asText()) || !"1".equals(p.path("messageVersion").asText())) {
            return new Failure("message-version-unsupported", false);
        }
        String offerId = p.path("offerId").asText(null);
        String recipient = p.path("recipientEmployeeId").asText(null);
        if (offerId == null || recipient == null) return new Failure("message-facts-unavailable", false);
        OfferFacts.Result found;
        try {
            found = facts.lookup(ctx, offerId);
        } catch (Exception e) {
            return new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
        }
        if (found instanceof OfferFacts.Unavailable) return new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
        if (!(found instanceof OfferFacts.Offer offer)) return new Failure("message-facts-unavailable", false);
        Optional<String> name;
        try {
            name = employeeName(ctx, recipient);
        } catch (SQLException e) {
            return new Failure(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
        }
        if (name == null) return new Failure("message-facts-unavailable", false);
        if (!recipient.equals(offer.employeeId())) return new Failure("recipient-mismatch", false);
        boolean expired = offer.expiresAt() == null || !offer.expiresAt().isAfter(now);
        if (!"active".equals(offer.state()) || expired) {
            return new Failure("active".equals(offer.state()) || "expired".equals(offer.state())
                    ? "offer-expired" : "offer-inactive", false);
        }
        return new Prepared(recipient, name.orElse(null), offer);
    }

    private OfferMessage renderFor(Prepared p, Candidate cand, Instant now) {
        try {
            return OfferMessages.render(p.recipient(), p.name(), p.offer(), cand.payload().path("offerLink").asText(null),
                    now, base);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** The employee's display name (maybe empty), or null when the employee row does not exist. */
    private Optional<String> employeeName(RunContext ctx, String employeeId) throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT attributes->>'name' FROM employees "
                        + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? Optional.ofNullable(rs.getString(1)) : null;
            }
        }
    }

    private Flow finishSent(RunContext ctx, Candidate cand, int attemptNo, long version, Instant now, int[] counts) {
        Outcome o = runner.execute(ctx, command("notify.sent", "sent", cand.eventId(), attemptNo, null), tx -> {
            tx.cas("UPDATE notification_deliveries SET state = 'sent', transport = ?, error = NULL, "
                    + "next_attempt_at = NULL, version = version + 1, updated_at = ? WHERE environment_id = ? "
                    + "AND run_id = ? AND event_id = ? AND version = ? AND state = 'sending' AND attempts = ?",
                    transport.name(), now, ctx.environmentId(), ctx.runId(), cand.eventId(), version, attemptNo);
            closeOutbox(tx, cand.eventId(), "delivered", attemptNo, now);
            return WorkResult.ok(JSON.createObjectNode().put("state", "sent"));
        });
        Flow stop = stopFlow(o);
        if (stop != null) return stop;
        if (o instanceof Outcome.Committed c && c.changed() && !c.replayed()) counts[0]++;
        return Flow.NEXT;
    }

    private Flow finishFailed(RunContext ctx, DeliveryRules.Rules rule, Candidate cand, int attemptNo, long version,
            Instant now, Failure failure, int[] counts) {
        boolean retry = failure.retryable() && attemptNo < rule.maxAttempts();
        Instant next = retry ? now.plusSeconds(delaySeconds(rule, attemptNo)) : null;
        String state = retry ? "retrying" : "failed";
        Outcome o = runner.execute(ctx, command("notify.failure", "failure", cand.eventId(), attemptNo,
                JSON.createObjectNode().put("error", failure.code()).put("state", state)), tx -> {
            tx.cas("UPDATE notification_deliveries SET state = ?, error = ?, next_attempt_at = ?, "
                    + "version = version + 1, updated_at = ? WHERE environment_id = ? AND run_id = ? AND event_id = ? "
                    + "AND version = ? AND state = 'sending' AND attempts = ?", state, failure.code(), next, now,
                    ctx.environmentId(), ctx.runId(), cand.eventId(), version, attemptNo);
            if (!retry) closeOutbox(tx, cand.eventId(), "failed", attemptNo, now);
            return WorkResult.ok(JSON.createObjectNode().put("state", state));
        });
        Flow stop = stopFlow(o);
        if (stop != null) return stop;
        if (o instanceof Outcome.Committed c && c.changed() && !c.replayed()) {
            counts[retry ? 1 : 2]++;
            LOG.warnf("notification-attempt-failed state=%s attempt=%d error=%s", state, attemptNo, failure.code());
        }
        return Flow.NEXT;
    }

    private static void closeOutbox(Tx tx, String eventId, String state, int attempts, Instant now) throws SQLException {
        RunContext ctx = tx.context();
        long outboxVersion = tx.first("SELECT version FROM outbox_events WHERE environment_id = ? AND run_id = ? "
                + "AND event_id = ? AND state = 'pending'", rs -> rs.getLong(1), ctx.environmentId(), ctx.runId(), eventId)
                .orElseThrow(() -> new gcsp.api.persistence.TxConflict("stale-version", "The event is no longer pending"));
        tx.cas("UPDATE outbox_events SET state = ?, attempts = ?, version = version + 1, updated_at = ? "
                + "WHERE environment_id = ? AND run_id = ? AND event_id = ? AND version = ?", state, attempts, now,
                ctx.environmentId(), ctx.runId(), eventId, outboxVersion);
    }

    /** min(maximum, base * 2^(attempt - 1)) without overflow. */
    static long delaySeconds(DeliveryRules.Rules rule, int attempt) {
        int shift = Math.min(attempt - 1, 52);
        long base = rule.retryBaseSeconds();
        long max = rule.retryMaximumSeconds();
        return base > (max >> shift) ? max : Math.min(max, base << shift);
    }

    private static Flow stopFlow(Outcome o) {
        if (o instanceof Outcome.Conflict c && "stale-run".equals(c.code())) return Flow.STALE;
        if (o instanceof Outcome.Unavailable) return Flow.UNAVAILABLE;
        return null;
    }

    private Delivery readDelivery(RunContext ctx, String eventId) throws SQLException {
        try (Connection c = dataSource.getConnection()) {
            return readDelivery(c, ctx, eventId);
        }
    }

    private static Delivery readDelivery(Connection c, RunContext ctx, String eventId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT state, attempts, version, attempted_at, next_attempt_at, "
                + "message::text FROM notification_deliveries WHERE environment_id = ? AND run_id = ? AND event_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, eventId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String message = rs.getString(6);
                return new Delivery(rs.getString(1), rs.getInt(2), rs.getLong(3), instant(rs, 4), instant(rs, 5),
                        message == null ? null : readJson(message));
            }
        }
    }

    private static Instant instant(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    private static JsonNode readJson(String text) throws SQLException {
        try {
            return JSON.readTree(text);
        } catch (java.io.IOException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }

    private static Command command(String type, String step, String eventId, int attempt, ObjectNode extra) {
        ObjectNode input = JSON.createObjectNode().put("eventId", eventId).put("attempt", attempt);
        if (extra != null) input.setAll(extra);
        return new Command(type, "notify:" + step + ":" + sha256(eventId + "|" + attempt), input);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
