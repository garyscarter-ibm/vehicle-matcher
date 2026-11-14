package gcsp.api.presenter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.ClockUnavailableException;
import gcsp.api.clock.PresenterMode;
import gcsp.api.clock.RunClock;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.clock.TickKind;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.BiFunction;

/** Presenter-only clock and controls; the scope is the server's active run for this presenter, never the request. */
@Path("/api/gcsp/v1/presenter")
@Produces(MediaType.APPLICATION_JSON)
public class PresenterClockResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long MAX_SAFE = 9_007_199_254_740_991L;

    @Inject
    BearerAuthentication auth;

    @Inject
    RunClockHolder holder;

    // ---- reads ----

    @GET
    @Path("/clock")
    public Response clock(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return run(authorization, uri, (clock, scope) -> clock.state(scope));
    }

    @GET
    @Path("/clock/ticks/{tickId}")
    public Response tick(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            @PathParam("tickId") String tickId) {
        return run(authorization, uri, (clock, scope) -> clock.tickView(scope, tickId));
    }

    @GET
    @Path("/controls")
    public Response controls(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return run(authorization, uri, (clock, scope) -> clock.controls(scope));
    }

    // ---- commands ----

    @POST
    @Path("/clock/advance")
    public Response advance(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        List<String[]> reasons = new ArrayList<>();
        ObjectNode in = fields(body, Set.of("commandId", "expectedClockVersion", "bySeconds", "to"), reasons);
        String commandId = in == null ? null : text(in, "commandId", reasons);
        Long version = in == null ? null : version(in, reasons);
        Long by = in != null && in.has("bySeconds") ? whole(in, "bySeconds", reasons) : null;
        String to = in != null && in.has("to") ? text(in, "to", reasons) : null;
        if (in != null && in.has("bySeconds") == in.has("to")) {
            reasons.add(new String[] {"bySeconds", "Supply exactly one of bySeconds or to."});
        }
        return command(authorization, uri, reasons, "invalid-clock-command", "The advance request is not valid.",
                (clock, scope) -> clock.advance(scope, commandId, version, by, to));
    }

    @POST
    @Path("/clock/tick")
    public Response tickNow(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        List<String[]> reasons = new ArrayList<>();
        ObjectNode in = fields(body, Set.of("tickId", "expectedClockVersion"), reasons);
        String tickId = in == null ? null : text(in, "tickId", reasons);
        Long version = in == null ? null : version(in, reasons);
        return command(authorization, uri, reasons, "invalid-tick", "The tick request is not valid.",
                (clock, scope) -> clock.tick(scope, tickId, version, TickKind.PRESENTER));
    }

    @POST
    @Path("/controls/tick")
    public Response controlsTick(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        List<String[]> reasons = new ArrayList<>();
        ObjectNode in = fields(body, Set.of("commandId", "expectedClockVersion", "mode", "to"), reasons);
        String commandId = in == null ? null : text(in, "commandId", reasons);
        Long version = in == null ? null : version(in, reasons);
        PresenterMode mode = in == null ? null : mode(in, reasons);
        String to = in != null && in.has("to") ? text(in, "to", reasons) : null;
        if (mode != null && (mode == PresenterMode.TO) != (to != null)) {
            reasons.add(new String[] {"to", "Supply to only with mode to."});
        }
        return command(authorization, uri, reasons, "invalid-presenter-tick", "The presenter tick request is not valid.",
                (clock, scope) -> clock.presenterTick(scope, commandId, version, mode, to));
    }

    // ---- shared steps ----

    private Response run(String authorization, UriInfo uri, BiFunction<RunClock, RunContext, ClockResult> action) {
        Principal principal = guard(authorization, uri);
        if (principal == null) return unsupportedQuery();
        return execute(principal, action);
    }

    private Response command(String authorization, UriInfo uri, List<String[]> reasons, String code, String reason,
            BiFunction<RunClock, RunContext, ClockResult> action) {
        Principal principal = guard(authorization, uri);
        if (principal == null) return unsupportedQuery();
        if (!reasons.isEmpty()) return invalid(code, reason, reasons);
        return execute(principal, action);
    }

    /** Authenticates and requires the presenter role; null means a query parameter was sent. */
    private Principal guard(String authorization, UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        return uri.getQueryParameters().isEmpty() ? principal : null;
    }

    private Response execute(Principal principal, BiFunction<RunClock, RunContext, ClockResult> action) {
        if (!holder.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            RunContext scope = holder.scope("presenter:" + principal.subject());
            return map(action.apply(holder.clock(), scope));
        } catch (ClockUnavailableException | IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static Response unsupportedQuery() {
        return ApiError.response(400, "invalid", "unsupported-query",
                "This operation does not accept that query parameter.", false);
    }

    // ---- result mapping ----

    /** ok 200; invalid 400; not found 404; conflict and stale run 409; unavailable 503; uncertain 202. */
    static Response map(ClockResult result) {
        if (result instanceof ClockResult.Ok ok) {
            ObjectNode body = JSON.createObjectNode();
            body.put("status", "ok");
            body.set("value", ok.value());
            return Response.ok(body).build();
        }
        ClockResult.Failure f = (ClockResult.Failure) result;
        ObjectNode body = JSON.createObjectNode();
        int http;
        switch (f.status()) {
            case INVALID -> {
                http = 400;
                body.put("status", "invalid");
            }
            case NOT_FOUND -> {
                http = 404;
                body.put("status", "not-found");
            }
            case CONFLICT, STALE_RUN -> {
                http = 409;
                body.put("status", "conflict");
            }
            case UNCERTAIN -> {
                http = 202;
                body.put("status", "pending");
            }
            default -> {
                http = 503;
                body.put("status", "unavailable");
            }
        }
        body.put("code", f.code());
        body.put("reason", f.reason());
        body.put("retryable", f.retryable());
        if (f.currentVersion() != null) {
            body.put("currentVersion", f.currentVersion());
            body.put("action", "refresh");
        }
        if (f.operationId() != null) body.put("operationId", f.operationId());
        if (f.detail() instanceof ObjectNode detail) detail.fields().forEachRemaining(e -> body.set(e.getKey(), e.getValue()));
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

    private static ObjectNode fields(String body, Set<String> allowed, List<String[]> reasons) {
        try {
            JsonNode node = body == null || body.isBlank() ? null : JSON.readTree(body);
            if (node != null && node.isObject()) {
                node.fieldNames().forEachRemaining(name -> {
                    if (!allowed.contains(name)) reasons.add(new String[] {name, "This field is not accepted."});
                });
                return (ObjectNode) node;
            }
        } catch (java.io.IOException e) {
            // reported below
        }
        reasons.add(new String[] {"body", "Send a JSON object."});
        return null;
    }

    private static String text(ObjectNode in, String field, List<String[]> reasons) {
        JsonNode node = in.get(field);
        if (node == null || !node.isTextual() || node.asText().isBlank() || node.asText().length() > 200) {
            reasons.add(new String[] {field, "Use text of 1 to 200 characters."});
            return null;
        }
        return node.asText();
    }

    private static Long version(ObjectNode in, List<String[]> reasons) {
        return whole(in, "expectedClockVersion", reasons);
    }

    private static Long whole(ObjectNode in, String field, List<String[]> reasons) {
        JsonNode node = in.get(field);
        if (node == null || !node.isIntegralNumber() || !node.canConvertToLong() || node.asLong() < 1
                || node.asLong() > MAX_SAFE) {
            reasons.add(new String[] {field, "Use a positive whole number."});
            return null;
        }
        return node.asLong();
    }

    private static PresenterMode mode(ObjectNode in, List<String[]> reasons) {
        JsonNode node = in.get("mode");
        String value = node != null && node.isTextual() ? node.asText() : "";
        return switch (value) {
            case "step" -> PresenterMode.STEP;
            case "to" -> PresenterMode.TO;
            case "next-release" -> PresenterMode.NEXT_RELEASE;
            default -> {
                reasons.add(new String[] {"mode", "Use step, to or next-release."});
                yield null;
            }
        };
    }
}
