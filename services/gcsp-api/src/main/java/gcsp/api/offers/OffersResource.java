package gcsp.api.offers;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;

/** /api/gcsp/v1/offers: the signed-in employee's own offers. The offer id in the link grants no access. */
@Path("/api/gcsp/v1/offers")
@Produces(MediaType.APPLICATION_JSON)
public class OffersResource {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final int MAX_BODY = 16 * 1024;
    private static final ObjectMapper JSON = JsonMapper.builder().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

    @Inject
    BearerAuthentication auth;

    @Inject
    OfferAccess access;

    @Inject
    OfferDecisions decisions;

    @GET
    @Path("/current")
    public Response current(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) return render(unsupportedQuery());
        return render(access.listCurrent(p));
    }

    @GET
    @Path("/{offerId}")
    public Response offer(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @PathParam("offerId") String offerId, @Context UriInfo uri) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) return render(unsupportedQuery());
        return render(access.read(p, offerId));
    }

    @POST
    @Path("/{offerId}/decision")
    public Response decide(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @PathParam("offerId") String offerId, @Context UriInfo uri, String body) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) return render(unsupportedQuery());
        return render(decisions.decide(p, offerId, parse(body)));
    }

    @GET
    @Path("/{offerId}/decision-reasons")
    public Response reasons(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @PathParam("offerId") String offerId, @Context UriInfo uri) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) return render(unsupportedQuery());
        return render(decisions.reasons(p, offerId));
    }

    @GET
    @Path("/{offerId}/follow-up")
    public Response followUp(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @PathParam("offerId") String offerId, @Context UriInfo uri) {
        Principal p;
        try {
            p = auth.authenticate(authorization);
        } catch (IdentityRefusal e) {
            return secure(ApiError.response(e.http(), e.status(), e.code(), e.reason(), e.retryable()));
        }
        if (!uri.getQueryParameters().isEmpty()) return render(unsupportedQuery());
        return render(decisions.followUp(p, offerId));
    }

    /** The JSON object, or null for anything unparsable, oversized or not an object. */
    private static JsonNode parse(String body) {
        if (body == null || body.isBlank() || body.length() > MAX_BODY) return null;
        try {
            JsonNode node = JSON.readTree(body);
            return node != null && node.isObject() ? node : null;
        } catch (java.io.IOException e) {
            return null;
        }
    }

    private static OfferOutcome unsupportedQuery() {
        return OfferOutcome.invalid("unsupported-query", "Offers do not take query parameters.");
    }

    /** The documented envelope; never the offer id of a refused lookup, a token or exception text. */
    static Response render(OfferOutcome o) {
        ObjectNode body = F.objectNode();
        body.put("status", o.status());
        if (o.http() == 200) {
            body.set("value", o.value());
        } else if (o.http() == 202) {
            body.put("code", o.code());
            body.put("reason", o.reason());
            body.put("retryable", false);
            for (String name : new String[] {"operationId", "offerId", "decisionId", "commandId"}) {
                body.set(name, o.value().get(name));
            }
        } else {
            body.put("code", o.code());
            body.put("reason", o.reason());
            body.put("retryable", o.retryable());
            if (o.current() != null) body.set("current", o.current());
        }
        return secure(Response.status(o.http()).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build());
    }

    private static Response secure(Response r) {
        return Response.fromResponse(r).header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer")
                .build();
    }
}
