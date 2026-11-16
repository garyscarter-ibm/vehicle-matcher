package gcsp.api.claims;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.account.AccountOutcome;
import gcsp.api.account.AccountScope;
import gcsp.api.account.AccountSelection;
import gcsp.api.account.ManualDraftResource;
import gcsp.api.account.ManualStock;
import gcsp.api.account.ManualStockHolder;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.EnvironmentGuard;
import gcsp.api.persistence.Persistence;
import io.agroal.api.AgroalDataSource;
import io.smallrye.common.annotation.Blocking;
import jakarta.enterprise.inject.Instance;
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
import java.util.Optional;

/** GET /api/gcsp/v1/manual/stock: the employee's own browse of released stock; nothing is reserved. */
@Path("/api/gcsp/v1/manual/stock")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class ManualStockResource {

    @Inject
    BearerAuthentication auth;

    @Inject
    AccountSelection selection;

    @Inject
    ManualStockHolder stocks;

    @Inject
    ManualClaimsHolder claims;

    @Inject
    Instance<AgroalDataSource> dataSource;

    @Inject
    Persistence persistence;

    private ManualStockRead read;

    @GET
    public Response browse(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE);
        Access.requireOwner(principal, principal.employeeId());
        if (!uri.getQueryParameters().isEmpty()) {
            return ApiError.response(400, "invalid", "unsupported-query", "This operation takes no query parameters.", false);
        }
        if (!selection.configured()) {
            return ApiError.response(503, "unavailable", "account-provider-not-configured",
                    "Account data is not available on this service yet.", false);
        }
        Optional<ManualStock> stock = stocks.stock();
        Optional<ManualClaims> manual = claims.claims();
        if (stock.isEmpty() || manual.isEmpty()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            EnvironmentGuard.RunState run = persistence.guard().currentRun();
            if (!run.environmentId().equals(principal.environmentId()) || !run.runId().equals(principal.runId())) {
                return ApiError.response(409, "conflict", "stale-run",
                        "Your session belongs to an earlier run. Sign in again.", false);
            }
            AccountScope scope = new AccountScope(run.environmentId(), run.runId(), principal.employeeId(), null,
                    principal.roles(), null, null, null, null, principal.policyVersion());
            ClaimScope who = new ClaimScope(run.environmentId(), run.runId(), principal.subject(),
                    principal.employeeId(), principal.policyVersion());
            AccountOutcome outcome = reader(manual.get(), stock.get()).read(who, scope);
            if (outcome.isOk()) {
                ObjectNode body = JsonNodeFactory.instance.objectNode().put("status", "ok");
                body.set("value", StockPayload.compact(outcome.value()));
                return Response.ok(body).build();
            }
            return ManualDraftResource.mapped(outcome, false);
        } catch (IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable", "The database could not be reached.", true);
        }
    }

    private synchronized ManualStockRead reader(ManualClaims manual, ManualStock stock) {
        if (read == null) read = new ManualStockRead(manual, stock, dataSource.get());
        return read;
    }
}
