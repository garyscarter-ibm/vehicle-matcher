package gcsp.api.claims;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.EnvironmentGuard;
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
import java.util.Optional;
import java.util.function.BiFunction;

/** The employee's own manual claim. No public allocate route: convertSelection is ordering's backend call. */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ManualClaimsResource {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    BearerAuthentication auth;

    @Inject
    ManualClaimsHolder holder;

    @Inject
    Persistence persistence;

    @GET
    @Path("/manual/claim")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        return serve(principal, (claims, scope) -> claims.readClaim(scope));
    }

    @POST
    @Path("/manual/claim")
    public Response claim(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return command(authorization, uri, body, ManualClaims::claim);
    }

    @POST
    @Path("/manual/claim/review")
    public Response review(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return command(authorization, uri, body, ManualClaims::beginReview);
    }

    @POST
    @Path("/manual/claim/release")
    public Response release(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return command(authorization, uri, body, ManualClaims::release);
    }

    private interface Action {
        ClaimResult run(ManualClaims claims, ClaimScope scope, JsonNode input);
    }

    private Response command(String authorization, UriInfo uri, String body, Action action) {
        Principal principal = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        JsonNode input = object(body);
        if (input == null) return mapped(new ClaimResult.Invalid("body", "Send a JSON object."));
        return serve(principal, (claims, scope) -> action.run(claims, scope, input));
    }

    private Principal employee(String authorization) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        if (principal.employeeId() == null) {
            throw new IdentityRefusal(403, "forbidden", "not-resource-owner",
                    "Your account cannot use this action.", false);
        }
        return principal;
    }

    /** Resolves the active run, refuses a principal bound to another run, then maps the service's answer. */
    private Response serve(Principal principal, BiFunction<ManualClaims, ClaimScope, ClaimResult> op) {
        Optional<ManualClaims> claims = holder.claims();
        if (claims.isEmpty()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            if (!run.environmentId().equals(principal.environmentId()) || !run.runId().equals(principal.runId())) {
                return ApiError.response(409, "conflict", "stale-run",
                        "Your session belongs to an earlier run. Sign in again.", false);
            }
            ClaimScope scope = new ClaimScope(run.environmentId(), run.runId(), principal.subject(),
                    principal.employeeId(), principal.policyVersion());
            return mapped(op.apply(claims.get(), scope));
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static Response noQuery(UriInfo uri) {
        if (uri.getQueryParameters().isEmpty()) return null;
        return ApiError.response(400, "invalid", "unsupported-query",
                "This operation does not accept query parameters.", false);
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

    /** ok 200, invalid 400, forbidden 403, not found 404, conflict 409, pending 202, unavailable 503. */
    static Response mapped(ClaimResult r) {
        ObjectNode body = JSON.createObjectNode();
        if (r instanceof ClaimResult.Ok ok) {
            body.put("status", "ok");
            body.set("value", ok.value() == null ? JSON.nullNode() : ok.value());
            if (ok.replayed()) body.put("replayed", true);
            return Response.ok(body).build();
        }
        int http;
        String status;
        String reason;
        if (r instanceof ClaimResult.Pending p) {
            http = 202;
            status = "pending";
            reason = p.uncertain() ? "The outcome is not known yet. Check the claim before trying again."
                    : "The claim is still being processed.";
            body.put("operationId", p.operationId());
        } else if (r instanceof ClaimResult.Invalid i) {
            http = 400;
            status = "invalid";
            reason = i.reason();
            body.putArray("reasons").addObject().put("field", i.field()).put("reason", i.reason());
        } else if (r instanceof ClaimResult.Forbidden f) {
            http = 403;
            status = "forbidden";
            reason = f.reason();
        } else if (r instanceof ClaimResult.NotFound n) {
            http = 404;
            status = "not-found";
            reason = n.reason();
        } else if (r instanceof ClaimResult.Conflict c) {
            http = 409;
            status = "conflict";
            reason = c.message();
            if (c.extra() instanceof ObjectNode extra) body.setAll(extra);
        } else {
            http = 503;
            status = "unavailable";
            reason = "Manual claims are not available right now.";
        }
        body.put("status", status);
        body.put("code", r instanceof ClaimResult.Pending p && !p.uncertain() ? "operation-pending" : r.code());
        body.put("reason", reason);
        body.put("retryable", r.retryable());
        body.set("view", r.view());
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }
}
