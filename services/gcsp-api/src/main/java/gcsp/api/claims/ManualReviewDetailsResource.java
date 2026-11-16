package gcsp.api.claims;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

/** The employee's own review details for their manual claim: read and save. Freezing is ordering's backend call. */
@Path("/api/gcsp/v1/manual/review-details")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ManualReviewDetailsResource {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    BearerAuthentication auth;

    @Inject
    ManualReviewDetailsHolder holder;

    @Inject
    Persistence persistence;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        return serve(principal, (details, scope) -> details.read(scope));
    }

    @POST
    public Response save(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = employee(authorization);
        Response early = noQuery(uri);
        if (early != null) return early;
        JsonNode input = parse(body);
        return serve(principal, (details, scope) -> details.save(scope, input));
    }

    private Principal employee(String authorization) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        if (principal.employeeId() == null) {
            throw new IdentityRefusal(403, "forbidden", "not-resource-owner", "Your account cannot use this action.", false);
        }
        return principal;
    }

    private Response serve(Principal principal, BiFunction<ManualReviewDetails, ClaimScope, ReviewResult> op) {
        Optional<ManualReviewDetails> details = holder.details();
        if (details.isEmpty()) {
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
            return mapped(op.apply(details.get(), scope));
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable", "The database could not be reached.", true);
        }
    }

    private static Response noQuery(UriInfo uri) {
        if (uri.getQueryParameters().isEmpty()) return null;
        return ApiError.response(400, "invalid", "unsupported-query", "Review details use the trusted employee session.", false);
    }

    private static JsonNode parse(String body) {
        try {
            return body == null || body.isBlank() ? null
                    : JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        } catch (java.io.IOException e) {
            return null;
        }
    }

    /** ok 200, invalid 400, forbidden 403, not found 404, conflict and stale 409, unavailable 503; claim answers as claims map them. */
    static Response mapped(ReviewResult r) {
        if (r instanceof ReviewResult.Claim c) return ManualClaimsResource.mapped(c.result());
        ReviewResult.Body b = (ReviewResult.Body) r;
        int http = switch (b.status()) {
            case "ok" -> 200;
            case "invalid" -> 400;
            case "forbidden" -> 403;
            case "not-found" -> 404;
            case "conflict", "stale-version", "stale-run" -> 409;
            case "unavailable" -> 503;
            default -> 500;
        };
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(b.body()).build();
    }
}
