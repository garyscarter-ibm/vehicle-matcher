package gcsp.api.account;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
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

/** GET /api/gcsp/v1/manual/account: the caller's own account projection; no parameter can name another employee. */
@Path("/api/gcsp/v1/manual/account")
@Produces(MediaType.APPLICATION_JSON)
public class AccountResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    AccountSelection selection;

    @Inject
    AccountService service;

    @GET
    public Response account(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
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
        AccountScope scope = new AccountScope(principal.environmentId(), principal.runId(), principal.employeeId(),
                null, principal.roles(), null, null, null, null, principal.policyVersion());
        AccountOutcome outcome = service.readAccount(scope);
        if (!outcome.isOk()) {
            return Response.status(503).entity(outcome.refusal()).build();
        }
        ObjectNode body = JsonNodeFactory.instance.objectNode().put("status", "ok");
        body.set("value", outcome.value());
        return Response.ok(body).build();
    }
}
