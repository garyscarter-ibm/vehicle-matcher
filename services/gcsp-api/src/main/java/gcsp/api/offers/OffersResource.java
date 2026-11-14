package gcsp.api.offers;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.IdentityRefusal;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
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

/** /api/gcsp/v1/offers: the signed-in employee's own offers. The offer id in the link grants no access. */
@Path("/api/gcsp/v1/offers")
@Produces(MediaType.APPLICATION_JSON)
public class OffersResource {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    @Inject
    BearerAuthentication auth;

    @Inject
    OfferAccess access;

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

    private static OfferOutcome unsupportedQuery() {
        return OfferOutcome.invalid("unsupported-query", "Offers do not take query parameters.");
    }

    /** The documented envelope; never the offer id of a refused lookup, a token or exception text. */
    static Response render(OfferOutcome o) {
        ObjectNode body = F.objectNode();
        body.put("status", o.status());
        if (o.http() == 200) {
            body.set("value", o.value());
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
