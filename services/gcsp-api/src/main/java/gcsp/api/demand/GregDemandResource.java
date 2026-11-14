package gcsp.api.demand;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import io.smallrye.common.annotation.Blocking;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.Optional;

/** Greg's saved-demand projection; scope comes only from the bearer principal, never from the request. */
@Path("/api/gcsp/v1/greg/demand")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class GregDemandResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    DemandServices services;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        if (!uri.getQueryParameters().isEmpty()) {
            return respond(Response.status(400).type(MediaType.APPLICATION_JSON_TYPE).entity(unsupportedQuery(
                    "Demand uses the current trusted role and run, without display sampling.")));
        }
        DemandScope scope = scope(principal);
        if (scope == null) {
            return respond(Response.status(503).type(MediaType.APPLICATION_JSON_TYPE).entity(
                    DemandResult.Refusal.unavailable("demand-unavailable").body()));
        }
        Optional<DemandService> service = services.demand();
        if (service.isEmpty()) return notConfigured();
        return respond(service.get().read(scope));
    }

    /** The run scope from the principal; null when the resolved context is incomplete. */
    static DemandScope scope(Principal p) {
        if (blank(p.environmentId()) || blank(p.runId()) || blank(p.policyVersion())) return null;
        return new DemandScope(p.environmentId(), p.runId(), p.policyVersion());
    }

    static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    static ObjectNode unsupportedQuery(String reason) {
        ObjectNode body = Demand.obj();
        body.put("status", "invalid").put("code", "unsupported-query").put("reason", reason).put("retryable", false);
        body.putArray("reasons").addObject().put("field", "query").put("reason", reason);
        return body;
    }

    static Response notConfigured() {
        return noStore(ApiError.response(503, "unavailable", "persistence-not-configured",
                "The database is not configured on this service.", false));
    }

    static Response respond(DemandResult result) {
        if (result instanceof DemandResult.Ok ok) {
            ObjectNode out = Demand.obj();
            out.put("status", "ok");
            out.set("value", ok.value());
            return noStore(Response.ok(out).build());
        }
        DemandResult.Refusal r = (DemandResult.Refusal) result;
        return respond(Response.status(r.http()).type(MediaType.APPLICATION_JSON_TYPE).entity(r.body()));
    }

    static Response respond(Response.ResponseBuilder b) {
        return noStore(b.build());
    }

    static Response noStore(Response r) {
        return Response.fromResponse(r).header(HttpHeaders.CACHE_CONTROL, "no-store").build();
    }
}
