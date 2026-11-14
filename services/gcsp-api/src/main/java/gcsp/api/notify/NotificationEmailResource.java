package gcsp.api.notify;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Command;
import gcsp.api.persistence.Outcome;
import gcsp.api.persistence.RunContext;
import gcsp.api.persistence.Tx;
import gcsp.api.persistence.TxConflict;
import gcsp.api.persistence.WorkResult;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.regex.Pattern;
import javax.sql.DataSource;

/** The employee's own notification email: GET reads it, POST sets it with a version check; the caller is always the employee. */
@Path("/api/gcsp/v1/manual/notification-email")
@Produces(MediaType.APPLICATION_JSON)
public class NotificationEmailResource {

    static final String COMMAND_TYPE = "notification-email.set";

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper STRICT = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final long SAFE_MAX = (1L << 53) - 1;
    // As delivery-email.js: JavaScript's \s also matches U+FEFF, which Java's does not, so it is excluded here.
    private static final Pattern EMAIL = Pattern.compile(
            "^[^\\s<>@,;\\x00-\\x1f\\x7f\\uFEFF]+@[^\\s<>@,;\\x00-\\x1f\\x7f\\uFEFF]+\\.[^\\s<>@,;\\x00-\\x1f\\x7f\\uFEFF]+$",
            Pattern.UNICODE_CHARACTER_CLASS);
    private static final String EMPLOYEE_SQL = "SELECT 1 FROM employees "
            + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?";
    private static final String VERSION_SQL = "SELECT version FROM notification_recipients "
            + "WHERE environment_id = ? AND run_id = ? AND employee_id = ?";
    private static final String UPSERT_SQL = "INSERT INTO notification_recipients "
            + "(environment_id, run_id, employee_id, delivery_email, version) VALUES (?, ?, ?, ?, ?) "
            + "ON CONFLICT (environment_id, run_id, employee_id) DO UPDATE SET delivery_email = EXCLUDED.delivery_email, "
            + "version = EXCLUDED.version, updated_at = now() WHERE notification_recipients.version = ?";
    private static final String EMPLOYEE_NOT_FOUND = "employee-not-found";
    private static final String EMAIL_REASON = "Enter a valid email address, or clear it to stop email notifications.";
    private static final String INVALID_REASON = "The notification email request is not valid.";
    private static final String OWNER_REASON = "Your account cannot use this action.";
    private static final String NO_EMPLOYEE = "Your employee record is not available.";
    private static final String STALE = "The notification email changed since it was read.";

    @Inject
    BearerAuthentication auth;

