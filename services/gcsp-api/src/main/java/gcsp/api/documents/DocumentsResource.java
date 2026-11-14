package gcsp.api.documents;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
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
import java.util.List;

/** /api/gcsp/v1/documents: the employee's own documents, the shared readiness read and acknowledgement. */
@Path("/api/gcsp/v1/documents")
@Produces(MediaType.APPLICATION_JSON)
public class DocumentsResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    @Inject
    BearerAuthentication auth;

    @Inject
    DocumentsWiring wiring;

    @GET
    public Response items(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        DocumentService service = wiring.service();
        if (service == null) return render(unavailable());
        if (!uri.getQueryParameters().isEmpty()) return render(DocumentOutcome.unsupportedQuery());
        return render(service.readItems(context(p), p.employeeId()));
    }

    @GET
    @Path("/readiness")
    public Response readiness(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        DocumentService service = wiring.service();
        if (service == null) return render(unavailable());
        MultivaluedMap<String, String> query = uri.getQueryParameters();
        if (query.keySet().stream().anyMatch((k) -> !"orderUuid".equals(k))) {
            return render(DocumentOutcome.unsupportedQuery());
        }
        List<String> values = query.get("orderUuid");
        if (values == null || values.size() != 1 || values.get(0).isEmpty() || values.get(0).length() > 128) {
            return render(DocumentOutcome.invalid("orderUuid", "Supply the order to check."));
        }
        return render(service.readReadiness(context(p), p, values.get(0), p.policyVersion()));
    }

    @POST
    @Path("/tasks/acknowledge")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response acknowledge(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, String body) {
        Principal p = auth.authenticate(authorization);
        Access.requireAnyRole(p, Role.EMPLOYEE);
        Access.requireOwner(p, p.employeeId());
        DocumentService service = wiring.service();
        if (service == null) return render(unavailable());
        JsonNode parsed;
        try {
            parsed = body == null || body.isBlank() ? null : JSON.readTree(body);
        } catch (JsonProcessingException e) {
            parsed = null;
        }
        return render(service.acknowledge(context(p), p.employeeId(), parsed));
    }

    private static RunContext context(Principal p) {
        return new RunContext(p.environmentId(), p.runId(), p.subject());
    }

    private static DocumentOutcome unavailable() {
        return DocumentOutcome.unavailable("documents-unavailable", DocumentOutcome.UNAVAILABLE_REASON);
    }

    /** Every outcome in the documented envelope; never a token, never a stack trace. */
    static Response render(DocumentOutcome o) {
        ObjectNode body = F.objectNode();
        body.put("status", o.status());
        if (o.http() == 200) {
            body.set("value", o.value());
        } else {
            body.put("code", o.code());
            body.put("reason", o.reason());
            body.put("retryable", o.retryable());
            if (o.operationId() != null) body.put("operationId", o.operationId());
            JsonNode value = o.value();
            if (value != null) {
                for (String name : List.of("reasons", "action", "current")) {
                    if (value.has(name)) body.set(name, value.get(name));
                }
            }
        }
        return Response.status(o.http()).type(MediaType.APPLICATION_JSON_TYPE).entity(body).build();
    }
}
