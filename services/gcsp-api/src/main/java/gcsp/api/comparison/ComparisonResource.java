package gcsp.api.comparison;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import io.smallrye.common.annotation.Blocking;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;

/** Read-only stored comparison results for Greg and the presenter; the scope is the server's, never the request's. */
@Path("/api/gcsp/v1/comparison")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ComparisonResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EXPERIMENT_REASON = "Choose one of the known comparison experiments.";
    private static final String UNAVAILABLE = "The stored comparison result is unavailable.";

    @Inject
    BearerAuthentication auth;

    @Inject
    ComparisonService service;

    @Inject
    PolicyService policy;

    @Inject
    PolicyClock clock;

    @GET
    @Path("/results/latest")
    public Response results(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Access.requireAnyRole(auth.authenticate(authorization), Role.GREG, Role.PRESENTER);
        Response early = unsupportedQuery(uri, "experimentId");
        if (early != null) return early;
        List<String> given = uri.getQueryParameters().get("experimentId");
        if (given != null && (given.size() != 1 || !RetainedComparisonResults.EXPERIMENT_IDS.contains(given.get(0)))) {
            return invalidExperiment();
        }
        return serve(given == null ? null : given.get(0));
    }

    @GET
    @Path("/process/latest")
    public Response process(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Access.requireAnyRole(auth.authenticate(authorization), Role.GREG, Role.PRESENTER);
        Response early = unsupportedQuery(uri);
        if (early != null) return early;
        return serve(RetainedComparisonResults.PROCESS_ID);
    }

    /** One experiment (404 when none stored), or every experiment in order when the id is null. */
    private Response serve(String experimentId) {
        if (!service.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        String active;
        try {
            RunContext scope = service.scope("comparison");
            PolicyResult found = policy.getActiveVersion(
                    new PolicyRead(scope.runId(), PolicyClock.iso(clock.now(scope)), null));
            if (!found.ok()) return policyUnavailable();
            active = found.policyVersion();
            ComparisonStore store = service.store();
            if (experimentId != null) {
                Optional<ComparisonStore.Stored> latest = store.latest(scope.environmentId(), experimentId);
                if (latest.isEmpty()) {
                    return ApiError.response(404, "not-found", "comparison-result-not-found",
                            "No comparison result is stored for that experiment.", false);
                }
                return ok(readOf(latest.get(), active));
            }
            Map<String, ComparisonStore.Stored> all = store.latestAll(scope.environmentId());
            ObjectNode value = JSON.createObjectNode();
            value.put("activePolicyVersion", active);
            ArrayNode list = value.putArray("experiments");
            for (String id : RetainedComparisonResults.EXPERIMENT_IDS) {
                ObjectNode entry = list.addObject();
                entry.put("experimentId", id);
                entry.set("latest", all.containsKey(id) ? readOf(all.get(id), active) : JSON.nullNode());
            }
            return ok(value);
        } catch (SQLException | IllegalStateException e) {
            return ApiError.response(503, "unavailable", "comparison-unavailable", UNAVAILABLE, true);
        } catch (RuntimeException e) {
            return policyUnavailable();
        }
    }

    private static ObjectNode readOf(ComparisonStore.Stored s, String active) {
        ObjectNode n = JSON.createObjectNode();
        n.set("result", s.result());
        n.put("resultId", s.resultId());
        n.put("storedAt", s.storedAt().toString());
        n.put("policyVersion", s.policyVersion());
        n.put("activePolicyVersion", active);
        n.put("policyCurrent", active.equals(s.policyVersion()));
        n.put("resultDigest", s.digest());
        n.put("origin", s.origin());
        return n;
    }

    private static Response policyUnavailable() {
        return ApiError.response(503, "unavailable", "policy-unavailable",
                "The active policy version is unavailable.", true);
    }

    private static Response invalidExperiment() {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", "invalid-experiment");
        body.put("reason", EXPERIMENT_REASON);
        body.put("retryable", false);
        body.putArray("reasons").addObject().put("field", "experimentId").put("reason", EXPERIMENT_REASON);
        return Response.status(400).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }

    /** Names every query field the route does not take. */
    static Response unsupportedQuery(UriInfo uri, String... allowed) {
        List<String> ok = List.of(allowed);
        TreeSet<String> extra = new TreeSet<>(uri.getQueryParameters().keySet());
        extra.removeIf(ok::contains);
        if (extra.isEmpty()) return null;
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", "unsupported-query");
        body.put("reason", "This operation does not accept that query parameter.");
        body.put("retryable", false);
        ArrayNode reasons = body.putArray("reasons");
        for (String field : extra) {
            reasons.addObject().put("field", field).put("reason",
                    ok.isEmpty() ? "This route takes no query." : "Only " + String.join(", ", ok) + " can be given here.");
        }
        return Response.status(400).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }

    private static Response ok(com.fasterxml.jackson.databind.JsonNode value) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).build();
    }
}
