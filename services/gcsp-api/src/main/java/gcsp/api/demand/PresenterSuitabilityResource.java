package gcsp.api.demand;

import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import io.smallrye.common.annotation.Blocking;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/** The presenter's car suitability view of recorded decisions; scope comes only from the bearer principal. */
@Path("/api/gcsp/v1/presenter/suitability")
@Produces(MediaType.APPLICATION_JSON)
@Blocking
public class PresenterSuitabilityResource {

    private static final Pattern PAGE = Pattern.compile("^[1-9]\\d{0,6}$");
    private static final Set<String> KEYS = Set.of("page", "buddyPage", "release");

    @Inject
    BearerAuthentication auth;

    @Inject
    DemandServices services;

    @GET
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.PRESENTER);
        Selection selected = select(uri.getQueryParameters());
        if (selected == null) {
            return GregDemandResource.respond(Response.status(400).type(MediaType.APPLICATION_JSON_TYPE).entity(
                    GregDemandResource.unsupportedQuery("Choose a release and positive page numbers only.")));
        }
        DemandScope scope = GregDemandResource.scope(principal);
        if (scope == null) {
            return GregDemandResource.respond(DemandResult.Refusal.suitabilityUnavailable());
        }
        Optional<SuitabilityService> service = services.suitability();
        if (service.isEmpty()) return GregDemandResource.notConfigured();
        return GregDemandResource.respond(service.get().read(scope, selected.page, selected.buddyPage, selected.release));
    }

    record Selection(int page, int buddyPage, String release) {}

    /** The parsed selectors, or null for an unknown, repeated or malformed one. */
    static Selection select(MultivaluedMap<String, String> query) {
        for (var e : query.entrySet()) {
            if (!KEYS.contains(e.getKey()) || e.getValue().size() != 1) return null;
        }
        Integer page = page(query.get("page"));
        Integer buddyPage = page(query.get("buddyPage"));
        List<String> release = query.get("release");
        String r = release == null ? "all" : release.get(0);
        if (page == null || buddyPage == null || !"all".equals(r) && !"latest".equals(r)) return null;
        return new Selection(page, buddyPage, r);
    }

    private static Integer page(List<String> values) {
        if (values == null) return 1;
        return PAGE.matcher(values.get(0)).matches() ? Integer.valueOf(values.get(0)) : null;
    }
}
