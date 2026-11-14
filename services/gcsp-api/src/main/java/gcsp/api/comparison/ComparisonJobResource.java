package gcsp.api.comparison;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.io.IOException;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;

/** Greg starts a comparison job; Greg and the presenter read its status. There is no cancel or restart route. */
@Path("/api/gcsp/v1/comparison/jobs")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ComparisonJobResource {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    BearerAuthentication auth;

    @Inject
    ComparisonJobs jobs;

    @POST
    public Response start(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        Response early = ComparisonResource.unsupportedQuery(uri);
        if (early != null) return early;
        if (!jobs.available()) return notConfigured();
        JsonNode parsed;
        try {
            parsed = body == null || body.isBlank() ? null
                    : JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        } catch (IOException e) {
            parsed = null;
        }
        return answer(jobs.start(principal.subject(), parsed == null ? JSON.getNodeFactory().nullNode() : parsed));
    }

    @GET
    @Path("/latest")
    public Response latest(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Access.requireAnyRole(auth.authenticate(authorization), Role.GREG, Role.PRESENTER);
        Response early = ComparisonResource.unsupportedQuery(uri, "jobId");
        if (early != null) return early;
        List<String> given = uri.getQueryParameters().get("jobId");
        if (given != null && (given.size() != 1 || given.get(0).isEmpty())) {
            ObjectNode out = JSON.createObjectNode();
            out.put("status", "invalid");
            out.put("code", "invalid-query");
            out.put("reason", "Give one job id.");
            out.put("retryable", false);
            out.putArray("reasons").addObject().put("field", "jobId").put("reason", "Give one job id.");
            return Response.status(400).entity(out).build();
        }
        if (!jobs.available()) return notConfigured();
        try {
            Optional<ObjectNode> found = jobs.read(given == null ? null : given.get(0));
            ObjectNode out = JSON.createObjectNode();
            out.put("status", found.isPresent() ? "ok" : "not-found");
            if (found.isPresent()) out.set("value", found.get());
            out.put("reruns", jobs.reruns());
            return Response.status(found.isPresent() ? 200 : 404).entity(out).build();
        } catch (SQLException | RuntimeException e) {
            return ApiError.response(503, "unavailable", "comparison-unavailable", "The comparison job could not be read.", true);
        }
    }

    private static Response notConfigured() {
        return ApiError.response(503, "unavailable", "persistence-not-configured",
                "The database is not configured on this service.", false);
    }

    private static Response answer(ComparisonJobs.Answer a) {
        return Response.status(a.http()).type(MediaType.APPLICATION_JSON_TYPE).entity(a.body()).build();
    }
}
