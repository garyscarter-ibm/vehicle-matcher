package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.identity.Principal;
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
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** GET /api/gcsp/v1/vehicle-evidence/{configurations|stock|vins}/{id}: the Java port of the Node evidence handler. */
@Path("/api/gcsp/v1/vehicle-evidence")
@Produces(MediaType.APPLICATION_JSON)
public class EvidenceResource {

    private static final String PREFIX = "/api/gcsp/v1/vehicle-evidence/";
    private static final Map<String, String> KINDS = Map.of("configurations", "configuration", "stock", "stock", "vins", "vin");
    private static final Map<String, String> ENVELOPE = Map.of("invalid-input", "invalid", "not-found", "not-found",
            "identity-mismatch", "conflict", "unsupported", "unsupported", "source-unavailable", "unavailable");
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    @Inject
    BearerAuthentication auth;

    @Inject
    EvidenceSelection selection;

    @GET
    @Path("{rest:.*}")
    public Response read(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Principal principal = auth.authenticate(authorization);
        Access.requireAnyRole(principal, Role.EMPLOYEE, Role.GREG, Role.PRESENTER);
        // The raw path is split first: the id may carry an encoded slash, plus or equals sign.
        String raw = uri.getRequestUri().getRawPath();
        String rest = raw != null && raw.startsWith(PREFIX) ? raw.substring(PREFIX.length()) : "";
        String[] segments = rest.split("/", -1);
        String kind = KINDS.get(segments[0]);
        if (kind == null) return ApiError.notFound();
        String id = segments.length == 2 && !segments[1].isEmpty() ? decode(segments[1]) : null;
        String query = uri.getRequestUri().getRawQuery();
        if (id == null || query != null && !query.isEmpty()) return answer(EvidenceFailures.failure("invalid-input", kind));
        if (selection.selected().load() == null) return answer(EvidenceFailures.failure("source-unavailable", kind));
        EvidenceContext context = new EvidenceContext(principal.runId(), principal.environmentId(), principal.subject(),
                principal.roles());
        return answer(selection.selected().consumer().resolve(new EvidenceRequest(kind, id, null), context));
    }

    /** decodeURIComponent: strict %XX and strict UTF-8, a plus sign stays a plus sign; null when malformed. */
    static String decode(String segment) {
        byte[] out = new byte[segment.length() * 3];
        int n = 0;
        for (int i = 0; i < segment.length(); i++) {
            char c = segment.charAt(i);
            if (c == '%') {
                int hi = i + 2 < segment.length() ? Character.digit(segment.charAt(i + 1), 16) : -1;
                int lo = i + 2 < segment.length() ? Character.digit(segment.charAt(i + 2), 16) : -1;
                if (hi < 0 || lo < 0) return null;
                out[n++] = (byte) (hi * 16 + lo);
                i += 2;
            } else {
                byte[] encoded = String.valueOf(c).getBytes(StandardCharsets.UTF_8);
                if (Character.isSurrogate(c)) {
                    if (!Character.isHighSurrogate(c) || i + 1 >= segment.length()) return null;
                    encoded = segment.substring(i, i + 2).getBytes(StandardCharsets.UTF_8);
                    i++;
                }
                for (byte b : encoded) out[n++] = b;
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(out, 0, n)).toString();
        } catch (CharacterCodingException e) {
            return null;
        }
    }

    static Response answer(ObjectNode outcome) {
        String status = text(outcome.get("status"));
        if ("complete".equals(status) || "partial".equals(status)) {
            ObjectNode value = F.objectNode();
            value.set("contractVersion", outcome.get("contractVersion"));
            value.set("status", outcome.get("status"));
            value.set("vehicle", outcome.get("vehicle"));
            ObjectNode body = F.objectNode().put("status", "ok");
            body.set("value", value);
            return json(200, body);
        }
        JsonNode failure = outcome.get("failure");
        if (!ENVELOPE.containsKey(status) || failure == null || !failure.isObject()) {
            return answer(EvidenceFailures.failure("source-unavailable", null));
        }
        ObjectNode body = F.objectNode();
        body.put("status", ENVELOPE.get(status));
        body.set("code", failure.get("code"));
        body.set("reason", failure.get("message"));
        body.set("retryable", failure.get("retryable"));
        body.set("action", failure.get("action"));
        return json(EvidenceFailures.httpStatus(status), body);
    }

    private static Response json(int http, ObjectNode body) {
        return Response.status(http).type(MediaType.APPLICATION_JSON_TYPE).header("Cache-Control", "no-store")
                .entity(body).build();
    }

    private static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }
}
