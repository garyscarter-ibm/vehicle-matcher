package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
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
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Greg's order requests (tracking, one explicit line, queueing) and the presenter's guarded Production step, over the same
 * service and store as the plan path. Scope is the server's active run; the presenter step never submits a request.
 */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class GregOrdersResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    ProductionServiceHolder holder;

    @Inject
    Persistence persistence;

    @GET
    @Path("/greg/orders")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            @HeaderParam(HttpHeaders.CONTENT_LENGTH) String length, @HeaderParam("Transfer-Encoding") String encoding) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        Response early = ProductionResource.noQuery(uri);
        if (early != null) return early;
        if (encoding != null || length != null && !length.isBlank() && !"0".equals(length.trim())) {
            return ApiError.response(400, "invalid", "unsupported-body", "This operation does not accept a body.", false);
        }
        return serve(principal, (service, scope) -> ProductionResource.mapped(service.orders(scope, principal.policyVersion())));
    }

    /** Greg's explicit single-line request, checked against the policy and stock versions he saw. */
    @POST
    @Path("/greg/orders")
    public Response submit(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        Response early = ProductionResource.noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = ProductionResource.object(body, Set.of("commandId", "model", "derivative", "quantity",
                "expectedPolicyVersion", "expectedStockVersion", "plan"), false, reasons);
        String commandId = ProductionResource.text(node, "commandId", 200, true, reasons);
        String model = ProductionResource.text(node, "model", 200, true, reasons);
        String derivative = ProductionResource.text(node, "derivative", 200, true, reasons);
        String policy = ProductionResource.text(node, "expectedPolicyVersion", 200, true, reasons);
        String stock = ProductionResource.text(node, "expectedStockVersion", 200, true, reasons);
        int quantity = quantity(node, reasons);
        JsonNode plan = plan(node, reasons);
        if (!reasons.isEmpty()) return ProductionResource.invalid(reasons);
        return serve(principal, (service, scope) -> ProductionResource.mapped(service.submitManual(scope, principal,
                new ProductionService.ManualInput(commandId, model, derivative, quantity, policy, stock, plan))));
    }

    /** Queues one request's confirmations into supply; it never asks Production for anything. */
    @POST
    @Path("/greg/orders/queue")
    public Response queue(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        Response early = ProductionResource.noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = ProductionResource.object(body, Set.of("commandId", "requestId"), false, reasons);
        ProductionResource.text(node, "commandId", 200, true, reasons);
        String requestId = ProductionResource.text(node, "requestId", 200, true, reasons);
        if (!reasons.isEmpty()) return ProductionResource.invalid(reasons);
        return serve(principal, (service, scope) -> ProductionResource.mapped(service.queueRequest(scope, requestId)));
    }

    /** Presenter scenario control with a version guard and a command receipt; the inventory replacement for stepProduction. */
    @POST
    @Path("/presenter/production")
    public Response step(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = ProductionResource.noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = ProductionResource.object(body, Set.of("commandId", "requestId", "expectedVersion", "action",
                "quantity", "delayUntil", "reason"), false, reasons);
        String commandId = ProductionResource.text(node, "commandId", 200, true, reasons);
        String requestId = ProductionResource.text(node, "requestId", 200, true, reasons);
        String action = ProductionResource.text(node, "action", 20, true, reasons);
        if (action != null && !Set.of("confirm", "delay", "refuse").contains(action)) {
            reasons.add(new String[] {"action", "Choose confirm, delay or refuse."});
        }
        JsonNode v = node == null ? null : node.get("expectedVersion");
        long version = 0;
        if (v == null || !v.isIntegralNumber() || !v.canConvertToLong() || v.asLong() < 1) {
            if (node != null) reasons.add(new String[] {"expectedVersion", "Send the request version you saw, a whole number from 1."});
        } else {
            version = v.asLong();
        }
        JsonNode q = node == null ? null : node.get("quantity");
        Integer quantity = null;
        if (q != null && !q.isNull()) {
            if (!q.isIntegralNumber() || !q.canConvertToInt()) reasons.add(new String[] {"quantity", "Use a whole number of vehicles."});
            else quantity = q.asInt();
        }
        String delayText = ProductionResource.text(node, "delayUntil", 40, false, reasons);
        Instant delayUntil = null;
        if (delayText != null) {
            try {
                delayUntil = Instant.parse(delayText);
            } catch (DateTimeParseException e) {
                reasons.add(new String[] {"delayUntil", "Use a UTC date and time such as 2026-11-20T09:00:00Z."});
            }
        }
        String reason = ProductionResource.text(node, "reason", 500, false, reasons);
        if (!reasons.isEmpty()) return ProductionResource.invalid(reasons);
        ProductionService.StepInput in = new ProductionService.StepInput(commandId, requestId, version, action, quantity, delayUntil, reason);
        return serve(principal, (service, scope) -> ProductionResource.mapped(service.stepProduction(scope, in)));
    }

    private Response serve(Principal principal, ProductionResource.Operation op) {
        return ProductionResource.serve(holder, persistence, principal, op);
    }

    private static int quantity(ObjectNode node, List<String[]> reasons) {
        JsonNode v = node == null ? null : node.get("quantity");
        if (v == null || !v.isIntegralNumber() || !v.canConvertToInt() || v.asInt() < 1 || v.asInt() > 1000) {
            if (node != null) reasons.add(new String[] {"quantity", "Use a whole number of vehicles from 1 to 1000."});
            return 0;
        }
        return v.asInt();
    }

    /** The optional plan reference Greg's request came from: its id and input versions, kept as given. */
    private static JsonNode plan(ObjectNode node, List<String[]> reasons) {
        JsonNode p = node == null ? null : node.get("plan");
        if (p == null) return null;
        boolean ok = p.isObject() && p.size() <= 3 && p.hasNonNull("planId") && p.get("planId").isTextual()
                && !p.get("planId").asText().isBlank() && p.get("planId").asText().length() <= 512
                && p.path("versions").isObject() && p.get("versions").size() <= 50;
        if (ok) {
            var names = p.fieldNames();
            while (names.hasNext()) ok &= Set.of("planId", "submissionId", "versions").contains(names.next());
            for (var e : (Iterable<java.util.Map.Entry<String, JsonNode>>) () -> p.get("versions").fields()) {
                ok &= e.getValue().isTextual() && !e.getValue().asText().isBlank() && e.getValue().asText().length() <= 200;
            }
            ok &= !p.has("submissionId") || p.get("submissionId").isTextual() && p.get("submissionId").asText().length() <= 200;
        }
        if (!ok) reasons.add(new String[] {"plan", "Send the plan id and its input versions as text values."});
        return ok ? p : null;
    }
}
