package gcsp.api.evidence;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.UriInfo;

/** Test-only: shows what the framework hands a resource as the raw path, so the %2F behaviour is pinned. */
@Path("/test-raw-path")
public class RawPathProbeResource {

    @GET
    @Path("{rest:.*}")
    @Produces("text/plain")
    public String raw(@Context UriInfo uri) {
        return uri.getRequestUri().getRawPath();
    }
}
