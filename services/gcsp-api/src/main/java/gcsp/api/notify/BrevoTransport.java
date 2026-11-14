package gcsp.api.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.TransactionRunner;
import gcsp.api.persistence.WorkResult;
import gcsp.api.persistence.PendingOperations;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
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
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.sql.DataSource;

/**
 * Sends the offer email through Brevo (port of brevo.js). One pending_operations row per notification holds the
 * recipient and idempotency key across attempts: intent first, provider call outside any transaction, then a CAS.
 */
public final class BrevoTransport implements MailTransport {

    static final String TYPE = "mail.brevo";
    static final String ACTOR = "notification-dispatcher";
    /** Brevo's provider idempotency window: wall time, not demo time. */
    static final Duration WINDOW = Duration.ofMinutes(30);

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_BODY = 64 * 1024;
    private static final Pattern SAFE_ID = Pattern.compile(
            "^(?:<[a-zA-Z0-9][a-zA-Z0-9._@+\\-]*>|[a-zA-Z0-9][a-zA-Z0-9._@+\\-]*)$");

    private record Custody(String state, long version, String key, JsonNode outcome) {}

    private record Reply(String messageId, String code, boolean retryable) {}

    private final DataSource dataSource;
    private final TransactionRunner runner;
    private final BrevoSettings settings;
    private final InstantSource wallClock;
    private final HttpClient http;

    public BrevoTransport(DataSource dataSource, BrevoSettings settings, InstantSource wallClock, HttpClient http) {
        if (http.followRedirects() != HttpClient.Redirect.NEVER) {
            throw new IllegalArgumentException("The Brevo HTTP client must never follow redirects");
        }
        this.dataSource = dataSource;
        this.runner = new TransactionRunner(dataSource);
        this.settings = settings;
        this.wallClock = wallClock;
        this.http = http;
    }

    /** The only client the transport accepts: redirects are never followed. */
    public static HttpClient newClient(Duration connectTimeout) {
        return HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(connectTimeout).build();
    }

    @Override
    public String name() {
        return "configured";
    }

    @Override
    public boolean alreadyAccepted(RunContext ctx, String eventId) {
        try {
            Custody c = read(ctx, operationId(eventId));
            return c != null && "acknowledged".equals(c.state());
        } catch (SQLException e) {
            throw new IllegalStateException("Provider custody could not be read");
        }
    }

