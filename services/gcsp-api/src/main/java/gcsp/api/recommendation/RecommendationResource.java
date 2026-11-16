package gcsp.api.recommendation;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountClockPort;
import gcsp.api.account.AccountRecordsPort;
import gcsp.api.account.AccountSelection;
import gcsp.api.account.AccountService;
import gcsp.api.account.CurrentCarPort;
import gcsp.api.account.SourceResult;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.Persistence;
import gcsp.api.policy.PolicyAccountAdapter;
import gcsp.api.policy.PolicyService;
import gcsp.api.supply.SupplyRelease;
import io.smallrye.common.annotation.Blocking;
import jakarta.inject.Inject;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;

/** POST /api/gcsp/v1/recommendations: the caller's own recommendations; the context comes only from the principal and account. */
@Path("/api/gcsp/v1/recommendations")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class RecommendationResource {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Inject
    BearerAuthentication auth;

    @Inject
    Persistence persistence;

    @Inject
    AccountSelection selection;

    @Inject
    CurrentCarPort currentCars;

    @Inject
    AccountRecordsPort records;

    @Inject
    AccountClockPort accountClock;

    @Inject
    PolicyService policy;

    @Inject
    SupplyRelease supply;

    @Inject
    VehicleEvidencePort evidence;

    private AccountClockRecommendationClock clock;
    private volatile RecommendationService service;

    @POST
    public Response recommend(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri, String body) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        Access.requireOwner(principal, principal.employeeId());
        if (!uri.getQueryParameters().isEmpty()) {
            return respond(Outcomes.invalid("unsupported-query", Outcomes.one("query",
                    "Employee recommendation inputs belong in the request body.")));
        }
        if (!persistence.active()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "Recommendations are not available on this service yet.", false);
        }
        if (!selection.configured()) {
            return ApiError.response(503, "unavailable", "account-provider-not-configured",
                    "Account data is not available on this service yet.", false);
        }
        AccountClockRecommendationClock clock = clock();
        RecommendationContext context = context(principal);
        if (context == null) {
            JsonNode stale = clock.staleRun(principal.environmentId(), principal.runId());
            if (stale != null) return respond((ObjectNode) stale);
            return ApiError.response(503, "unavailable", "employee-context-unavailable",
                    "The employee scheme context could not be resolved.", true);
        }
        return respond(service(clock).recommend(context, parse(body)));
    }

    /** The trusted context: identity from the principal, scheme membership from the account's employment record. */
    private RecommendationContext context(Principal p) {
        SourceResult employment = records.readEmployment(p.environmentId(), p.runId(), p.employeeId());
        if (!employment.isOk()) return null;
        JsonNode e = employment.value();
        String[] member = new String[4];
        String[] keys = {"companyId", "schemeId", "gradeId", "entitlementSlotId"};
        for (int i = 0; i < keys.length; i++) {
            member[i] = e.get(keys[i]) != null && e.get(keys[i]).isTextual() ? e.get(keys[i]).textValue() : null;
        }
        // Integration may switch the policy version to PolicyActivation.activatedPolicyVersion.
        return new RecommendationContext(p.runId(), p.environmentId(), p.employeeId(), member[0], member[1], member[2],
                p.policyVersion(), p.roles(), member[3]);
    }

    private synchronized AccountClockRecommendationClock clock() {
        if (clock == null) clock = new AccountClockRecommendationClock(accountClock, persistence.guard()::currentRun);
        return clock;
    }

    private RecommendationService service(AccountClockRecommendationClock clock) {
        RecommendationService current = service;
        if (current == null) {
            synchronized (this) {
                if (service == null) {
                    // The account read uses the canonical PolicyService directly, so it needs no other wiring.
                    AccountService accounts = new AccountService(records, new PolicyAccountAdapter(policy), accountClock, currentCars);
                    service = new RecommendationService(new ReleasedStockRecommendationSource(accounts, records,
                            supply.stock()::page, evidence, clock), policy, clock);
                }
                current = service;
            }
        }
        return current;
    }

    /** The body as the brief; anything that is not a single JSON value reaches the service as a non-object and is invalid. */
    private static JsonNode parse(String body) {
        if (body == null || body.isBlank()) return null;
        try {
            return JSON.readerFor(JsonNode.class).with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(body);
        } catch (Exception e) {
            return null;
        }
    }

    static Response respond(ObjectNode outcome) {
        String status = outcome.get("status").asText();
        int http = switch (status) {
            case "ok" -> 200;
            case "invalid" -> 400;
            case "forbidden" -> 403;
            case "stale-run" -> 409;
            default -> 503;
        };
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).entity(outcome).build();
    }
}
