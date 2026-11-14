package gcsp.api.presenter;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.clock.ClockResult;
import gcsp.api.clock.RunClockHolder;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.scenario.ScenarioFaults;
import gcsp.api.scenario.ScenarioService;
import gcsp.api.scenario.ScenarioWiring;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Function;

/** Presenter-only scenario controls; the scope is the active run, and no endpoint takes a principal or employee. */
@Path("/api/gcsp/v1")
@Produces(MediaType.APPLICATION_JSON)
public class PresenterScenarioResource {

    private static final Set<String> RESET_FIELDS = Set.of("commandId", "expectedRunId", "scenarioId", "scenarioVersion",
            "fixtureVersion", "policyVersion");

    private static final Set<String> FAULT_FIELDS = Set.of("commandId", "adapter", "mode");

    @Inject
    BearerAuthentication auth;

    @Inject
    RunClockHolder holder;

    @Inject
    ScenarioWiring wiring;

    @Inject
    ScenarioFaults faults;

    @GET
    @Path("/presenter/scenarios")
    public Response catalogue(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, ScenarioService::catalogue);
    }

    @GET
    @Path("/presenter/scenarios/current")
    public Response current(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        return read(authorization, uri, ScenarioService::current);
    }

    @POST
    @Path("/presenter/scenarios/reset")
    public Response reset(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        Response blocked = unavailable();
        if (blocked != null) return blocked;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode in = PresenterClockResource.fields(body, RESET_FIELDS, reasons);
        String commandId = in == null ? null : PresenterClockResource.text(in, "commandId", reasons);
        if (commandId != null && (commandId.length() > 128 || !commandId.equals(commandId.strip()))) {
            reasons.add(new String[] {"commandId", "Use text of 1 to 128 characters."});
        }
        String[] values = new String[RESET_FIELDS.size()];
        List<String> names = List.of("expectedRunId", "scenarioId", "scenarioVersion", "fixtureVersion", "policyVersion");
        for (int i = 0; i < names.size(); i++) {
            values[i] = in == null ? null : PresenterClockResource.text(in, names.get(i), reasons);
        }
        if (!reasons.isEmpty()) {
            return PresenterClockResource.invalid("invalid-scenario-command", "The scenario reset request is not valid.",
                    reasons);
        }
        ScenarioService.ResetRequest request = new ScenarioService.ResetRequest(commandId, values[0], values[1], values[2],
                values[3], values[4]);
        return execute(principal, service -> service.reset(scope(principal), request));
    }

    @GET
    @Path("/presenter/scenarios/faults")
    public Response readFaults(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        Response blocked = unavailable();
        if (blocked != null) return blocked;
        return execute(principal, service -> faults.read(scope(principal)));
    }

    @POST
    @Path("/presenter/scenarios/faults")
    public Response setFault(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        Response blocked = unavailable();
        if (blocked != null) return blocked;
        List<String[]> reasons = new ArrayList<>();
        ObjectNode in = PresenterClockResource.fields(body, FAULT_FIELDS, reasons);
        String commandId = in == null ? null : PresenterClockResource.text(in, "commandId", reasons);
        String adapter = in == null ? null : PresenterClockResource.text(in, "adapter", reasons);
        String mode = in == null ? null : PresenterClockResource.text(in, "mode", reasons);
        if (adapter != null && !ScenarioFaults.ADAPTERS.contains(adapter)) {
            reasons.add(new String[] {"adapter", "Choose one of: " + String.join(", ", ScenarioFaults.ADAPTERS) + "."});
        }
        if (mode != null && !ScenarioFaults.MODES.contains(mode)) {
            reasons.add(new String[] {"mode", "Choose one of: " + String.join(", ", ScenarioFaults.MODES) + "."});
        }
        if (!reasons.isEmpty()) {
            return PresenterClockResource.invalid("invalid-fault-command", "The fault request is not valid.", reasons);
        }
        return execute(principal, service -> faults.set(scope(principal), commandId, adapter, mode));
    }

    // ---- shared steps ----

    private Response read(String authorization, UriInfo uri, java.util.function.BiFunction<ScenarioService, RunContext, ClockResult> action) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        if (!uri.getQueryParameters().isEmpty()) return unsupportedQuery();
        Response blocked = unavailable();
        if (blocked != null) return blocked;
        return execute(principal, service -> action.apply(service, scope(principal)));
    }

    private RunContext scope(Principal principal) {
        return holder.scope("presenter:" + principal.subject());
    }

    /** 403 when the provider is none, 503 when the database is off; null when the controls can answer. */
    private Response unavailable() {
        if (!wiring.demo()) {
            return ApiError.response(403, "forbidden", "scenarios-not-configured",
                    "Scenario controls are not configured on this service.", false);
        }
        if (!wiring.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        return null;
    }

    private Response execute(Principal principal, Function<ScenarioService, ClockResult> action) {
        try {
            return map(action.apply(wiring.service()));
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable", "The database could not be reached.", true);
        }
    }

    /** A refused reset is 403: the running database can never be reset. Everything else follows the clock mapping. */
    static Response map(ClockResult result) {
        if (result instanceof ClockResult.Failure f
                && ("reset-not-allowed".equals(f.code()) || "reset-isolation-mismatch".equals(f.code()))) {
            return ApiError.response(403, "forbidden", f.code(), f.reason(), false);
        }
        return PresenterClockResource.map(result);
    }

    private static Response unsupportedQuery() {
        return ApiError.response(400, "invalid", "unsupported-query",
                "This operation does not accept that query parameter.", false);
    }
}
