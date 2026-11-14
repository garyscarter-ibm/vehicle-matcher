package gcsp.api.brief;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
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

/** The employee brief over HTTP; scope comes only from the bearer principal, never from the request. */
@Path("/api/gcsp/v1/brief")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class BriefResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    BriefServiceHolder holder;

    @GET
    public Response current(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, BriefService::current);
    }

    @GET
    @Path("/history")
    public Response history(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, BriefService::history);
    }

    @GET
    @Path("/draft")
    public Response draft(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, BriefService::draft);
    }

    @GET
    @Path("/editor")
    public Response editor(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, BriefService::readEditor);
    }

    @POST
    @Path("/draft")
    public Response saveDraft(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::saveDraft);
    }

    @POST
    @Path("/preferences")
    public Response savePreferences(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::savePreferences);
    }

    @POST
    @Path("/confirm")
    public Response confirm(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::confirm);
    }

    @POST
    @Path("/engage")
    public Response engage(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::engage);
    }

    @POST
    @Path("/disengage")
    public Response disengage(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::disengage);
    }

    @POST
    @Path("/pause-search")
    public Response pauseSearch(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::pauseSearch);
    }

    @POST
    @Path("/resume-search")
    public Response resumeSearch(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        return command(authorization, uri, body, BriefService::resumeSearch);
    }

    @FunctionalInterface
    interface Command {
        BriefResult run(BriefService service, BriefScope scope, JsonNode input);
    }

    private Response read(String authorization, UriInfo uri, BiFunction<BriefService, BriefScope, BriefResult> op) {
        return serve(authorization, uri, (service, scope) -> op.apply(service, scope));
    }

    private Response command(String authorization, UriInfo uri, String body, Command op) {
        return serve(authorization, uri, (service, scope) -> {
            JsonNode input = parse(body);
            if (input == null) {
                return BriefResult.Refusal.invalid("invalid-command", "body", "Send the command as a JSON object.");
            }
            return op.run(service, scope, input);
        });
    }

    private Response serve(String authorization, UriInfo uri, BiFunction<BriefService, BriefScope, BriefResult> op) {
        Principal principal = auth.authenticate(authorization);
        BriefScope scope = scope(principal);
        if (!uri.getQueryParameters().isEmpty()) {
            return respond(BriefResult.Refusal.invalid("unsupported-query", "query", "This operation takes no query parameters."));
        }
        Optional<BriefService> service = scope == null ? Optional.empty() : holder.service();
        if (service.isEmpty()) return respond(BriefResult.Refusal.unavailable());
        return respond(op.apply(service.get(), scope));
    }

    /** The employee scope from the principal; null when the resolved context is incomplete. */
    static BriefScope scope(Principal p) {
        Access.requireAnyRole(p, Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        if (blank(p.environmentId()) || blank(p.runId()) || blank(p.policyVersion()) || blank(p.subject())) return null;
        return new BriefScope(p.environmentId(), p.runId(), p.employeeId(), p.subject(), p.policyVersion());
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** The body as a JSON object, or null when it is missing, malformed or not an object. */
    static JsonNode parse(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode n = Json.M.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
            return n != null && n.isObject() ? n : null;
        } catch (Exception e) {
            return null;
        }
    }

    static Response respond(BriefResult result) {
        if (result instanceof BriefResult.Ok ok) {
            ObjectNode out = Json.obj();
            out.put("status", "ok");
            out.set("value", ok.value());
            if (ok.replayed()) out.put("replayed", true);
            return Response.ok(out).build();
        }
        BriefResult.Refusal r = (BriefResult.Refusal) result;
        return Response.status(r.httpStatus()).type(MediaType.APPLICATION_JSON_TYPE).entity(r.body()).build();
    }
}
