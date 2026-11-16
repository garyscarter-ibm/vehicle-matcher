package gcsp.api.planning;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.policy.PolicyService;
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

/**
 * Greg's order plan: read it from current demand and supply, or preview edited constraints. Neither route writes.
 * The run and actor come from the bearer only; submission is a later story.
 */
@Path("/api/gcsp/v1/greg/order-plan")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class GregOrderPlanResource {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    @Inject
    BearerAuthentication auth;

    @Inject
    PolicyService policy;

    @Inject
    PlanningDemand demand;

    @Inject
    PlanningSupply supply;

    @Inject
    PlanningClock clock;

    @Inject
    SubmissionHistory history;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            @HeaderParam(HttpHeaders.CONTENT_LENGTH) String length, @HeaderParam("Transfer-Encoding") String encoding) {
        Principal principal = greg(authorization);
        if (!uri.getQueryParameters().isEmpty()) {
            return PlanningResponses.invalid("unsupported-query", "query",
                    "The order plan uses the current trusted run and role.");
        }
        if (encoding != null || length != null && !length.isBlank() && !"0".equals(length.trim())) {
            return PlanningResponses.invalid("unsupported-body", "body", "Order plan reads do not accept a body.");
        }
        return PlanningResponses.of(operations().readPlan(principal));
    }

    @POST
    @Path("/preview")
    public Response preview(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = greg(authorization);
        if (!uri.getQueryParameters().isEmpty()) {
            return PlanningResponses.invalid("unsupported-query", "query",
                    "The order plan uses the current trusted run and role.");
        }
        return PlanningResponses.of(operations().previewPlan(principal, parse(body)));
    }

    private OrderPlanOperations operations() {
        return new OrderPlanOperations(policy, demand, supply, clock, history);
    }

    private Principal greg(String authorization) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        return principal;
    }

    /** The JSON body, or null when it is absent or not one well-formed JSON document. */
    private static JsonNode parse(String body) {
        try {
            return body == null || body.isBlank() ? null : MAPPER.readTree(body);
        } catch (java.io.IOException e) {
            return null;
        }
    }
}
