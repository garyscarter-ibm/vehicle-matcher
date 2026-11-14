package gcsp.api.notify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.persistence.RunContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

/** Presenter-only, read-only notification outbox: safe fields only, never a payload, an address or provider data. */
@Path("/api/gcsp/v1/presenter/outbox")
@Produces(MediaType.APPLICATION_JSON)
public class PresenterOutboxResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int LIMIT = 500;

    @Inject
    BearerAuthentication auth;

    @Inject
    Notifications notifications;

    @GET
    public Response outbox(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Access.requireAnyRole(auth.authenticate(authorization), Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) {
            return ApiError.response(400, "invalid", "unsupported-query",
                    "The outbox viewer accepts no query selectors.", false);
        }
        if (!notifications.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            RunContext scope = notifications.scope("presenter");
            List<OutboxView.Message> messages = OutboxView.list(notifications.dataSource(), scope, LIMIT);
            ObjectNode value = JSON.createObjectNode();
            value.put("runId", scope.runId());
            ArrayNode out = value.putArray("messages");
            for (OutboxView.Message message : messages) {
                out.add(json(message));
            }
            return ok(value);
        } catch (SQLException | IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static ObjectNode json(OutboxView.Message m) {
        ObjectNode n = JSON.createObjectNode();
        n.put("jobId", m.jobId());
        n.put("messageKind", m.messageKind());
        n.put("state", m.state());
        n.put("transport", m.transport());
        n.put("attempts", m.attempts());
        n.put("error", m.error());
        n.put("nextAttemptAt", instant(m.nextAttemptAt()));
        n.put("time", instant(m.time()));
        ObjectNode recipient = n.putObject("recipient");
        recipient.put("employeeId", m.recipient().employeeId());
        recipient.put("name", m.recipient().name());
        n.put("subject", m.subject());
        n.put("textBody", m.textBody());
        n.put("htmlBody", m.htmlBody());
        n.put("offerLink", m.offerLink());
        return n;
    }

    private static String instant(Instant value) {
        return value == null ? null : value.toString();
    }

    private static Response ok(ObjectNode value) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).build();
    }
}
