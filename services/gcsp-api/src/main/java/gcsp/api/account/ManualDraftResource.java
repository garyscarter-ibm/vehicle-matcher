package gcsp.api.account;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
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

/** The employee's own manual draft: read, save and discard. No parameter can name another employee. */
@Path("/api/gcsp/v1/manual/draft")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ManualDraftResource {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    BearerAuthentication auth;

    @Inject
    AccountSelection selection;

    @Inject
    ManualDraftsHolder holder;

    @Inject
    Persistence persistence;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return serve(authorization, uri, null, (drafts, call) -> drafts.read(call.scope), true);
    }

    @POST
    public Response save(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return serve(authorization, uri, body, (drafts, call) -> drafts.save(call.scope, call.subject, call.input), false);
    }

    @POST
    @Path("/discard")
    public Response discard(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return serve(authorization, uri, body, (drafts, call) -> drafts.discard(call.scope, call.subject, call.input), false);
    }

    private record Call(AccountScope scope, String subject, JsonNode input) {}

    /** Employee only, no query, configured provider and database, the active run; then the service's answer. */
    private Response serve(String authorization, UriInfo uri, String body, BiFunction<ManualDrafts, Call, AccountOutcome> op,
            boolean absentIs200) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        Access.requireOwner(principal, principal.employeeId());
        if (!uri.getQueryParameters().isEmpty()) {
            return ApiError.response(400, "invalid", "unsupported-query",
                    "This operation takes no query parameters.", false);
        }
        if (!selection.configured()) {
            return ApiError.response(503, "unavailable", UnconfiguredAccountRecords.CODE,
                    "Account data is not available on this service yet.", false);
        }
        Optional<ManualDrafts> drafts = holder.drafts();
        if (drafts.isEmpty()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            if (!run.environmentId().equals(principal.environmentId()) || !run.runId().equals(principal.runId())) {
                return ApiError.response(409, "conflict", "stale-run",
                        "Your session belongs to an earlier run. Sign in again.", false);
            }
            AccountScope scope = new AccountScope(run.environmentId(), run.runId(), principal.employeeId(), null,
                    principal.roles(), null, null, null, null, principal.policyVersion());
            JsonNode input = body == null && absentIs200 ? null : object(body);
            AccountOutcome outcome = input == null && !absentIs200
                    ? AccountOutcome.refused(ManualDraftRules.invalid("command", "Send a JSON object."))
                    : op.apply(drafts.get(), new Call(scope, principal.subject(), input));
            return mapped(outcome, absentIs200);
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static JsonNode object(String body) {
        if (body == null || body.isBlank()) return JsonNodeFactory.instance.objectNode();
        try {
            JsonNode node = JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (java.io.IOException e) {
            return null;
        }
    }

    /** ok 200, invalid 400, forbidden 403, not found 404 (200 for a draft read), conflict and stale 409, unavailable 503. */
    public static Response mapped(AccountOutcome outcome, boolean absentIs200) {
        if (outcome.isOk()) {
            ObjectNode body = JsonNodeFactory.instance.objectNode().put("status", "ok");
            body.set("value", outcome.value());
            return Response.ok(body).build();
        }
        int http = switch (outcome.status()) {
            case "invalid" -> 400;
            case "forbidden" -> 403;
            case "not-found" -> absentIs200 ? 200 : 404;
            case "conflict", "stale-version", "stale-run" -> 409;
            case "unavailable" -> 503;
            default -> 500;
        };
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(outcome.refusal()).build();
    }
}
