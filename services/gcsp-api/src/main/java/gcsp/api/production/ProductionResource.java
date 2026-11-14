package gcsp.api.production;

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
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Production requests: Greg submits and tracks, the presenter only inspects and scripts the synthetic scenario.
 * Scope is the server's active run, never the request.
 */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ProductionResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String INVALID = "invalid-production-command";
    private static final int DEFAULT_LIMIT = 50;

    @Inject
    BearerAuthentication auth;

    @Inject
    ProductionServiceHolder holder;

    @Inject
    Persistence persistence;

    @GET
    @Path("/greg/production")
    public Response status(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG, Role.PRESENTER);
        Response early = noQuery(uri);
        if (early != null) return early;
        return serve(principal, (service, scope) -> mapped(service.status(scope)));
    }

    @GET
    @Path("/greg/production/supply-activity")
    public Response supplyActivity(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG, Role.PRESENTER);
        Response early = noQuery(uri);
        if (early != null) return early;
        return serve(principal, (service, scope) -> mapped(service.supplyActivity(scope)));
    }

    /** The only request path: Greg's intentional submission of the plan he previewed. */
    @POST
    @Path("/greg/production/requests")
    public Response submit(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        Response early = noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("commandId", "planId", "versions"), false, reasons);
        String commandId = text(node, "commandId", 200, true, reasons);
        String planId = text(node, "planId", 512, true, reasons);
        Map<String, String> versions = versions(node, reasons);
        if (!reasons.isEmpty()) return invalid(reasons);
        return serve(principal, (service, scope) -> mapped(
                service.submit(scope, new ProductionService.SubmitInput(commandId, planId, versions))));
    }

    /** Presenter scenario control: scripts one answer on the synthetic provider, then reconciles that request. Never submits. */
    @POST
    @Path("/presenter/production/responses")
    public Response script(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("requestId", "action", "quantity", "delayUntil", "reason"), false, reasons);
        String requestId = text(node, "requestId", 200, true, reasons);
        String action = text(node, "action", 20, true, reasons);
        if (action != null && !Set.of("confirm", "delay", "refuse").contains(action)) {
            reasons.add(new String[] {"action", "Choose confirm, delay or refuse."});
        }
        Integer quantity = quantity(node, reasons);
        String delayText = text(node, "delayUntil", 40, false, reasons);
        Instant delayUntil = null;
        if (delayText != null) {
            try {
                delayUntil = Instant.parse(delayText);
            } catch (DateTimeParseException e) {
                reasons.add(new String[] {"delayUntil", "Use a UTC date and time such as 2026-11-20T09:00:00Z."});
            }
        }
        String reason = text(node, "reason", 500, false, reasons);
        if (!reasons.isEmpty()) return invalid(reasons);
        Instant until = delayUntil;
        return serve(principal, (service, scope) -> {
            if (!(holder.provider() instanceof SyntheticProductionProvider synthetic)) {
                return ApiError.response(409, "conflict", "production-scenario-unsupported",
                        "Production responses can only be scripted for the synthetic provider.", false);
            }
            Optional<Instant> now = holder.clock().now(scope);
            if (now.isEmpty()) {
                return ApiError.response(503, "unavailable", "clock-not-set",
                        "The demo clock has not been set. Deliver a presenter tick first.", true);
            }
            SyntheticProductionProvider.ScriptResult r = synthetic.script(scope, requestId, action, quantity, until, reason, now.get());
            if (!r.ok()) return scriptRefusal(r);
            ProductionResult settled = service.reconcileRequest(scope, requestId);
            if (settled instanceof ProductionResult.Ok ok && ok.value() instanceof ObjectNode o) {
                ObjectNode copy = o.deepCopy();
                copy.putObject("scripted").put("requestId", requestId).put("action", action).put("seq", r.seq());
                return mapped(new ProductionResult.Ok(copy, false));
            }
            return mapped(settled);
        });
    }

    @POST
    @Path("/presenter/production/reconcile")
    public Response reconcile(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Response early = noQuery(uri);
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode node = object(body, Set.of("limit"), true, reasons);
        int limit = DEFAULT_LIMIT;
        JsonNode l = node == null ? null : node.get("limit");
        if (l != null) {
            if (!l.isIntegralNumber() || !l.canConvertToInt()) reasons.add(new String[] {"limit", "Use a whole number from 1 to 100."});
            else limit = l.asInt();
        }
        if (!reasons.isEmpty()) return invalid(reasons);
        int count = limit;
        return serve(principal, (service, scope) -> mapped(service.reconcile(scope, count)));
    }

    // ---- shared steps ----

    @FunctionalInterface
    private interface Operation {
        Response run(ProductionService service, RunContext scope);
    }

    /** Resolves the active run, refuses a principal bound to another run, then runs the operation. */
    private Response serve(Principal principal, Operation op) {
        Optional<ProductionService> service = holder.service();
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
            return op.run(service.get(), scope);
        } catch (IllegalStateException e) {
            return databaseDown();
        }
    }

    private static Response databaseDown() {
        return ApiError.response(503, "unavailable", "database-unavailable", "The database could not be reached.", true);
    }

    private static Response noQuery(UriInfo uri) {
        if (!uri.getQueryParameters().isEmpty()) {
            return ApiError.response(400, "invalid", "unsupported-query",
                    "This operation does not accept query parameters.", false);
        }
        return null;
    }

    private static Response scriptRefusal(SyntheticProductionProvider.ScriptResult r) {
        int http = "operation-not-found".equals(r.code()) ? 404 : "production-store-unavailable".equals(r.code()) ? 503 : 409;
        String status = http == 404 ? "not-found" : http == 503 ? "unavailable" : "conflict";
        String code = http == 404 ? "request-not-found" : r.code();
        return ApiError.response(http, status, code, r.reason(), http == 503);
    }

    /** The contract mapping: ok 200, pending or uncertain 202, invalid 400, not found 404, conflict 409, else 503. */
    static Response mapped(ProductionResult r) {
        ObjectNode body = JSON.createObjectNode();
        if (r instanceof ProductionResult.Ok ok) {
            JsonNode value = ok.value() == null ? JSON.nullNode() : ok.value().deepCopy();
            if (ok.replayed() && value instanceof ObjectNode o) o.put("replayed", true);
            body.put("status", "ok");
            body.set("value", value);
            return Response.ok(body).build();
        }
        if (r instanceof ProductionResult.Pending p) {
            body.put("status", "pending");
            body.put("code", "outcome-uncertain");
            body.put("reason", "Production has not answered every line yet. Send the same request again to continue without duplicates.");
            body.put("retryable", true);
            body.set("value", p.value());
            return Response.status(202).entity(body).build();
        }
        if (r instanceof ProductionResult.Uncertain u) {
            body.put("status", "pending");
            body.put("code", "outcome-uncertain");
            body.put("reason", "The result is not known yet. Send the same request again to continue.");
            body.put("retryable", false);
            body.put("operationId", u.operationId());
            return Response.status(202).entity(body).build();
        }
        if (r instanceof ProductionResult.Invalid i) {
            boolean missing = "request-not-found".equals(i.code());
            body.put("status", missing ? "not-found" : "invalid");
            body.put("code", i.code());
            body.put("reason", i.reason());
            body.put("retryable", false);
            return Response.status(missing ? 404 : 400).entity(body).build();
        }
        if (r instanceof ProductionResult.Conflict c) {
            body.put("status", "conflict");
            body.put("code", c.code());
            body.put("reason", c.reason());
            body.put("retryable", c.retryable());
            if (c.details() instanceof ObjectNode d) d.fields().forEachRemaining(e -> body.set(e.getKey(), e.getValue()));
            return Response.status(409).entity(body).build();
        }
        ProductionResult.Unavailable u = (ProductionResult.Unavailable) r;
        body.put("status", "unavailable");
        body.put("code", u.code());
        body.put("reason", u.reason());
        body.put("retryable", u.retryable());
        return Response.status(503).entity(body).build();
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

    private static ObjectNode object(String body, Set<String> known, boolean blankOk, List<String[]> reasons) {
        try {
            if (blankOk && (body == null || body.isBlank())) return JSON.createObjectNode();
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

    private static String text(ObjectNode node, String field, int max, boolean required, List<String[]> reasons) {
        if (node == null) return null;
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) {
            if (required) reasons.add(new String[] {field, "Use text of 1 to " + max + " characters."});
            return null;
        }
        if (!v.isTextual() || v.asText().isBlank() || v.asText().length() > max) {
            reasons.add(new String[] {field, "Use text of 1 to " + max + " characters."});
            return null;
        }
        return v.asText();
    }

    private static Integer quantity(ObjectNode node, List<String[]> reasons) {
        JsonNode v = node == null ? null : node.get("quantity");
        if (v == null || v.isNull()) return null;
        if (!v.isIntegralNumber() || !v.canConvertToInt()) {
            reasons.add(new String[] {"quantity", "Use a whole number of vehicles."});
            return null;
        }
        return v.asInt();
    }

    private static Map<String, String> versions(ObjectNode node, List<String[]> reasons) {
        if (node == null) return null;
        JsonNode v = node.get("versions");
        if (v == null || !v.isObject() || v.isEmpty() || v.size() > 50) {
            reasons.add(new String[] {"versions", "Send the input versions the plan was built from, as text values."});
            return null;
        }
        Map<String, String> out = new LinkedHashMap<>();
        v.fields().forEachRemaining(e -> {
            if (!e.getValue().isTextual() || e.getValue().asText().isBlank() || e.getValue().asText().length() > 200
                    || e.getKey().length() > 200) {
                reasons.add(new String[] {"versions." + e.getKey(), "Use a version of 1 to 200 characters."});
            } else {
                out.put(e.getKey(), e.getValue().asText());
            }
        });
        return out;
    }
}
