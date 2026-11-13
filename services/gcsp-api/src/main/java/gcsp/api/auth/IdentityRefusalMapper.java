package gcsp.api.auth;

import gcsp.api.error.ApiError;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

/** Turns an {@link IdentityRefusal} into the typed JSON error body. */
public class IdentityRefusalMapper {

    @ServerExceptionMapper
    public Response refusal(IdentityRefusal e) {
        return ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable());
    }
}
