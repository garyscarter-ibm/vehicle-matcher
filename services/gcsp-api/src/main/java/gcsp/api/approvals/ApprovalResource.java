package gcsp.api.approvals;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.approvals.ApprovalService.Reader;
import gcsp.api.approvals.ApprovalService.TickInput;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import io.smallrye.common.annotation.Blocking;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Order approval progress for employees, Greg and the presenter, plus the presenter's tick and reconcile controls.
 * Scope is the server's active run, never the request; no endpoint lets any role approve or decline directly.
 */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ApprovalResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 100;

    @Inject
    BearerAuthentication auth;

    @Inject
    ApprovalServiceHolder holder;

    @Inject
    Persistence persistence;

    // ---- reads ----

    @GET
    @Path("/orders/progress")
    public Response progress(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of("orderUuid"));
        if (early != null) return early;
        String orderUuid = uri.getQueryParameters().getFirst("orderUuid");
        return serve(principal, "orderUuid",
                (service, scope) -> service.read(scope, reader(principal), orderUuid));
    }

    @GET
    @Path("/orders/progress/all")
    public Response progressAll(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of("after", "limit"));
        if (early != null) return early;
        MultivaluedMap<String, String> q = uri.getQueryParameters();
        List<String[]> reasons = new ArrayList<>();
        String after = q.getFirst("after");
        if (q.containsKey("after") && (after == null || after.isEmpty() || after.length() > 200)) {
            reasons.add(new String[] {"after", "Use an order UUID from a previous page."});
        }
        int limit = DEFAULT_LIMIT;
        if (q.containsKey("limit")) {
            Integer n = wholeNumber(q.getFirst("limit"));
            if (n == null || n < 1 || n > MAX_LIMIT) reasons.add(new String[] {"limit", "Use a whole number from 1 to 100."});
            else limit = n;
        }
        if (!reasons.isEmpty()) return invalid("invalid-query", "The query is not valid.", reasons);
        int page = limit;
        return serve(principal, "limit", (service, scope) -> service.list(scope, reader(principal), after, page));
    }

    // ---- presenter commands ----

    /** commandId must be present; tickId is the idempotency identity, so a repeated tickId with new input is a conflict. */
    @POST
    @Path("/presenter/approvals/ticks")
    public Response tick(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        TickInput tick = parseTick(body, reasons);
        if (tick == null) return invalid("invalid-tick", "The tick request is not valid.", reasons);
        return serve(principal, "tickId", (service, scope) -> service.tick(scope, tick));
    }

    @POST
    @Path("/presenter/approvals/reconcile")
    public Response reconcile(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        int limit = parseReconcile(body, reasons);
        if (!reasons.isEmpty()) return invalid("invalid-reconcile", "The reconcile request is not valid.", reasons);
        return serve(principal, "limit", (service, scope) -> service.reconcile(scope, limit));
    }

    // ---- shared steps ----

    private static Reader reader(Principal p) {
        if (p.roles().contains(Role.EMPLOYEE.wire())) return new Reader(Role.EMPLOYEE, p.employeeId());
        if (p.roles().contains(Role.GREG.wire())) return new Reader(Role.GREG, null);
        return new Reader(Role.PRESENTER, null);
    }

    @FunctionalInterface
    private interface Operation {
        ApprovalResult run(ApprovalService service, RunContext scope);
    }

    /** Resolves the active run, refuses a principal bound to another run, then maps the service's answer. */
    private Response serve(Principal principal, String field, Operation op) {
        Optional<ApprovalService> service = holder.service();
        if (service.isEmpty()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        RunContext scope;
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            if (!run.environmentId().equals(principal.environmentId()) || !run.runId().equals(principal.runId())) {
                return ApiError.response(409, "conflict", "stale-run",
                        "Your session belongs to an earlier run. Sign in again.", false);
            }
            scope = new RunContext(run.environmentId(), run.runId(), principal.subject());
        } catch (IllegalStateException e) {
            return databaseDown();
        }
        try {
            return mapped(op.run(service.get(), scope), field);
        } catch (IllegalStateException e) {
            return databaseDown();
        }
    }

    private static Response databaseDown() {
        return ApiError.response(503, "unavailable", "database-unavailable", "The database could not be reached.", true);
    }

    /** Refuses any query key outside the allowed set, and any repeated key. */
    private static Response unsupportedQuery(UriInfo uri, Set<String> allowed) {
        for (var e : uri.getQueryParameters().entrySet()) {
            if (!allowed.contains(e.getKey()) || e.getValue().size() > 1) {
                return ApiError.response(400, "invalid", "unsupported-query",
                        "This operation does not accept that query parameter.", false);
            }
        }
        return null;
    }

    /** The contract mapping: ok 200, invalid 400, forbidden 403, not found 404, conflict 409, uncertain 202, else 503. */
    static Response mapped(ApprovalResult r, String field) {
        ObjectNode body = JSON.createObjectNode();
        if (r instanceof ApprovalResult.Ok ok) {
            JsonNode value = ok.value() == null ? JSON.nullNode() : ok.value().deepCopy();
            if (ok.replayed() && value instanceof ObjectNode o) o.put("replayed", true);
            body.put("status", "ok");
            body.set("value", value);
            return Response.ok(body).build();
        }
        if (r instanceof ApprovalResult.Uncertain u) {
            body.put("status", "pending");
            body.put("code", "outcome-uncertain");
            body.put("reason", u.reason());
            body.put("retryable", false);
            body.put("operationId", u.operationId());
            return Response.status(202).entity(body).build();
        }
        int http;
        String status;
        if (r instanceof ApprovalResult.Invalid) {
            http = 400;
            status = "invalid";
        } else if (r instanceof ApprovalResult.NotFound) {
            http = 404;
            status = "not-found";
        } else if (r instanceof ApprovalResult.Forbidden) {
            http = 403;
            status = "forbidden";
        } else if (r instanceof ApprovalResult.Conflict) {
            http = 409;
            status = "conflict";
        } else {
            http = 503;
            status = "unavailable";
        }
        body.put("status", status);
        body.put("code", r.code());
        body.put("reason", r.reason());
        body.put("retryable", r.retryable());
        if (r instanceof ApprovalResult.Invalid i) {
            body.putArray("reasons").addObject().put("field", field).put("reason", i.reason());
        }
        if (r instanceof ApprovalResult.Unavailable u && u.state() != null) body.put("state", u.state());
        return Response.status(http).entity(body).build();
    }

    private static Response invalid(String code, String reason, List<String[]> reasons) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", code);
        body.put("reason", reason);
        body.put("retryable", false);
        ArrayNode list = body.putArray("reasons");
        for (String[] r : reasons) list.addObject().put("field", r[0]).put("reason", r[1]);
        return Response.status(400).entity(body).build();
    }

    // ---- request parsing ----

    private static ObjectNode object(String body, List<String[]> reasons) {
        try {
            JsonNode node = body == null || body.isBlank() ? null
                    : JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
            if (node != null && node.isObject()) return (ObjectNode) node;
        } catch (java.io.IOException e) {
            // reported below
        }
        reasons.add(new String[] {"body", "Send a JSON object."});
        return null;
    }

    private static void rejectUnknown(ObjectNode node, Set<String> known, List<String[]> reasons) {
        node.fieldNames().forEachRemaining(name -> {
            if (!known.contains(name)) reasons.add(new String[] {name, "This field is not accepted."});
        });
    }

    private static void requireCommandId(ObjectNode node, List<String[]> reasons) {
        JsonNode id = node.get("commandId");
        if (id == null || !id.isTextual() || id.asText().isBlank() || id.asText().length() > 200) {
            reasons.add(new String[] {"commandId", "Use text of 1 to 200 characters."});
        }
    }

    private static TickInput parseTick(String body, List<String[]> reasons) {
        ObjectNode node = object(body, reasons);
        if (node == null) return null;
        rejectUnknown(node, Set.of("commandId", "tickId", "now", "clockVersion"), reasons);
        requireCommandId(node, reasons);
        JsonNode id = node.get("tickId");
        if (id == null || !id.isTextual() || id.asText().isBlank() || id.asText().length() > 200) {
            reasons.add(new String[] {"tickId", "Use text of 1 to 200 characters."});
        }
        JsonNode now = node.get("now");
        Instant at = now != null && now.isTextual() ? instant(now.asText()) : null;
        if (at == null) reasons.add(new String[] {"now", "Use an ISO 8601 instant with an offset."});
        JsonNode version = node.get("clockVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToLong() || version.asLong() < 1) {
            reasons.add(new String[] {"clockVersion", "Use a positive whole number."});
        }
        if (!reasons.isEmpty()) return null;
        return new TickInput(id.asText(), at, version.asLong());
    }

    private static int parseReconcile(String body, List<String[]> reasons) {
        ObjectNode node = object(body, reasons);
        if (node == null) return 100;
        rejectUnknown(node, Set.of("commandId", "limit"), reasons);
        requireCommandId(node, reasons);
        JsonNode limit = node.get("limit");
        if (limit == null) return 100;
        if (!limit.isIntegralNumber() || !limit.canConvertToInt() || limit.asInt() < 1 || limit.asInt() > MAX_LIMIT) {
            reasons.add(new String[] {"limit", "Use a whole number from 1 to 100."});
            return 100;
        }
        return limit.asInt();
    }

    private static Instant instant(String text) {
        try {
            return OffsetDateTime.parse(text).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static Integer wholeNumber(String text) {
        return text == null || !text.matches("\\d{1,9}") ? null : Integer.valueOf(text);
    }
}