    @Inject
    Notifications notifications;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE);
        if (p.employeeId() == null) return notOwner();
        if (!uri.getQueryParameters().isEmpty()) return invalid();
        if (!notifications.available()) return persistenceNotConfigured();
        try {
            RunContext scope = notifications.scope(p.employeeId());
            DataSource source = notifications.dataSource();
            if (!employeeExists(source, scope, p.employeeId())) return employeeNotFound();
            NotificationRecipients.Setting setting = NotificationRecipients.read(source, scope, p.employeeId())
                    .orElse(new NotificationRecipients.Setting(null, 0));
            ObjectNode value = JSON.createObjectNode();
            value.put("deliveryEmail", setting.deliveryEmail());
            value.put("version", setting.version());
            return ok(value);
        } catch (SQLException | IllegalStateException e) {
            return databaseUnavailable();
        }
    }

    @POST
    public Response write(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE);
        if (p.employeeId() == null) return notOwner();
        if (!uri.getQueryParameters().isEmpty()) return invalid();
        ObjectNode input = parse(body);
        if (input == null) return invalid();
        if (!notifications.available()) return persistenceNotConfigured();
        String employeeId = p.employeeId();
        String commandId = input.get("commandId").asText();
        long expectedVersion = input.get("expectedVersion").asLong();
        JsonNode email = input.get("deliveryEmail");
        String deliveryEmail = email.isNull() ? null : email.asText();
        try {
            RunContext scope = notifications.scope(employeeId);
            Command command = new Command(COMMAND_TYPE, operationId(employeeId, commandId), input);
            Outcome outcome = notifications.runner().execute(scope, command,
                    tx -> saveEmail(tx, scope, employeeId, deliveryEmail, expectedVersion));
            return mapped(outcome);
        } catch (IllegalStateException e) {
            return databaseUnavailable();
        }
    }

    /** One command transaction: the employee must exist, the version must match, then the write is version-checked. */
    private static WorkResult saveEmail(Tx tx, RunContext ctx, String employeeId, String deliveryEmail,
            long expectedVersion) throws SQLException {
        if (tx.first(EMPLOYEE_SQL, rs -> rs.getInt(1), ctx.environmentId(), ctx.runId(), employeeId).isEmpty()) {
            return WorkResult.refuse(EMPLOYEE_NOT_FOUND, NO_EMPLOYEE);
        }
        long current = tx.first(VERSION_SQL, rs -> rs.getLong(1), ctx.environmentId(), ctx.runId(), employeeId)
                .orElse(0L);
        if (current != expectedVersion) throw new TxConflict("stale-version", STALE);
        long next = expectedVersion + 1;
        if (tx.write(UPSERT_SQL, ctx.environmentId(), ctx.runId(), employeeId, deliveryEmail, next,
                expectedVersion) == 0) {
            throw new TxConflict("stale-version", STALE);
        }
        ObjectNode result = JSON.createObjectNode();
        result.put("deliveryEmail", deliveryEmail);
        result.put("version", next);
        return WorkResult.ok(result);
    }

    private static boolean employeeExists(DataSource source, RunContext ctx, String employeeId) throws SQLException {
        try (Connection c = source.getConnection(); PreparedStatement ps = c.prepareStatement(EMPLOYEE_SQL)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            ps.setString(3, employeeId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private static Response mapped(Outcome outcome) {
        if (outcome instanceof Outcome.Committed committed) return ok(committed.result());
        if (outcome instanceof Outcome.Uncertain uncertain) {
            ObjectNode body = JSON.createObjectNode();
            body.put("status", "unavailable");
            body.put("code", uncertain.code());
            body.put("reason", "The change may or may not have been saved.");
            body.put("retryable", false);
            body.put("operationId", uncertain.operationId());
            return Response.status(503).entity(body).build();
        }
        if (outcome instanceof Outcome.Unavailable) return databaseUnavailable();
        if (outcome instanceof Outcome.Refused refused) {
            if (EMPLOYEE_NOT_FOUND.equals(refused.code())) return employeeNotFound();
            return ApiError.response(409, "conflict", refused.code(), refused.message(), false);
        }
        Outcome.Conflict conflict = (Outcome.Conflict) outcome;
        return ApiError.response(409, "conflict", conflict.code(), conflict.message(), conflict.retryable());
    }

    /** The body as an object with exactly the three fields, or null when a field is missing, extra or invalid. */
    private static ObjectNode parse(String body) {
        JsonNode node;
        try {
            node = body == null || body.isBlank() ? null : STRICT.readTree(body);
        } catch (IOException e) {
            return null;
        }
        if (node == null || !node.isObject() || node.size() != 3) return null;
        JsonNode commandId = node.get("commandId");
        JsonNode expected = node.get("expectedVersion");
        JsonNode email = node.get("deliveryEmail");
        if (commandId == null || expected == null || email == null) return null;
        if (!commandId.isTextual() || commandId.asText().isBlank() || commandId.asText().length() > 128) return null;
        if (!expected.isIntegralNumber() || !expected.canConvertToLong() || expected.asLong() < 0
                || expected.asLong() > SAFE_MAX) {
            return null;
        }
        if (!email.isNull() && !(email.isTextual() && validEmail(email.asText()))) return null;
        return (ObjectNode) node;
    }

    static boolean validEmail(String value) {
        return value.equals(value.strip()) && value.length() <= 254 && EMAIL.matcher(value).matches();
    }

    /** A receipt key: one digest per employee and caller commandId, so the same id from two employees never collides. */
    static String operationId(String employeeId, String commandId) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((employeeId + "|" + commandId).getBytes(StandardCharsets.UTF_8));
            return "notification-email:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Response ok(JsonNode value) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).build();
    }

    private static Response invalid() {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", "notification-email-invalid");
        body.put("reason", INVALID_REASON);
        body.put("retryable", false);
        ArrayNode reasons = body.putArray("reasons");
        reasons.addObject().put("field", "deliveryEmail").put("reason", EMAIL_REASON);
        return Response.status(400).entity(body).build();
    }

    private static Response notOwner() {
        return ApiError.response(403, "forbidden", "not-resource-owner", OWNER_REASON, false);
    }

    private static Response employeeNotFound() {
        return ApiError.response(404, "not-found", EMPLOYEE_NOT_FOUND, NO_EMPLOYEE, false);
    }

    private static Response persistenceNotConfigured() {
        return ApiError.response(503, "unavailable", "persistence-not-configured",
                "The database is not configured on this service.", false);
    }

    private static Response databaseUnavailable() {
        return ApiError.response(503, "unavailable", "database-unavailable",
                "The database could not be reached.", true);
    }
}
