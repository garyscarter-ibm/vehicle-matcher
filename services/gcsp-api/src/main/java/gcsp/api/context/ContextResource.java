package gcsp.api.context;

import com.fasterxml.jackson.annotation.JsonInclude;
import gcsp.api.auth.BearerAuthentication;
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
    BearerAuthentication auth;

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
        Principal principal = auth.authenticate(authorization);
        return Response.ok(new Ok("ok", ContextValue.of(principal))).build();
    }
}
