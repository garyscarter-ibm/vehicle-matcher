package gcsp.api.cases;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.cases.CaseResult.Refusal;
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
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/** The renewal case endpoints over HTTP; scope comes only from the bearer principal, never from the request. */
@Produces(MediaType.APPLICATION_JSON)
@Blocking
@Path("/api/gcsp/v1")
public class CaseResource {

    private static final String CASE_ID = "caseId";
    private static final String QUERY_REASON = "Cases use the current signed-in account.";

    @Inject
    BearerAuthentication auth;

    @Inject
    CaseServiceHolder holder;

    /** One operation over its scope, given the caseId query value (or null) and the raw body (or null). */
    @FunctionalInterface
    private interface Op<S> {
        CaseResult run(CaseService service, S scope, String caseId, String body);
    }

    @GET
    @Path("/help")
    public Response help(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return serve(authorization, uri, Set.of(), CaseResource::employeeScope, null,
                (service, scope, caseId, body) -> service.readHelp(scope));
    }

    @GET
    @Path("/cases")
    public Response ownCases(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return serve(authorization, uri, Set.of(CASE_ID), CaseResource::employeeScope, null,
                (service, scope, caseId, body) -> service.readOwn(scope, Optional.ofNullable(caseId)));
    }

    @POST
    @Path("/cases")
    public Response requestHelp(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return serve(authorization, uri, Set.of(), CaseResource::employeeScope, body, (service, scope, caseId, raw) -> {
            JsonNode input = parse(raw);
            return input == null ? invalidBody() : service.requestHelp(scope, input);
        });
    }

    @GET
    @Path("/scheme-team/cases")
    public Response allCases(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return serve(authorization, uri, Set.of(), CaseResource::gregScope, null,
                (service, scope, caseId, body) -> service.list(scope));
    }

    @GET
    @Path("/scheme-team/cases/options")
    public Response options(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return serve(authorization, uri, Set.of(CASE_ID), CaseResource::gregScope, null,
                (service, scope, caseId, body) -> service.readOptions(scope, caseId));
    }

    @POST
    @Path("/scheme-team/cases/update")
    public Response update(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        return serve(authorization, uri, Set.of(), CaseResource::gregScope, body, (service, scope, caseId, raw) -> {
            JsonNode input = parse(raw);
            return input == null ? invalidBody() : service.update(scope, input);
        });
    }

    /** Authenticates, then role and owner, then the query rule, then availability; only then does the operation run. */
    private <S> Response serve(String authorization, UriInfo uri, Set<String> allowed, Function<Principal, S> scopeOf,
            String body, Op<S> op) {
        S scope = scopeOf.apply(auth.authenticate(authorization));
        if (!queryAllowed(uri, allowed)) return respond(unsupportedQuery());
        Optional<CaseService> service = scope == null ? Optional.empty() : holder.service();
        if (service.isEmpty()) return respond(Refusal.unavailable());
        return respond(op.run(service.get(), scope, uri.getQueryParameters().getFirst(CASE_ID), body));
    }

    /** True when every query key is allowed and none repeats, so a second caseId is refused. */
    private static boolean queryAllowed(UriInfo uri, Set<String> allowed) {
        MultivaluedMap<String, String> query = uri.getQueryParameters();
        return query.entrySet().stream().allMatch(e -> allowed.contains(e.getKey()) && e.getValue().size() == 1);
    }

    /** The employee scope from the principal; null when its context is incomplete. The role and owner checks throw. */
    static EmployeeScope employeeScope(Principal p) {
        Access.requireAnyRole(p, Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        if (incomplete(p)) return null;
        return new EmployeeScope(p.environmentId(), p.runId(), p.employeeId(), p.subject(), p.policyVersion());
    }

    /** The scheme-team scope, for Greg alone: the presenter and employees are refused by role. */
    static GregScope gregScope(Principal p) {
        Access.requireAnyRole(p, Role.GREG);
        if (incomplete(p)) return null;
        return new GregScope(p.environmentId(), p.runId(), p.subject(), p.policyVersion());
    }

    private static boolean incomplete(Principal p) {
        return blank(p.environmentId()) || blank(p.runId()) || blank(p.policyVersion()) || blank(p.subject());
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** The body as a JSON object, or null when it is missing, malformed or not an object. */
    static JsonNode parse(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            JsonNode n = CaseJson.M.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                    .readTree(body);
            return CaseJson.object(n) ? n : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Refusal invalidBody() {
        return Refusal.invalid("invalid-case-command", "body", "Send the command as a JSON object.");
    }

    /** Refuses a query the endpoint does not take; no action field, so the body is the documented shape. */
    private static Refusal unsupportedQuery() {
        ObjectNode extra = CaseJson.obj();
        extra.putArray("reasons").addObject().put("field", "query").put("reason", QUERY_REASON);
        return new Refusal(400, "invalid", "unsupported-query", QUERY_REASON, false, extra);
    }

    private static Response respond(CaseResult result) {
        if (result instanceof CaseResult.Ok ok) {
            ObjectNode out = CaseJson.obj();
            out.put("status", "ok");
            out.set("value", ok.value());
            if (ok.replayed()) out.put("replayed", true);
            return Response.ok(out).build();
        }
        Refusal r = (Refusal) result;
        return Response.status(r.httpStatus()).type(MediaType.APPLICATION_JSON_TYPE).entity(r.body()).build();
    }
}
