package gcsp.api.returns;

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
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Old-car return plans for the employee, Greg and the presenter; scope is the server's active run, never the request. */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ReturnResource {

    private static final ObjectMapper JSON = ReturnJson.JSON;
    private static final String INVALID = "invalid-return-command";

    @Inject
    BearerAuthentication auth;

    @Inject
    ReturnService service;

    @GET
    @Path("/return-plan")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of("orderUuid"));
        if (early != null) return early;
        String orderUuid = uri.getQueryParameters().getFirst("orderUuid");
        return serve(principal, (plans, scope) -> mapped(plans.read(scope, caller(principal), orderUuid)));
    }

    @POST
    @Path("/return-plan/request")
    public Response request(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        Response early = unsupportedQuery(uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("commandId", "orderUuid", "choice", "slotId", "expectedVersion"), reasons);
        String commandId = text(node, "commandId", reasons);
        String orderUuid = text(node, "orderUuid", reasons);
        String choice = text(node, "choice", reasons);
        String slotId = text(node, "slotId", reasons);
        long version = version(node, reasons);
        if (!reasons.isEmpty()) return invalid(reasons);
        return serve(principal, (plans, scope) -> mapped(
                plans.request(scope, caller(principal), commandId, orderUuid, choice, slotId, version)));
    }

    @POST
    @Path("/return-plan/accept")
    public Response accept(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        Response early = unsupportedQuery(uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("commandId", "orderUuid", "proposalId", "expectedVersion"), reasons);
        String commandId = text(node, "commandId", reasons);
        String orderUuid = text(node, "orderUuid", reasons);
        String proposalId = text(node, "proposalId", reasons);
        long version = version(node, reasons);
        if (!reasons.isEmpty()) return invalid(reasons);
        return serve(principal, (plans, scope) -> mapped(
                plans.acceptChange(scope, caller(principal), commandId, orderUuid, proposalId, version)));
    }

    /** The presenter's control: reconciles every open return and retries a failed provider write at the demo clock. */
    @POST
    @Path("/presenter/returns/progress")
    public Response progress(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = unsupportedQuery(uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("commandId"), reasons);
        text(node, "commandId", reasons);
        if (!reasons.isEmpty()) return invalid(reasons);
        return serve(principal, (plans, scope) -> {
            Optional<Instant> now = service.clockNow(scope);
            if (now.isEmpty()) {
                return ApiError.response(503, "unavailable", "clock-unavailable",
                        "The demo clock has not been set. Deliver a presenter tick first.", true);
            }
            return ok(summary(plans.progress(scope, now.get(), true)));
        });
    }

    // ---- shared steps ----

    private static ReturnPlans.Caller caller(Principal p) {
        if (p.roles().contains(Role.EMPLOYEE.wire())) return ReturnPlans.Caller.employee(p.employeeId());
        if (p.roles().contains(Role.GREG.wire())) return ReturnPlans.Caller.greg();
        return ReturnPlans.Caller.presenter();
    }

    @FunctionalInterface
    private interface Operation {
        Response run(ReturnPlans plans, RunContext scope);
    }

    private Response serve(Principal principal, Operation op) {
        if (!service.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            return op.run(service.plans(), service.scope(principal.subject()));
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static Response unsupportedQuery(UriInfo uri, Set<String> allowed) {
        for (var e : uri.getQueryParameters().entrySet()) {
            if (!allowed.contains(e.getKey()) || e.getValue().size() > 1) {
                return ApiError.response(400, "invalid", "unsupported-query",
                        "This operation does not accept that query parameter.", false);
            }
        }
        return null;
    }

    private static Response ok(JsonNode value) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).build();
    }

    /** The contract mapping: ok 200, uncertain 202, a refusal to its own status word and code. */
    static Response mapped(PlanResult r) {
        ObjectNode body = JSON.createObjectNode();
        if (r instanceof PlanResult.Ok ok) return ok(ok.json());
        if (r instanceof PlanResult.Pending p) {
            body.put("status", "pending");
            body.put("code", "outcome-uncertain");
            body.put("operationId", p.operationId());
            body.put("retryable", false);
            body.set("value", p.json());
            return Response.status(202).entity(body).build();
        }
        PlanResult.Refused x = (PlanResult.Refused) r;
        body.put("status", word(x.http()));
        body.put("code", x.code());
        body.put("reason", x.reason());
        body.put("retryable", x.retryable());
        if (!x.reasons().isEmpty()) {
            ArrayNode list = body.putArray("reasons");
            for (PlanResult.Reason reason : x.reasons()) list.addObject().put("field", reason.field()).put("reason", reason.reason());
        }
        if (x.plan() != null) {
            body.set("plan", x.plan());
            if (x.http() == 409 && x.plan().path("version").canConvertToLong()) {
                body.put("currentVersion", x.plan().path("version").asLong());
            }
        }
        return Response.status(x.http()).entity(body).build();
    }

    private static String word(int http) {
        return switch (http) {
            case 400 -> "invalid";
            case 403 -> "forbidden";
            case 404 -> "not-found";
            case 409 -> "conflict";
            case 422 -> "unsupported";
            default -> "unavailable";
        };
    }

    private static ObjectNode summary(ReturnPlans.Summary s) {
        ObjectNode value = JSON.createObjectNode();
        value.put("orders", s.orders()).put("applied", s.applied()).put("waiting", s.waiting())
                .put("blocked", s.blocked()).put("uncertain", s.uncertain()).put("idle", s.idle());
        ArrayNode failed = value.putArray("failed");
        for (ReturnPlans.Failure f : s.failed()) {
            ObjectNode item = failed.addObject();
            if (f.orderUuid() == null) item.putNull("orderUuid"); else item.put("orderUuid", f.orderUuid());
            item.put("code", f.code());
        }
        return value;
    }

    private static Response invalid(List<String[]> reasons) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", INVALID);
        body.put("reason", "The request is not valid.");
        body.put("retryable", false);
        ArrayNode list = body.putArray("reasons");
        for (String[] r : reasons) list.addObject().put("field", r[0]).put("reason", r[1]);
        return Response.status(400).entity(body).build();
    }

    // ---- request parsing ----

    private static ObjectNode object(String body, Set<String> known, List<String[]> reasons) {
        try {
            JsonNode node = body == null || body.isBlank() ? null
                    : JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
            if (node != null && node.isObject()) {
                node.fieldNames().forEachRemaining(name -> {
                    if (!known.contains(name)) reasons.add(new String[] {name, "This field is not accepted."});
                });
                return (ObjectNode) node;
            }
        } catch (java.io.IOException e) {
            // reported below
        }
        reasons.add(new String[] {"body", "Send a JSON object."});
        return null;
    }

    private static String text(ObjectNode node, String field, List<String[]> reasons) {
        JsonNode v = node == null ? null : node.get(field);
        if (v == null || !v.isTextual() || !ReturnJson.text(v.asText(), 200)) {
            if (node != null) reasons.add(new String[] {field, "Use text of 1 to 200 characters."});
            return null;
        }
        return v.asText();
    }

    private static long version(ObjectNode node, List<String[]> reasons) {
        JsonNode v = node == null ? null : node.get("expectedVersion");
        if (v == null || !v.isIntegralNumber() || !v.canConvertToLong() || v.asLong() < 0) {
            if (node != null) reasons.add(new String[] {"expectedVersion", "Use the plan version you read, or 0."});
            return -1;
        }
        return v.asLong();
    }
}
