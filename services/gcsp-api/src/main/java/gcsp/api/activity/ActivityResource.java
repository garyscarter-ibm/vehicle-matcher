package gcsp.api.activity;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.IdentityRefusal;
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

/** The signed-in employee's own activity; scope comes only from the bearer principal, never from the request. */
@Path("/api/gcsp/v1/activity")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ActivityResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    ActivityService service;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
            Access.requireAnyRole(p, Role.EMPLOYEE);
            Access.requireOwner(p, p.employeeId());
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) {
            return secure(ApiError.response(400, "invalid", "unsupported-query",
                    "Activity uses the current trusted employee and run.", false));
        }
        ActivityResult r = service.read(p);
        if (r.value() == null) return secure(ApiError.response(503, "unavailable", r.code(), r.reason(), true));
        ObjectNode body = JsonNodeFactory.instance.objectNode();
        body.put("status", "ok");
        body.set("value", r.value());
        return secure(Response.ok(body).build());
    }

    private static Response secure(Response r) {
        return Response.fromResponse(r).header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").build();
    }
}
