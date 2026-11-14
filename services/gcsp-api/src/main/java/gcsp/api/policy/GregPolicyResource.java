package gcsp.api.policy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
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

/** Greg's policy controls: read the active policy and publish a successor. The run and actor come from the bearer only. */
@Path("/api/gcsp/v1/greg/policy")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class GregPolicyResource {

    private static final ObjectMapper MAPPER = JsonMapper.builder()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .build();

    @Inject
    BearerAuthentication auth;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = greg(authorization);
        if (!uri.getQueryParameters().isEmpty()) {
            return noQuery();
        }
        String now = now(principal);
        PolicyResult snapshot = policy.getPolicySnapshot(new PolicyRead(principal.runId(), now, null));
        if (!snapshot.ok()) {
            return PolicyResponses.failure(snapshot);
        }
        try {
            return PolicyResponses.ok(GregPolicyProjection.project((ObjectNode) snapshot.value(), now));
        } catch (GregPolicyProjection.Unavailable e) {
            return PolicyResponses.failure(PolicyBodies.unavailable());
        }
    }

    @POST
    @Path("/preview")
    public Response preview(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        greg(authorization);
        return uri.getQueryParameters().isEmpty() ? PolicyResponses.previewUnavailable() : noQuery();
    }

    @POST
    @Path("/publish")
    public Response publish(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = greg(authorization);
        if (!uri.getQueryParameters().isEmpty()) {
            return noQuery();
        }
        JsonNode input = parse(body);
        if (input == null || !input.isObject()) {
            return PolicyResponses.invalid("invalid-change-set", "body", "Send the change set as a JSON object.");
        }
        String now = now(principal);
        JsonNode expected = input.get("expectedActiveVersion");
        PolicyResult base = GregPolicyProjection.text(expected)
                ? policy.getPolicySnapshot(new PolicyRead(principal.runId(), now, expected.textValue())) : null;
        if (base != null && "unavailable".equals(base.status())) {
            return PolicyResponses.failure(base);
        }
        if (base == null || !base.ok()) {
            return PolicyResponses.invalid("invalid-active-version", "expectedActiveVersion",
                    "Supply a retained active version.");
        }
        GregPolicyProjection.Prepared prepared =
                GregPolicyProjection.changesFor((ObjectNode) base.value(), PolicyTime.parse(now).getAsLong(), input);
        if (prepared.error() != null) {
            return PolicyResponses.failure(prepared.error());
        }
        ObjectNode changeSet = JsonNodeFactory.instance.objectNode();
        for (String key : new String[] {"commandId", "expectedActiveVersion", "policyVersion", "effectiveFrom"}) {
            changeSet.set(key, input.get(key).deepCopy());
        }
        changeSet.set("changes", prepared.changes());
        PolicyResult published = policy.publishPolicyVersion(principal, changeSet);
        if (!published.ok()) {
            return PolicyResponses.failure(published);
        }
        ObjectNode value = ((ObjectNode) published.value()).deepCopy();
        value.put("state", "published");
        value.set("heldOffers", GregPolicyProjection.heldOffersUnknown());
        return PolicyResponses.ok(value);
    }

    private Principal greg(String authorization) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.GREG);
        return principal;
    }

    private String now(Principal principal) {
        return PolicyClock.iso(clock.now(new RunContext(principal.environmentId(), principal.runId(), principal.subject())));
    }

    private static Response noQuery() {
        return PolicyResponses.invalid("unsupported-query", "query", "Policy controls use the current trusted run and role.");
    }

    private static JsonNode parse(String body) {
        try {
            return body == null || body.isBlank() ? null : MAPPER.readTree(body);
        } catch (java.io.IOException e) {
            return null;
        }
    }
}
