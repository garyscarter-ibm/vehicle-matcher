package gcsp.api.context;

import com.fasterxml.jackson.annotation.JsonInclude;
import gcsp.api.error.ApiError;
import gcsp.api.identity.IdentityPort;
import gcsp.api.identity.IdentityResult;
import gcsp.api.identity.Principal;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/** GET /api/gcsp/v1/context: the caller's server-resolved context, or a typed refusal. */
@Path("/api/gcsp/v1/context")
@Produces(MediaType.APPLICATION_JSON)
public class ContextResource {

    @Inject
    IdentityPort identity;

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ContextValue(String subject, List<String> roles, String environmentId, String runId,
            String employeeId, String policyVersion, List<String> capabilities) {

        static ContextValue of(Principal p) {
            return new ContextValue(p.subject(), p.roles(), p.environmentId(), p.runId(), p.employeeId(),
                    p.policyVersion(), p.capabilities());
        }
    }

    public record Ok(String status, ContextValue value) {}

    @GET
    public Response context(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization) {
        if (authorization == null || authorization.isBlank()) {
            return ApiError.response(401, "unauthenticated", "bearer-missing",
                    "Sign in to continue.", false);
        }
        String token = bearer(authorization);
        if (token == null) {
            return ApiError.response(401, "unauthenticated", "bearer-invalid",
                    "Sign in to continue.", false);
        }
        IdentityResult result = identity.resolve(token);
        if (result instanceof IdentityResult.Resolved r) {
            return Response.ok(new Ok("ok", ContextValue.of(r.principal()))).build();
        }
        if (result instanceof IdentityResult.Rejected r) {
            return ApiError.response(401, "unauthenticated", r.code(), "Sign in to continue.", false);
        }
        if (result instanceof IdentityResult.Unmapped r) {
            return ApiError.response(403, "forbidden", r.code(),
                    "This account is not set up for this environment.", false);
        }
        IdentityResult.Unavailable u = (IdentityResult.Unavailable) result;
        return ApiError.response(503, "unavailable", u.code(),
                "Sign-in is not available on this service yet.", u.retryable());
    }

    private static String bearer(String header) {
        String[] parts = header.trim().split("\\s+");
        if (parts.length != 2 || !parts[0].equalsIgnoreCase("Bearer") || parts[1].isEmpty()) {
            return null;
        }
        return parts[1];
    }
}
