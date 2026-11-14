package gcsp.api.appointments;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
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
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.function.BiFunction;

/** Handover appointments over HTTP. The run is always the server's active one; request fields never choose scope. */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
public class AppointmentsResource {

    private static final ObjectMapper JSON = JsonMapper.builder().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private static final Set<String> RESERVED = Set.of("status", "code", "reason", "retryable", "operationId", "value");
    private static final String UNCERTAIN_COMMIT = "The result is not known yet. Check the appointment before sending the command again.";
    private static final String INVALID_REASON = "The request is not valid. Correct the fields listed.";

    @Inject
    BearerAuthentication auth;

    @Inject
    AppointmentsWiring wiring;

    @GET
    @Path("/appointments")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal who = auth.authenticate(authorization);
        Access.requireAnyRole(who, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        List<String> orders = uri.getQueryParameters().get("orderUuid");
        if (uri.getQueryParameters().keySet().stream().anyMatch(k -> !"orderUuid".equals(k)) || orders != null && orders.size() > 1) {
            return unsupportedQuery();
        }
        ObjectNode input = JSON.createObjectNode();
        if (orders != null) input.put("orderUuid", orders.get(0));
        return run(uri, who, null, (service, scope) -> service.read(who, scope, input), input);
    }

    @POST
    @Path("/appointments/request")
    public Response request(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, Role.EMPLOYEE, AppointmentService::request);
    }

    @POST
    @Path("/appointments/accept")
    public Response accept(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, Role.EMPLOYEE, AppointmentService::acceptChange);
    }

    @POST
    @Path("/appointments/complete")
    public Response complete(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, Role.GREG, AppointmentService::complete);
    }

    @POST
    @Path("/presenter/appointments/ticks")
    public Response tick(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal who = auth.authenticate(authorization);
        Access.requireAnyRole(who, Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        ObjectNode input = object(body);
        if (input == null) return invalid(List.of(new AppointmentResult.Reason("body", "Send a JSON object.")));
        ArrayNode noted = JSON.createArrayNode();
        input.fieldNames().forEachRemaining(n -> {
            if (!Set.of("tickId", "now").contains(n)) noted.addObject().put("field", n).put("reason", "This field is not accepted.");
        });
        JsonNode id = input.get("tickId");
        JsonNode now = input.get("now");
        Instant at = now != null && now.isTextual() ? Iso.parse(now.asText()) : null;
        if (!Values.id(id, 200)) noted.addObject().put("field", "tickId").put("reason", "Supply a tick id of 1 to 200 characters.");
        if (at == null) noted.addObject().put("field", "now").put("reason", "Use an ISO 8601 instant with an offset.");
        if (!noted.isEmpty()) {
            return invalid(java.util.stream.StreamSupport.stream(noted.spliterator(), false)
                    .map(n -> new AppointmentResult.Reason(n.get("field").asText(), n.get("reason").asText())).toList());
        }
        String tickId = id.asText();
        Instant when = at;
        return run(uri, who, null, (service, scope) -> {
            if (AppointmentsWiring.NONE.equals(wiring.mode())) return AppointmentService.notConfigured();
            AppointmentResult recorded = service.recordTick(who, scope, tickId, when);
            if (!(recorded instanceof AppointmentResult.Ok tick)) return recorded;
            AppointmentResult swept = service.tick(who, scope, when);
            if (!(swept instanceof AppointmentResult.Ok summary)) return swept;
            ObjectNode value = JSON.createObjectNode();
            value.set("tick", tick.value());
            value.set("summary", summary.value());
            return new AppointmentResult.Ok(value);
        }, input);
    }

    // ---- shared steps ----

    private Response command(String authorization, UriInfo uri, String body, Role role,
            ServiceCall call) {
        Principal who = auth.authenticate(authorization);
        Access.requireAnyRole(who, role);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        ObjectNode input = object(body);
        if (input == null) return invalid(List.of(new AppointmentResult.Reason("body", "Send a JSON object.")));
        return run(uri, who, input.path("orderUuid").asText(null), (service, scope) -> call.apply(service, who, scope, input), input);
    }

    @FunctionalInterface
    private interface ServiceCall {
        AppointmentResult apply(AppointmentService service, Principal who, RunContext scope, JsonNode input);
    }

    private Response run(UriInfo uri, Principal who, String orderUuid, BiFunction<AppointmentService, RunContext, AppointmentResult> work,
            JsonNode input) {
        AppointmentService service = wiring.service();
        if (service == null) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            RunContext scope = wiring.scope();
            return render(work.apply(service, scope), scope.runId(), orderUuid);
        } catch (RuntimeException e) {
            return ApiError.response(503, "unavailable", "appointments-unavailable",
                    "Appointments are unavailable. Try again shortly.", true);
        }
    }

    private static Response unsupportedQuery() {
        return ApiError.response(400, "invalid", "unsupported-query", "This operation does not accept that query parameter.", false);
    }

    private static ObjectNode object(String body) {
        try {
            JsonNode node = body == null || body.isBlank() ? null : JSON.readTree(body);
            return node != null && node.isObject() ? (ObjectNode) node : null;
        } catch (java.io.IOException e) {
            return null;
        }
    }

    private static Response invalid(List<AppointmentResult.Reason> reasons) {
        return render(new AppointmentResult.Invalid(AppointmentService.INVALID, reasons), null, null);
    }

    /** Every outcome in the contract envelope; never a token, a stack trace or an upstream message. */
    static Response render(AppointmentResult result, String runId, String orderUuid) {
        ObjectNode body = JSON.createObjectNode();
        switch (result) {
            case AppointmentResult.Ok ok -> {
                JsonNode pending = ok.value().path("pending");
                if (pending.isObject() && orderUuid != null) return uncertain(ok.value(), pending, runId, orderUuid);
                body.put("status", "ok");
                body.set("value", ok.value());
                return Response.ok(body).build();
            }
            case AppointmentResult.Pending p -> {
                body.put("status", "pending").put("code", "outcome-uncertain").put("reason", UNCERTAIN_COMMIT);
                body.put("operationId", p.operationId()).put("retryable", false);
                return Response.status(202).entity(body).build();
            }
            case AppointmentResult.Invalid i -> {
                fill(body, "invalid", i.code(), INVALID_REASON, false);
                ArrayNode reasons = body.putArray("reasons");
                i.reasons().forEach(r -> reasons.addObject().put("field", r.field()).put("reason", r.reason()));
                return Response.status(400).entity(body).build();
            }
            case AppointmentResult.Forbidden f -> {
                fill(body, "forbidden", f.code(), f.reason(), false);
                return Response.status(403).entity(body).build();
            }
            case AppointmentResult.NotFound n -> {
                fill(body, "not-found", n.resourceType() + "-not-found", n.reason(), false);
                body.put("resourceType", n.resourceType());
                return Response.status(404).entity(body).build();
            }
            case AppointmentResult.Conflict c -> {
                fill(body, "conflict", c.code(), c.reason(), false);
                c.extra().fields().forEachRemaining(e -> {
                    if (!RESERVED.contains(e.getKey())) body.set(e.getKey(), e.getValue());
                });
                return Response.status(409).entity(body).build();
            }
            case AppointmentResult.Unsupported u -> {
                fill(body, "unsupported", u.code(), u.reason(), false);
                if (u.appointment() != null) body.set("appointment", u.appointment());
                return Response.status(422).entity(body).build();
            }
            case AppointmentResult.Unavailable u -> {
                fill(body, "unavailable", u.code(), u.reason(), u.retryable());
                return Response.status(503).entity(body).build();
            }
        }
    }

    /** A command that committed but left the provider's answer unknown: not success, not a retry. */
    private static Response uncertain(JsonNode model, JsonNode pending, String runId, String orderUuid) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "pending").put("code", "provider-outcome-uncertain");
        body.put("reason", pending.path("reason").asText("Waiting for the provider to confirm the last update."));
        String step = pending.path("step").asText(null);
        if (AppointmentIds.isStep(step) && runId != null) body.put("operationId", AppointmentIds.operationId(runId, orderUuid, step));
        body.put("retryable", false);
        body.set("value", model);
        return Response.status(202).entity(body).build();
    }

    private static void fill(ObjectNode body, String status, String code, String reason, boolean retryable) {
        body.put("status", status).put("code", code).put("reason", reason).put("retryable", retryable);
    }
}