    @Override
    public Result send(RunContext ctx, DeliveryAttempt attempt, OfferMessage message) {
        try {
            return deliver(ctx, attempt, message);
        } catch (SQLException e) {
            return new Failed(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
        }
    }

    private Result deliver(RunContext ctx, DeliveryAttempt attempt, OfferMessage message) throws SQLException {
        if (!runActive(ctx)) return new StaleRun();
        Instant now = wallClock.instant();
        String opId = operationId(attempt.eventId());
        Custody custody = read(ctx, opId);
        if (custody != null && "acknowledged".equals(custody.state())) return new Accepted();
        if (custody != null && "refused".equals(custody.state())) return new Failed("provider-rejected", false);

        if (custody == null) {
            String recipient = recipientOf(ctx, attempt);
            if (recipient == null) return new Failed("recipient-email-invalid", false);
            if (!offerLinkOk(message)) return new Failed("offer-link-invalid", false);
            Result prepared = prepare(ctx, attempt, opId, recipient, now);
            if (prepared != null) return prepared;
            custody = read(ctx, opId);
            if (custody == null) return new Failed(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
            if ("acknowledged".equals(custody.state())) return new Accepted();
            if ("refused".equals(custody.state())) return new Failed("provider-rejected", false);
        } else if (!offerLinkOk(message)) {
            return new Failed("offer-link-invalid", false);
        }

        String recipient = custody.outcome() == null ? null : custody.outcome().path("recipientEmail").asText(null);
        if (recipient == null || !NotificationEmailResource.validEmail(recipient)) {
            return new Failed("provider-unconfirmed", false);
        }
        Instant first = parse(custody.outcome().path("firstAttemptAt").asText(null));
        if (first == null || custody.key() == null || custody.key().isBlank()) {
            return new Failed("mail-configuration-invalid", false);
        }
        Duration elapsed = Duration.between(first, now);
        if (elapsed.isNegative() || elapsed.compareTo(WINDOW) >= 0) return new Failed("provider-window-expired", false);

        if (!runActive(ctx)) return new StaleRun();
        Reply reply = call(recipient, custody.key(), message);
        return finish(ctx, attempt, opId, custody, reply, now);
    }

    /** Null when custody now exists (made here or by another instance); otherwise the result to return. */
    private Result prepare(RunContext ctx, DeliveryAttempt attempt, String opId, String recipient, Instant now) {
        ObjectNode input = JSON.createObjectNode().put("eventId", attempt.eventId()).put("attempt", attempt.attempts());
        ObjectNode outcome = JSON.createObjectNode().put("recipientEmail", recipient).put("firstAttemptAt", now.toString());
        Outcome saved = runner.execute(new RunContext(ctx.environmentId(), ctx.runId(), ACTOR),
                new Command("notify.brevo.prepare", "notify:brevo:prepare:" + sha256(attempt.eventId()), input), tx -> {
                    PendingOperations.recordIntent(tx, opId, TYPE, UUID.randomUUID().toString(), input);
                    PendingOperations.markPending(tx, opId, 1, outcome);
                    return WorkResult.ok(JSON.createObjectNode().put("operation", "pending"));
                });
        if (saved instanceof Outcome.Committed) return null;
        if (saved instanceof Outcome.Conflict c) {
            if ("stale-run".equals(c.code())) return new StaleRun();
            return null;
        }
        return new Failed(MailFailureCodes.TRANSPORT_UNAVAILABLE, true);
    }

    private Result finish(RunContext ctx, DeliveryAttempt attempt, String opId, Custody custody, Reply reply,
            Instant now) throws SQLException {
        boolean confirmed = reply.messageId() != null;
        boolean refuse = !confirmed && !reply.retryable();
        ObjectNode outcome = custody.outcome().deepCopy();
        String step = confirmed ? "acknowledged" : reply.code();
        if (confirmed) outcome.put("acknowledgedAt", now.toString());
        else outcome.put("lastCode", reply.code());
        ObjectNode input = JSON.createObjectNode().put("eventId", attempt.eventId()).put("attempt", attempt.attempts())
                .put("result", step);
        String commandId = "notify:brevo:outcome:" + sha256(attempt.eventId() + "|" + attempt.attempts() + "|" + custody.key());
        Outcome saved = runner.execute(new RunContext(ctx.environmentId(), ctx.runId(), ACTOR),
                new Command("notify.brevo.outcome", commandId, input), tx -> {
                    if (confirmed) {
                        PendingOperations.finalize(tx, opId, custody.version(), "acknowledged", reply.messageId(), outcome);
                    } else if (refuse) {
                        PendingOperations.finalize(tx, opId, custody.version(), "refused", null, outcome);
                    } else {
                        PendingOperations.markPending(tx, opId, custody.version(), outcome);
                    }
                    return WorkResult.ok(JSON.createObjectNode().put("state", confirmed ? "acknowledged" : "open"));
                });
        RunContext actor = new RunContext(ctx.environmentId(), ctx.runId(), ACTOR);
        boolean committed = saved instanceof Outcome.Committed || saved instanceof Outcome.Uncertain
                && runner.inspect(actor, commandId) instanceof gcsp.api.persistence.Inspection.Committed;
        if (committed) return confirmed ? new Accepted() : new Failed(reply.code(), reply.retryable());
        if (saved instanceof Outcome.Conflict c && "stale-run".equals(c.code())) return new StaleRun();
        Custody latest = read(ctx, opId);
        if (latest != null && "acknowledged".equals(latest.state())) return new Accepted();
        return new Failed("provider-unconfirmed", true);
    }

    private Reply call(String recipient, String key, OfferMessage message) {
        try {
            ObjectNode body = JSON.createObjectNode();
            body.putObject("sender").put("email", settings.senderEmail()).put("name", settings.senderName());
            body.putArray("to").addObject().put("email", recipient);
            body.put("subject", message.subject()).put("textContent", message.textBody())
                    .put("htmlContent", message.htmlBody());
            body.putObject("headers").put("idempotencyKey", key);
            HttpRequest request = HttpRequest.newBuilder(settings.endpoint()).timeout(settings.timeout())
                    .header("api-key", settings.apiKey()).header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8)).build();
            HttpResponse<java.io.InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (java.io.InputStream in = response.body()) {
                return classify(response.statusCode(), in.readNBytes(MAX_BODY), recipient, key);
            }
        } catch (HttpTimeoutException e) {
            return new Reply(null, "provider-timeout", true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Reply(null, "provider-unavailable", true);
        } catch (Exception e) {
            return new Reply(null, "provider-unavailable", true);
        }
    }

    private Reply classify(int status, byte[] raw, String recipient, String key) {
        JsonNode body = null;
        try {
            body = raw == null || raw.length == 0 ? null : JSON.readTree(raw);
        } catch (java.io.IOException e) {
            // Provider response content never leaves this adapter.
        }
        String id = body != null && body.path("messageId").isTextual() ? body.path("messageId").asText() : null;
        if (status == 201 && id != null && id.length() <= 256 && SAFE_ID.matcher(id).matches()
                && !id.contains(settings.apiKey()) && !id.contains(key) && !id.equals(recipient)
                && !id.equals(settings.senderEmail())) {
            return new Reply(id, null, false);
        }
        if (body != null && "duplicate_parameter".equals(body.path("code").asText(null))
                || status >= 200 && status < 300) {
            return new Reply(null, "provider-unconfirmed", true);
        }
        if (status == 401 || status == 403) return new Reply(null, "provider-authentication", false);
        if (status == 429) return new Reply(null, "provider-rate-limited", true);
        if (status == 408 || status >= 500 || status >= 300 && status < 400) {
            return new Reply(null, "provider-unavailable", true);
        }
        return new Reply(null, "provider-rejected", false);
    }

    /** An absolute https link under the public base's offer path, with no userinfo, query or fragment. */
    private boolean offerLinkOk(OfferMessage message) {
        String link = message.offerLink();
        if (link == null || !link.startsWith(settings.publicBase() + "gcsp/offers/")) return false;
        try {
            URI uri = new URI(link);
            return "https".equals(uri.getScheme()) && uri.isAbsolute() && uri.getRawUserInfo() == null
                    && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (java.net.URISyntaxException e) {
            return false;
        }
    }

    private String recipientOf(RunContext ctx, DeliveryAttempt attempt) throws SQLException {
        if (attempt.recipientEmployeeId() == null) return null;
        Optional<NotificationRecipients.Setting> setting = NotificationRecipients.read(dataSource, ctx,
                attempt.recipientEmployeeId());
        String email = setting.map(NotificationRecipients.Setting::deliveryEmail).orElse(null);
        return email != null && NotificationEmailResource.validEmail(email) ? email : null;
    }

    private boolean runActive(RunContext ctx) throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement(
                        "SELECT 1 FROM runs WHERE environment_id = ? AND run_id = ? AND status = 'active'")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private Custody read(RunContext ctx, String opId) throws SQLException {
        try (Connection c = dataSource.getConnection();
                PreparedStatement ps = c.prepareStatement("SELECT state, version, idempotency_key, outcome::text "
                        + "FROM pending_operations WHERE environment_id = ? AND run_id = ? AND operation_id = ?")) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, opId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String text = rs.getString(4);
                JsonNode outcome = null;
                if (text != null) {
                    try {
                        outcome = JSON.readTree(text);
                    } catch (java.io.IOException e) {
                        throw new SQLException("Stored custody is unreadable");
                    }
                }
                return new Custody(rs.getString(1), rs.getLong(2), rs.getString(3), outcome);
            }
        }
    }

    private static Instant parse(String text) {
        try {
            return text == null ? null : Instant.parse(text);
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    private static String operationId(String eventId) {
        return "mail:" + eventId;
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
