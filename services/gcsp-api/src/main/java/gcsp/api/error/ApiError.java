package gcsp.api.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/** Typed non-success body from the FUCQ-434 contract; reference is set only for 500s. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiError(String status, String code, String reason, boolean retryable, String reference) {

    public static Response response(int http, String status, String code, String reason, boolean retryable) {
        return build(http, new ApiError(status, code, reason, retryable, null));
    }

    public static Response build(int http, ApiError body) {
        Response.ResponseBuilder b = Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(body);
        if (http == 401) {
            b.header("WWW-Authenticate", "Bearer");
        }
        return b.build();
    }

    public static Response notFound() {
        return response(404, "not-found", "route-not-found", "No API operation exists at this path.", false);
    }
}
