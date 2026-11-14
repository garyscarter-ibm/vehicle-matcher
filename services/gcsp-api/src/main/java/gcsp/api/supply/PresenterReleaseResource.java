package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.auth.Access;
import gcsp.api.auth.BearerAuthentication;
import gcsp.api.auth.Role;
import gcsp.api.error.ApiError;
import gcsp.api.persistence.RunContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Presenter-only release control and inspection; scope is always the server's active run, never the request. */
@Path("/api/gcsp/v1/presenter/releases")
@Produces(MediaType.APPLICATION_JSON)
public class PresenterReleaseResource {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final int STOCK_DEFAULT = 100;
    private static final int STOCK_MAX = 500;

    @Inject
    BearerAuthentication auth;

    @Inject
    SupplyRelease supply;

    // ---- commands ----

    @POST
    @Path("/ticks")
    public Response deliver(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Response early = guard(authorization, uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        TickEvent tick = parseTick(body, reasons);
        if (tick == null) return invalid("invalid-tick", "The tick request is not valid.", reasons);
        return withScope(scope -> {
            ReleaseResult r = supply.release().deliver(scope, tick);
            return mapped(r, tick.tickId());
        });
    }

    @POST
    @Path("/reconcile")
    public Response reconcile(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            String body) {
        Response early = guard(authorization, uri, Set.of());
        if (early != null) return early;
        List<String[]> reasons = new ArrayList<>();
        int limit = parseLimit(body, reasons);
        if (!reasons.isEmpty()) return invalid("invalid-reconcile", "The reconcile request is not valid.", reasons);
        return withScope(scope -> {
            ArrayNode results = JSON.createArrayNode();
            for (ReleaseResult r : supply.release().reconcilePending(scope, limit)) {
                ObjectNode item = results.addObject();
                item.put("tickId", r.tickId());
                item.put("status", statusText(r));
                item.put("code", r.code());
                item.put("replayed", r.replayed());
            }
            ObjectNode value = JSON.createObjectNode();
            value.set("results", results);
            return ok(value);
        });
    }

    // ---- reads ----

    @GET
    @Path("/latest")
    public Response latest(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Response early = guard(authorization, uri, Set.of());
        if (early != null) return early;
        return withScope(scope -> {
            Optional<ReleaseReceipt> receipt = supply.stock().latest(scope);
            ObjectNode value = JSON.createObjectNode();
            value.put("runId", scope.runId());
            if (receipt.isEmpty()) {
                value.putNull("release");
            } else {
                ReleaseReceipt r = receipt.get();
                ObjectNode out = value.putObject("release");
                out.put("trancheId", r.trancheId());
                out.put("windowId", r.windowId());
                if (r.supplyId() == null) out.putNull("supplyId"); else out.put("supplyId", r.supplyId());
                out.put("releasedAt", Iso.format(r.releasedAt()));
                out.put("policyVersion", r.policyVersion());
                out.set("source", r.source());
                out.set("orderUuids", r.orderUuids());
                out.set("visibleOrderUuids", r.visibleOrderUuids());
                out.put("tickId", r.tickId());
            }
            return ok(value);
        });
    }

    @GET
    @Path("/ticks/{tickId}")
    public Response tick(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri,
            @PathParam("tickId") String tickId) {
        Response early = guard(authorization, uri, Set.of());
        if (early != null) return early;
        return withScope(scope -> {
            Optional<TickRow> row = supply.stock().tick(scope, tickId);
            if (row.isEmpty()) {
                return ApiError.response(404, "not-found", "tick-not-found", "No such tick for the active run.", false);
            }
            TickRow t = row.get();
            ObjectNode value = JSON.createObjectNode();
            value.put("tickId", t.tickId());
            value.put("state", t.state());
            value.put("attempts", t.attempts());
            value.put("now", Iso.format(t.now()));
            value.put("clockVersion", t.clockVersion());
            if (t.lastOutcome() == null) value.putNull("outcome"); else value.set("outcome", t.lastOutcome());
            return ok(value);
        });
    }

    @GET
    @Path("/stock")
    public Response stock(@HeaderParam(HttpHeaders.AUTHORIZATION) String authorization, @Context UriInfo uri) {
        Response early = guard(authorization, uri, Set.of("after", "limit"));
        if (early != null) return early;
        MultivaluedMap<String, String> q = uri.getQueryParameters();
        List<String[]> reasons = new ArrayList<>();
        String after = q.getFirst("after");
        if (q.containsKey("after") && (after == null || after.isEmpty() || after.length() > 200)) {
            reasons.add(new String[] {"after", "Use an order UUID from a previous page."});
        }
        int limit = STOCK_DEFAULT;
        if (q.containsKey("limit")) {
            Integer n = wholeNumber(q.getFirst("limit"));
            if (n == null || n < 1 || n > STOCK_MAX) reasons.add(new String[] {"limit", "Use a whole number from 1 to 500."});
            else limit = n;
        }
        if (!reasons.isEmpty()) return invalid("invalid-query", "The query is not valid.", reasons);
        int pageSize = limit;
        return withScope(scope -> {
            List<ReleasedCar> cars = supply.stock().page(scope, after, pageSize);
            ObjectNode value = JSON.createObjectNode();
            ArrayNode out = value.putArray("cars");
            for (ReleasedCar car : cars) {
                ObjectNode item = out.addObject();
                item.put("orderUuid", car.orderUuid());
                item.put("configurationId", car.configurationId());
                item.put("version", car.version());
                item.put("occupied", car.occupied());
                item.set("release", car.attributes().path("release"));
            }
            if (cars.size() == pageSize) value.put("next", cars.get(cars.size() - 1).orderUuid());
            else value.putNull("next");
            return ok(value);
        });
    }

    // ---- shared steps ----

    /** Authenticates, requires the presenter role and rejects any query parameter outside the allowed set. */
    private Response guard(String authorization, UriInfo uri, Set<String> allowedQuery) {
        Access.requireAnyRole(auth.authenticate(authorization), Role.PRESENTER);
        for (String key : uri.getQueryParameters().keySet()) {
            if (!allowedQuery.contains(key) || uri.getQueryParameters().get(key).size() > 1) {
                return ApiError.response(400, "invalid", "unsupported-query",
                        "This operation does not accept that query parameter.", false);
            }
        }
        return null;
    }

    @FunctionalInterface
    private interface Action {
        Response run(RunContext scope) throws SQLException;
    }

    private Response withScope(Action action) {
        if (!supply.available()) {
            return ApiError.response(503, "unavailable", "persistence-not-configured",
                    "The database is not configured on this service.", false);
        }
        try {
            return action.run(supply.scope());
        } catch (SQLException | IllegalStateException e) {
            return ApiError.response(503, "unavailable", "database-unavailable",
                    "The database could not be reached.", true);
        }
    }

    private static Response ok(ObjectNode value) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "ok");
        body.set("value", value);
        return Response.ok(body).build();
    }

    private static Response invalid(String code, String reason, List<String[]> reasons) {
        ObjectNode body = JSON.createObjectNode();
        body.put("status", "invalid");
        body.put("code", code);
        body.put("reason", reason);
        body.put("retryable", false);
        ArrayNode list = body.putArray("reasons");
        for (String[] r : reasons) list.addObject().put("field", r[0]).put("reason", r[1]);
        return Response.status(400).entity(body).build();
    }

    private static String statusText(ReleaseResult r) {
        return r.status() == ReleaseResult.Status.UNCERTAIN ? "pending" : r.status().name().toLowerCase();
    }

    /** The contract mapping: ok 200, retryable unavailable 503, conflict 409, refused evidence 503, uncertain 202. */
    static Response mapped(ReleaseResult r, String tickId) {
        ObjectNode body = JSON.createObjectNode();
        switch (r.status()) {
            case OK: {
                ObjectNode value = JSON.createObjectNode();
                value.put("tickId", tickId);
                value.put("replayed", r.replayed());
                value.set("outcome", r.value() == null ? JSON.nullNode() : r.value());
                return ok(value);
            }
            case UNAVAILABLE:
                body.put("status", "unavailable");
                fill(body, r, tickId);
                body.put("retryable", true);
                body.put("state", "database-unavailable".equals(r.code()) ? "unknown" : "pending");
                return Response.status(503).entity(body).build();
            case CONFLICT:
                body.put("status", "conflict");
                fill(body, r, tickId);
                return Response.status(409).entity(body).build();
            case INVALID:
                body.put("status", "invalid");
                fill(body, r, tickId);
                body.put("state", "refused");
                return Response.status(503).entity(body).build();
            default:
                body.put("status", "pending");
                body.put("code", "outcome-uncertain");
                body.put("operationId", tickId);
                body.put("tickId", tickId);
                body.put("retryable", false);
                return Response.status(202).entity(body).build();
        }
    }

    private static void fill(ObjectNode body, ReleaseResult r, String tickId) {
        body.put("code", r.code());
        if (r.reason() != null) body.put("reason", r.reason());
        body.put("retryable", r.retryable());
        body.put("tickId", tickId);
    }

    // ---- request parsing ----

    private static ObjectNode object(String body, List<String[]> reasons) {
        try {
            JsonNode node = body == null || body.isBlank() ? null : JSON.readTree(body);
            if (node != null && node.isObject()) return (ObjectNode) node;
        } catch (java.io.IOException e) {
            // reported below
        }
        reasons.add(new String[] {"body", "Send a JSON object."});
        return null;
    }

    private static TickEvent parseTick(String body, List<String[]> reasons) {
        ObjectNode node = object(body, reasons);
        if (node == null) return null;
        node.fieldNames().forEachRemaining(name -> {
            if (!Set.of("tickId", "now", "clockVersion").contains(name)) {
                reasons.add(new String[] {name, "This field is not accepted."});
            }
        });
        JsonNode id = node.get("tickId");
        if (id == null || !id.isTextual() || id.asText().isEmpty() || id.asText().length() > 200) {
            reasons.add(new String[] {"tickId", "Use text of 1 to 200 characters."});
        }
        JsonNode now = node.get("now");
        if (now == null || !now.isTextual() || Iso.parse(now.asText()) == null) {
            reasons.add(new String[] {"now", "Use an ISO 8601 instant with an offset."});
        }
        JsonNode version = node.get("clockVersion");
        if (version == null || !version.isIntegralNumber() || !version.canConvertToLong() || version.asLong() < 1) {
            reasons.add(new String[] {"clockVersion", "Use a positive whole number."});
        }
        if (!reasons.isEmpty()) return null;
        return new TickEvent(id.asText(), Iso.parse(now.asText()), version.asLong());
    }

    private static int parseLimit(String body, List<String[]> reasons) {
        if (body == null || body.isBlank()) return 100;
        ObjectNode node = object(body, reasons);
        if (node == null) return 100;
        node.fieldNames().forEachRemaining(name -> {
            if (!"limit".equals(name)) reasons.add(new String[] {name, "This field is not accepted."});
        });
        JsonNode limit = node.get("limit");
        if (limit == null) return 100;
        if (!limit.isIntegralNumber() || !limit.canConvertToInt() || limit.asInt() < 1 || limit.asInt() > 100) {
            reasons.add(new String[] {"limit", "Use a whole number from 1 to 100."});
            return 100;
        }
        return limit.asInt();
    }

    private static Integer wholeNumber(String text) {
        try {
            return text == null || !text.matches("\\d{1,9}") ? null : Integer.valueOf(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
