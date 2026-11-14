package gcsp.api.ordering;

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
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.Iterator;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The employee's selection handoff and the presenter's reconcile. Scope comes only from the bearer principal and the
 * account's own slot; every POST is an explicit command, so nothing here resumes a draft into an order.
 */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class OrderingResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_LIMIT = 100;

    @Inject
    BearerAuthentication auth;

    @Inject
    OrderingServiceHolder holder;

    @Inject
    OrderingSlots slots;

    @Inject
    OrderingConversions conversions;

    @Inject
    Persistence persistence;

    @GET
    @Path("/manual/order/terms")
    public Response terms(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        return withService(p, (service, run) -> mapped(service.terms(scope(p, null)), false));
    }

    @POST
    @Path("/manual/order")
    public Response submit(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal p = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        JsonNode input = object(body);
        if (input == null) return invalid("body", "Send a JSON object.");
        return withService(p, (service, run) -> {
            if (OrderingSelection.NONE.equals(holder.provider())) {
                return mapped(new OrderingResult.Unavailable("ordering-provider-not-configured"), false);
            }
            OrderingSlots.Slots s = slots.resolve(p);
            if (s.code() != null) return unavailable(s.code());
            String slot = s.orderable() != null ? s.orderable() : existingSlot(service, p, s.all());
            if (slot == null) return entitlementUnavailable();
            return mapped(service.submit(scope(p, slot), input, conversions.forSource("cart")), true);
        });
    }

    /** Reads the caller's own selection; a pending handoff is reconciled first; it never creates a new selection. */
    @GET
    @Path("/manual/order")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        return withService(p, (service, run) -> {
            OrderingSlots.Slots s = slots.resolve(p);
            if (s.code() != null) return unavailable(s.code());
            String slot = s.orderable() != null ? s.orderable() : existingSlot(service, p, s.all());
            if (slot == null) {
                return s.all().isEmpty() ? entitlementUnavailable() : mapped(new OrderingResult.Refused("not-found", 404, null), false);
            }
            OrderingScope scope = scope(p, slot);
            OrderingResult r = service.read(scope);
            if (r instanceof OrderingResult.Pending pending) r = service.reconcile(scope, pending.operationId());
            return mapped(r, false);
        });
    }

    @POST
    @Path("/presenter/ordering/reconcile")
    public Response reconcile(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.PRESENTER);
        Response early = noQuery(uri);
        if (early != null) return early;
        int limit = MAX_LIMIT;
        if (body != null && !body.isBlank()) {
            JsonNode node = object(body);
            if (node == null) return invalid("body", "Send a JSON object.");
            for (Iterator<String> it = node.fieldNames(); it.hasNext();) {
                if (!"limit".equals(it.next())) return invalid("body", "Only limit is accepted.");
            }
            JsonNode l = node.get("limit");
            if (l != null) {
                if (!l.isIntegralNumber() || !l.canConvertToInt() || l.asInt() < 1 || l.asInt() > MAX_LIMIT) {
                    return invalid("limit", "Use a whole number from 1 to 100.");
                }
                limit = l.asInt();
            }
        }
        int n = limit;
        return withService(p, (service, run) -> mapped(service.reconcileOpen(
                new RunContext(run.environmentId(), run.runId(), "presenter:" + p.subject()), n), false));
    }

    // ---- shared steps ----

    /** A slot that already holds a selection (its order may have used the entitlement up), else null. */
    private static String existingSlot(OrderingService service, Principal p, List<String> all) {
        for (String id : all) {
            OrderingResult r = service.read(scope(p, id));
            if (r instanceof OrderingResult.Ok || r instanceof OrderingResult.Pending) return id;
        }
        return null;
    }

    private Principal employee(String authorization) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        return p;
    }

    private static OrderingScope scope(Principal p, String slotId) {
        return new OrderingScope(p.environmentId(), p.runId(), p.employeeId(), slotId, p.policyVersion());
    }

    @FunctionalInterface
    private interface Operation {
        Response run(OrderingService service, RunContext run);
    }

    /** Persistence first, then the principal's run must be the active one; a database failure is a retryable 503. */
    private Response withService(Principal p, Operation op) {
        Optional<OrderingService> service = holder.service();
        if (service.isEmpty()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            if (!run.environmentId().equals(p.environmentId()) || !run.runId().equals(p.runId())) {
                return ApiError.response(409, "conflict", "stale-run",
                        "Your session belongs to an earlier run. Sign in again.", false);
            }
            return op.run(service.get(), new RunContext(run.environmentId(), run.runId(), p.subject()));
        } catch (IllegalStateException e) {
            return unavailable("database-unavailable");
        }
    }

    private static Response noQuery(UriInfo uri) {
        if (!uri.getQueryParameters().isEmpty()) {
            return ApiError.response(400, "invalid", "unsupported-query",
                    "This operation does not accept query parameters.", false);
        }
        return null;
    }

    private static JsonNode object(String body) {
        try {
            JsonNode node = body == null || body.isBlank() ? null
                    : JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (java.io.IOException e) {
            return null;
        }
    }

    // ---- mapping ----

    /** Ok 200 (replayed marked), Pending 202, Refused its status, Unavailable 503. */
    static Response mapped(OrderingResult r, boolean marksReplay) {
        ObjectNode body = JSON.createObjectNode();
        if (r instanceof OrderingResult.Ok ok) {
            JsonNode value = ok.value() == null ? JSON.nullNode() : ok.value().deepCopy();
            if (marksReplay && ok.replayed() && value instanceof ObjectNode o) o.put("replayed", true);
            body.put("status", "ok");
            body.set("value", value);
            return Response.ok(body).build();
        }
        if (r instanceof OrderingResult.Pending p) {
            body.put("status", "pending");
            body.put("code", "handoff-pending");
            body.put("reason", "Your selection is being sent on. Check again shortly; do not choose again.");
            body.put("retryable", false);
            body.put("operationId", p.operationId());
            if (p.value() != null) body.set("value", p.value());
            return Response.status(202).entity(body).build();
        }
        if (r instanceof OrderingResult.Refused f) {
            return refused(f);
        }
        return unavailable(((OrderingResult.Unavailable) r).code());
    }

    private static Response refused(OrderingResult.Refused f) {
        if (f.status() == 400) return invalid(f.field() == null ? "selection" : f.field(), "Check this part of your selection.");
        String status = f.status() == 403 ? "forbidden" : f.status() == 404 ? "not-found" : "conflict";
        return ApiError.response(f.status(), status, f.code(), reason(f.code()), false);
    }

    private static String reason(String code) {
        return switch (code) {
            case "not-found" -> "You have no selection yet.";
            case "forbidden" -> "This selection belongs to another employee.";
            case "active-selection-exists" -> "A different selection already exists for your entitlement.";
            case "terms-changed" -> "The scheme terms have changed. Review them and confirm again.";
            case "quote-changed", "stock-changed", "claim-changed", "claim-expired" ->
                    "Your selection has changed or expired. Review it and confirm again.";
            default -> "Your selection could not be accepted.";
        };
    }

    private static Response unavailable(String code) {
        boolean retryable = !Set.of("ordering-provider-not-configured", UnconfiguredConversion.CODE,
                "order-reference-exhausted").contains(code);
        return ApiError.response(503, "unavailable", code, "Ordering is not available right now.", retryable);
    }

    private static Response entitlementUnavailable() {
        return ApiError.response(409, "conflict", "entitlement-unavailable",
                "You have no entitlement that can be ordered at the moment.", false);
    }

    private static Response invalid(String field, String reason) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", "invalid");
        body.put("reason", "The request is not valid.");
        body.put("retryable", false);
        ArrayNode list = body.putArray("reasons");
        list.addObject().put("field", field).put("reason", reason);
        return Response.status(400).entity(body).build();
    }
}
