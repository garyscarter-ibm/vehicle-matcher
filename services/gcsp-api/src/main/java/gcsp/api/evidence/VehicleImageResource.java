package gcsp.api.evidence;

import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** GET /api/gcsp/v1/vehicle-images/{imageId}.webp: retained, byte-verified imagery only; no live upstream fetch. */
@Path("/api/gcsp/v1/vehicle-images")
@Produces({"image/webp", MediaType.APPLICATION_JSON})
public class VehicleImageResource {

    private static final Pattern FILE = Pattern.compile("(bmw-display-[a-f0-9]{20})\\.webp");

    @Inject
    BearerAuthentication auth;

    @Inject
    EvidenceSelection selection;

    @GET
    @Path("{file}")
    public Response image(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @PathParam("file") String file,
            @Context UriInfo uri) {
        if (!selection.imagesPublic()) Access.requireAnyRole(auth.authenticate(authorization), Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        String query = uri.getRequestUri().getRawQuery();
        if (query != null && !query.isEmpty()) {
            return error(ApiError.response(400, "invalid", "unsupported-query", "This operation takes no query parameters.", false));
        }
        Matcher match = FILE.matcher(file == null ? "" : file);
        DisplayCatalogue catalogue = selection.selected().catalogue();
        if (!match.matches() || catalogue != null && catalogue.available() && !catalogue.knows(match.group(1))) {
            return error(ApiError.response(404, "not-found", "image-not-found", "No retained image has this identifier.", false));
        }
        Optional<DisplayCatalogue.RetainedImage> image = catalogue != null && catalogue.available()
                ? catalogue.retainedImage(match.group(1)) : Optional.empty();
        if (image.isEmpty()) {
            return error(ApiError.response(503, "unavailable", "vehicle-images-unavailable",
                    "Retained vehicle imagery is unavailable. Restore the retained image files and retry.", true));
        }
        return Response.ok(image.get().bytes(), image.get().contentType()).header("Cache-Control", "private, max-age=60")
                .header("X-Content-Type-Options", "nosniff").build();
    }

    private static Response error(Response response) {
        return Response.fromResponse(response).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").build();
    }
}
