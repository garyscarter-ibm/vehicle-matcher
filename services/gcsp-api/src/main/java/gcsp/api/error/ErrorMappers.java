package gcsp.api.error;

import jakarta.ws.rs.NotAllowedException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import java.util.UUID;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

/** Keeps every framework failure inside the JSON envelope; no HTML or stack traces leave the API. */
public class ErrorMappers {

    private static final Logger LOG = Logger.getLogger(ErrorMappers.class);

    @ServerExceptionMapper
    public Response notFound(NotFoundException e) {
        return ApiError.notFound();
    }

    @ServerExceptionMapper
    public Response notAllowed(NotAllowedException e) {
        return ApiError.response(405, "invalid", "method-not-allowed",
                "This operation does not support that HTTP method.", false);
    }

    @ServerExceptionMapper
    public Response webApplication(WebApplicationException e) {
        int http = e.getResponse().getStatus();
        if (http >= 500) {
            return unexpected(e);
        }
        return ApiError.response(http, "invalid", "request-rejected", "The request could not be processed.", false);
    }

    @ServerExceptionMapper
    public Response unexpected(Throwable e) {
        String reference = UUID.randomUUID().toString();
        LOG.errorf(e, "Unexpected failure, reference %s", reference);
        return ApiError.build(500, new ApiError("error", "unexpected", "Something went wrong on the server.",
                true, reference));
    }
}
