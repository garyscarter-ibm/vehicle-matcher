package gcsp.api.offers;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
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
import java.util.List;

/** /api/gcsp/v1/offer-followup: the question after a decline and the one confirmed brief change that answers it. */
@Path("/api/gcsp/v1/offer-followup")
@Produces(MediaType.APPLICATION_JSON)
public class OfferFollowupResource {

    private static final int MAX_BODY = 16 * 1024;
    private static final ObjectMapper JSON = JsonMapper.builder().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    @Inject
    BearerAuthentication auth;

    @Inject
    OfferFollowups followups;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p;
        try {
            p = employee(authorization);
        } catch (IdentityRefusal e) {
            return denied(e);
        }
        var query = uri.getQueryParameters();
        List<String> ids = query.get("decisionId");
        if (query.size() != 1 || ids == null || ids.size() != 1 || !OfferFollowups.text(com.fasterxml.jackson.databind.node.TextNode.valueOf(ids.get(0)))) {
            return OffersResource.render(OfferFollowups.invalid());
        }
        return OffersResource.render(followups.read(p, ids.get(0)));
    }

    @POST
    @Path("/confirm")
    public Response confirm(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal p;
        try {
            p = employee(authorization);
        } catch (IdentityRefusal e) {
            return denied(e);
        }
        if (!uri.getQueryParameters().isEmpty()) return OffersResource.render(OfferFollowups.invalid());
        return OffersResource.render(followups.confirm(p, parse(body)));
    }

    /** Only an employee reads or answers a follow-up; ownership of the decision is checked against the stored decline. */
    private Principal employee(String authorization) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, gcsp.api.auth.Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        return p;
    }

    private static Response denied(IdentityRefusal e) {
        return Response.fromResponse(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()))
                .header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").build();
    }

    private static JsonNode parse(String body) {
        if (body == null || body.isBlank() || body.length() > MAX_BODY) return null;
        try {
            JsonNode node = JSON.readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (java.io.IOException e) {
            return null;
        }
    }
}
