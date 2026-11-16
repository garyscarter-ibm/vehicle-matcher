package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.Canonical;
import gcsp.api.persistence.Persistence;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Instance;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import java.io.IOException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import javax.sql.DataSource;

/**
 * PlanningSupply over the native tables: a port of Node createOrderPlanSupplyProvider and resolveSupplyRecords (FUCQ-477).
 * Rows come from one read-only snapshot and are read again afterwards; any change, or a clock instant or version change, is a conflict.
 */
public final class PostgresPlanningSupply implements PlanningSupply {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> OCCUPYING = Set.of("active", "claim-pending", "release-pending", "selection-pending");
    // Java has no 'held' stock state: a hold lives in custody_holds, and stock stays 'released' or becomes 'allocated'.
    private static final Set<String> RELEASED_STATES = Set.of("released", "allocated");

    private final DataSource source;
    private final PlanningClock clock;

    PostgresPlanningSupply(DataSource source, PlanningClock clock) {
        this.source = source;
        this.clock = clock;
    }

    /** Binds the adapter only when persistence is active; otherwise the unconfigured default stays the bean. */
    @ApplicationScoped
    static class Wiring {

        @Inject
        Persistence persistence;

        @Inject
        Instance<AgroalDataSource> dataSource;

        @Inject
        PlanningClock clock;

        @Produces
        @ApplicationScoped
        PlanningSupply planningSupply() {
            return persistence.active() ? new PostgresPlanningSupply(dataSource.get(), clock)
                    : new PlanningDefaults.UnconfiguredSupply();
        }
    }

    @Override
    public ObjectNode readSupply(PlanningRead read, PolicyService policy) {
        DataSource ds = source;
        if (ds == null || clock == null || policy == null) {
            return Outcomes.unavailable("planning-supply-not-configured");
        }
        if (read == null || read.context() == null || !Js.text(F.textNode(read.runId())) || JsTime.parse(read.asOf()) == null
                || !Js.text(read.policyVersion() == null ? null : F.textNode(read.policyVersion()))) {
            return Outcomes.unavailable("planning-supply-input-invalid");
        }
        try {
            PlanningClock.Observation start = clock.observe(read.context());
            if (!PolicyClock.iso(start.now()).equals(read.asOf())) {
                return Outcomes.unavailable("planning-supply-read-mismatch");
            }
            ObjectNode rows = load(ds, read.context());
            if (rows == null) {
                return Outcomes.unavailable("planning-supply-read-mismatch");
            }
            ObjectNode choices = new PlanningCatalog(policy).readCatalog(read.runId(),
                    new PolicyRead(read.runId(), read.asOf(), read.policyVersion()));
            if (!Outcomes.isOk(choices)) {
                return choices;
            }
            JsonNode catalog = choices.get("value");
            ObjectNode out = resolve(read.runId(), read.asOf(), catalog.path("version").textValue(), catalog.get("derivatives"), rows);
            if (!Outcomes.isOk(out)) {
                return out;
            }
            ObjectNode after = load(ds, read.context());
            PlanningClock.Observation end = clock.observe(read.context());
            if (after == null || !Canonical.digest(rows).equals(Canonical.digest(after)) || !start.equals(end)) {
                return Outcomes.conflict("planning-supply-changed");
            }
            return out;
        } catch (SQLException | RuntimeException e) {
            return Outcomes.unavailable("planning-supply-unavailable");
        }
    }

    // ---- the snapshot read ----

    private interface Mapper {
        void row(ResultSet rs) throws SQLException;
    }

    private static void query(Connection c, String sql, RunContext ctx, Mapper mapper) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, ctx.environmentId());
            ps.setString(2, ctx.runId());
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    mapper.row(rs);
                }
            }
        }
    }

    private static String iso(ResultSet rs, int column) throws SQLException {
        OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
        return t == null ? null : PolicyClock.iso(t.toInstant());
    }

    private static JsonNode json(String text) throws SQLException {
        try {
            return text == null ? F.nullNode() : JSON.readTree(text);
        } catch (IOException e) {
            throw new SQLException("Stored JSON is unreadable");
        }
    }

    private static void putText(ObjectNode n, String field, String value) {
        if (value == null) {
            n.putNull(field);
        } else {
            n.put(field, value);
        }
    }

    /** Every input row for the run from one REPEATABLE READ snapshot; null when the run is not the active one. */
    static ObjectNode load(DataSource ds, RunContext ctx) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            try {
                return read(c, ctx);
            } finally {
                c.rollback();
                c.setReadOnly(false);
                c.setAutoCommit(true);
                c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            }
        }
    }

    private static ObjectNode read(Connection c, RunContext ctx) throws SQLException {
        boolean[] active = {false};
        query(c, "SELECT status FROM runs WHERE environment_id = ? AND run_id = ?", ctx,
                rs -> active[0] = "active".equals(rs.getString(1)));
        if (!active[0]) {
            return null;
        }
        ObjectNode rows = F.objectNode();
        ArrayNode stock = rows.putArray("stock");
        query(c, "SELECT order_uuid, configuration_id, state, version, attributes::text FROM stock_cars "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY order_uuid", ctx, rs -> {
                    ObjectNode r = stock.addObject();
                    r.put("orderUuid", rs.getString(1)).put("configurationId", rs.getString(2)).put("state", rs.getString(3))
                            .put("version", rs.getLong(4));
                    r.set("attributes", json(rs.getString(5)));
                });
        ArrayNode holds = rows.putArray("holds");
        query(c, "SELECT hold_id, order_uuid, slot_id, state, expires_at, version FROM custody_holds "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY hold_id", ctx, rs -> {
                    ObjectNode h = holds.addObject();
                    h.put("holdId", rs.getString(1)).put("orderUuid", rs.getString(2)).put("entitlementSlotId", rs.getString(3))
                            .put("state", rs.getString(4)).put("expiresAt", iso(rs, 5)).put("version", rs.getLong(6));
                });
        Map<String, ArrayNode> history = new HashMap<>();
        query(c, "SELECT request_id, seq, state, at, details::text FROM production_responses "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY request_id, seq", ctx, rs -> {
                    JsonNode details = json(rs.getString(5));
                    ObjectNode h = history.computeIfAbsent(rs.getString(1), k -> F.arrayNode()).addObject();
                    h.put("seq", rs.getInt(2)).put("state", rs.getString(3)).put("at", iso(rs, 4));
                    h.set("until", details.path("delayUntil").isTextual() ? details.get("delayUntil") : F.nullNode());
                    h.set("reason", details.path("reason").isTextual() ? details.get("reason") : F.nullNode());
                });
        ArrayNode requests = rows.putArray("requests");
        query(c, "SELECT r.request_id, s.command_id, r.model, r.derivative, r.quantity, r.state, r.requested_at, r.version "
                + "FROM production_requests r JOIN production_submissions s ON s.environment_id = r.environment_id "
                + "AND s.run_id = r.run_id AND s.submission_id = r.submission_id "
                + "WHERE r.environment_id = ? AND r.run_id = ? ORDER BY r.request_id", ctx, rs -> {
                    ObjectNode r = requests.addObject();
                    r.put("requestId", rs.getString(1)).put("commandId", rs.getString(2)).put("model", rs.getString(3))
                            .put("derivative", rs.getString(4)).put("quantity", rs.getInt(5)).put("state", rs.getString(6))
                            .put("requestedAt", iso(rs, 7)).put("version", rs.getLong(8));
                    r.set("history", history.getOrDefault(rs.getString(1), F.arrayNode()));
                });
        ArrayNode confirmations = rows.putArray("confirmations");
        query(c, "SELECT p.supply_id, p.request_id, p.quantity, p.confirmed_at, p.source_version, p.provider_reference, "
                + "p.queued_at, r.provider_mode, q.confirmed_at, q.source_version, q.eligible_from, q.policy_version "
                + "FROM production_confirmations p JOIN production_requests r ON r.environment_id = p.environment_id "
                + "AND r.run_id = p.run_id AND r.request_id = p.request_id LEFT JOIN confirmed_supply_queue q "
                + "ON q.environment_id = p.environment_id AND q.run_id = p.run_id AND q.supply_id = p.supply_id "
                + "WHERE p.environment_id = ? AND p.run_id = ? ORDER BY p.supply_id", ctx, rs -> {
                    ObjectNode s = confirmations.addObject();
                    s.put("supplyId", rs.getString(1)).put("requestId", rs.getString(2)).put("quantity", rs.getInt(3))
                            .put("confirmedAt", iso(rs, 4)).put("sourceVersion", rs.getString(5))
                            .put("providerReference", rs.getString(6)).put("queuedAt", iso(rs, 7)).put("providerMode", rs.getString(8));
                    ObjectNode queue = s.putObject("queue");
                    putText(queue, "confirmedAt", iso(rs, 9));
                    putText(queue, "sourceVersion", rs.getString(10));
                    putText(queue, "eligibleFrom", iso(rs, 11));
                    putText(queue, "policyVersion", rs.getString(12));
                });
        ArrayNode receipts = rows.putArray("receipts");
        query(c, "SELECT tranche_id, outcome::text FROM stock_releases WHERE environment_id = ? AND run_id = ? "
                + "ORDER BY tranche_id", ctx, rs -> {
                    ObjectNode r = receipts.addObject();
                    r.put("trancheId", rs.getString(1));
                    r.set("outcome", json(rs.getString(2)));
                });
        return rows;
    }

    // ---- the port of resolveSupplyRecords ----

    private static boolean text(JsonNode n) {
        return Js.text(n);
    }

    private static Long instant(JsonNode n) {
        return n != null && n.isTextual() ? JsTime.parse(n.textValue()) : null;
    }

    private static String key(JsonNode model, JsonNode derivative) {
        return Canonical.json(F.arrayNode().add(model).add(derivative));
    }

    private static String knownText(JsonNode fact) {
        return fact != null && "known".equals(fact.path("status").textValue()) && text(fact.get("value"))
                ? fact.get("value").textValue().trim() : null;
    }

    /** Display names only, as Node unboundName: never the VIN, order number or configuration id. */
    private static String unboundName(JsonNode attrs) {
        JsonNode facts = attrs.path("facts").path("facts");
        String line = knownText(facts.get("modelLine"));
        if (line != null) {
            return line;
        }
        String key = knownText(facts.get("eligibilityModelKey"));
        if (key != null) {
            int bar = key.indexOf('|');
            return bar < 0 ? key : key.substring(0, bar) + " " + key.substring(bar + 1);
        }
        return text(attrs.get("agModelCode")) ? attrs.get("agModelCode").textValue() : null;
    }

    private static boolean visibilityValid(JsonNode v) {
        return Js.object(v) && Js.array(v.get("companyIds")) && Js.everyText(v.get("companyIds"))
                && Js.array(v.get("schemeIds")) && Js.everyText(v.get("schemeIds")) && v.has("employeeIds")
                && (v.get("employeeIds").isNull() || Js.array(v.get("employeeIds")) && Js.everyText(v.get("employeeIds")));
    }

    private static boolean same(JsonNode a, JsonNode b) {
        return a != null && b != null && a.isTextual() && a.equals(b);
    }

    static ObjectNode resolve(String runId, String asOf, String catalogVersion, JsonNode catalog, JsonNode rows) {
        try {
            return resolveUnchecked(runId, asOf, catalogVersion, catalog, rows);
        } catch (RuntimeException e) {
            return Outcomes.unavailable("planning-supply-input-invalid");
        }
    }

    private static ObjectNode resolveUnchecked(String runId, String asOf, String catalogVersion, JsonNode catalog, JsonNode rows) {
        Long now = JsTime.parse(asOf);
        if (runId == null || runId.isEmpty() || now == null || catalogVersion == null || catalogVersion.isEmpty()
                || !Js.array(catalog) || catalog.isEmpty()) {
            return Outcomes.unavailable("planning-supply-input-invalid");
        }
        Map<String, JsonNode> configurationMap = new HashMap<>();
        Map<String, JsonNode> productionMap = new HashMap<>();
        for (JsonNode d : catalog) {
            if (!text(d.get("derivativeId")) || !text(d.get("modelId")) || !Js.array(d.get("configurationIds"))
                    || !Js.everyText(d.get("configurationIds")) || !text(d.path("production").get("model"))
                    || !text(d.path("production").get("derivative"))) {
                return Outcomes.unavailable("planning-catalog-mapping-missing");
            }
            if (productionMap.putIfAbsent(key(d.get("production").get("model"), d.get("production").get("derivative")), d) != null) {
                return Outcomes.unavailable("planning-catalog-mapping-ambiguous");
            }
            for (JsonNode configuration : d.get("configurationIds")) {
                if (configurationMap.putIfAbsent(configuration.textValue(), d) != null) {
                    return Outcomes.unavailable("planning-catalog-mapping-ambiguous");
                }
            }
        }
        List<JsonNode> stockRows = Js.items(rows.get("stock"));
        List<JsonNode> holdRows = Js.items(rows.get("holds"));
        List<JsonNode> requestRows = Js.items(rows.get("requests"));
        List<JsonNode> supplyRows = Js.items(rows.get("confirmations"));
        List<JsonNode> receiptRows = Js.items(rows.get("receipts"));
        if (!unique(stockRows, "orderUuid") || !unique(holdRows, "holdId") || !unique(requestRows, "requestId")
                || !unique(supplyRows, "supplyId")) {
            return Outcomes.unavailable("planning-supply-duplicate-identity");
        }
        Map<String, JsonNode> stockById = index(stockRows, "orderUuid");
        Map<String, JsonNode> requestById = index(requestRows, "requestId");
        Map<String, List<JsonNode>> holdsByCar = new HashMap<>();
        for (JsonNode h : holdRows) {
            holdsByCar.computeIfAbsent(h.path("orderUuid").textValue(), k -> new ArrayList<>()).add(h);
        }

        ArrayNode stock = F.arrayNode();
        List<JsonNode> unbound = new ArrayList<>();
        for (JsonNode row : stockRows) {
            List<JsonNode> carHolds = holdsByCar.getOrDefault(row.get("orderUuid").textValue(), List.of());
            // An 'allocated' hold is treated as allocated even if the car row lags.
            if ("allocated".equals(row.path("state").textValue())
                    || carHolds.stream().anyMatch(h -> "allocated".equals(h.path("state").textValue()))) {
                continue;
            }
            if (!"released".equals(row.path("state").textValue())) {
                continue;
            }
            JsonNode attrs = row.path("attributes");
            JsonNode release = attrs.path("release");
            JsonNode availableAt = release.has("releasedAt") ? release.get("releasedAt") : release.path("availability").get("availableFrom");
            Long at = instant(availableAt);
            if (at == null || at > now) {
                return Outcomes.unavailable("planning-stock-availability-invalid");
            }
            List<JsonNode> occupying = carHolds.stream().filter(h -> OCCUPYING.contains(h.path("state").textValue())).toList();
            boolean held = !occupying.isEmpty();
            if (held) {
                JsonNode hold = occupying.get(0);
                Long expires = instant(hold.get("expiresAt"));
                if (occupying.size() != 1 || !text(hold.get("entitlementSlotId")) || expires == null || expires <= now) {
                    return Outcomes.unavailable("planning-held-stock-unresolved");
                }
            }
            if (!visibilityValid(attrs.get("visibility"))) {
                return Outcomes.unavailable("planning-stock-visibility-missing");
            }
            JsonNode derivative = configurationMap.get(row.get("configurationId").textValue());
            if (derivative == null) {
                unbound.add(attrs);
                continue;
            }
            ObjectNode s = stock.addObject();
            s.set("stockId", row.get("orderUuid"));
            s.set("derivativeId", derivative.get("derivativeId"));
            s.set("availableAt", availableAt);
            s.set("heldForEntitlementSlotId", held ? occupying.get(0).get("entitlementSlotId") : F.nullNode());
            s.set("visibility", attrs.get("visibility").deepCopy());
        }

        ArrayNode inbound = F.arrayNode();
        Map<String, String> releasedIds = new HashMap<>();
        Map<String, Long> byRequest = new LinkedHashMap<>();
        List<ObjectNode> releases = new ArrayList<>();
        for (JsonNode supply : supplyRows) {
            JsonNode request = requestById.get(supply.path("requestId").textValue());
            JsonNode derivative = request == null ? null : productionMap.get(key(request.get("model"), request.get("derivative")));
            JsonNode queue = supply.path("queue");
            // Java records expectedAt and policyVersion only once supply has queued the confirmation (eligible_from).
            JsonNode expectedAt = queue.get("eligibleFrom");
            Long confirmedAt = instant(supply.get("confirmedAt"));
            Long expected = instant(expectedAt);
            if (request == null || derivative == null || !Js.integer(supply.get("quantity")) || supply.get("quantity").longValue() < 1
                    || confirmedAt == null || expected == null || confirmedAt > now || expected < confirmedAt
                    || !text(queue.get("policyVersion")) || !text(supply.get("sourceVersion")) || !text(supply.get("providerReference"))
                    || !text(supply.get("providerMode")) || !same(queue.get("confirmedAt"), supply.get("confirmedAt"))
                    || !same(queue.get("sourceVersion"), supply.get("sourceVersion"))) {
                return Outcomes.unavailable("planning-confirmed-supply-invalid");
            }
            String supplyId = supply.get("supplyId").textValue();
            String requestId = request.get("requestId").textValue();
            byRequest.merge(requestId, supply.get("quantity").longValue(), Long::sum);
            Set<String> released = new HashSet<>();
            for (JsonNode receipt : receiptRows) {
                JsonNode value = receipt.path("outcome");
                if (!"stock-released".equals(value.path("kind").textValue()) || !supplyId.equals(value.path("supplyId").textValue())) {
                    continue;
                }
                Long releasedAt = instant(value.get("releasedAt"));
                JsonNode ids = value.get("orderUuids");
                if (!runId.equals(value.path("runId").textValue()) || !same(value.get("trancheId"), receipt.get("trancheId"))
                        || !Js.array(ids) || !Js.everyText(ids) || !Js.unique(Js.items(ids)) || releasedAt == null || releasedAt > now) {
                    return Outcomes.unavailable("planning-release-provenance-invalid");
                }
                if (!ids.isEmpty()) {
                    ObjectNode r = F.objectNode().put("kind", "released").put("requestId", requestId).put("supplyId", supplyId)
                            .put("quantity", ids.size());
                    r.set("at", value.get("releasedAt"));
                    releases.add(r);
                }
                for (JsonNode idNode : ids) {
                    String id = idNode.textValue();
                    JsonNode exact = stockById.get(id);
                    JsonNode rel = exact == null ? null : exact.path("attributes").path("release");
                    JsonNode exactDerivative = exact == null ? null : configurationMap.get(exact.get("configurationId").textValue());
                    if (exact == null || !supplyId.equals(rel.path("supplyId").textValue()) || !same(rel.get("trancheId"), value.get("trancheId"))
                            || !same(rel.get("releasedAt"), value.get("releasedAt"))
                            || !same(rel.get("sourceVersion"), value.path("source").get("version"))
                            || !same(rel.get("policyVersion"), value.get("policyVersion"))
                            || !RELEASED_STATES.contains(exact.path("state").textValue()) || exactDerivative == null
                            || !exactDerivative.get("derivativeId").equals(derivative.get("derivativeId")) || releasedIds.containsKey(id)) {
                        return Outcomes.unavailable("planning-release-provenance-invalid");
                    }
                    released.add(id);
                    releasedIds.put(id, supplyId);
                }
            }
            if (released.size() > supply.get("quantity").longValue()) {
                return Outcomes.unavailable("planning-release-quantity-invalid");
            }
            ObjectNode in = inbound.addObject();
            in.put("supplyId", supplyId);
            in.set("derivativeId", derivative.get("derivativeId"));
            in.put("state", "confirmed");
            in.set("quantity", supply.get("quantity"));
            in.put("releasedQuantity", released.size());
            in.set("expectedAt", expectedAt);
            ObjectNode provenance = in.putObject("provenance");
            provenance.put("requestId", requestId);
            provenance.set("confirmedAt", supply.get("confirmedAt"));
            provenance.set("policyVersion", queue.get("policyVersion"));
            provenance.set("sourceVersion", supply.get("sourceVersion"));
            provenance.set("providerReference", supply.get("providerReference"));
            // Java stores only the provider mode, not Node's providerId and label: reported as recorded, never filled in.
            provenance.putObject("provider").set("mode", supply.get("providerMode"));
        }
        for (Map.Entry<String, Long> e : byRequest.entrySet()) {
            JsonNode quantity = requestById.get(e.getKey()).get("quantity");
            if (!Js.integer(quantity) || e.getValue() > quantity.longValue()) {
                return Outcomes.unavailable("planning-confirmed-quantity-invalid");
            }
        }
        // A supply-linked unit without its release receipt cannot be counted in stock while the confirmation stays unreduced.
        Set<String> supplyIds = new HashSet<>();
        supplyRows.forEach(s -> supplyIds.add(s.get("supplyId").textValue()));
        for (JsonNode s : stockRows) {
            JsonNode linked = s.path("attributes").path("release").get("supplyId");
            if (text(linked) && supplyIds.contains(linked.textValue()) && RELEASED_STATES.contains(s.path("state").textValue())
                    && !releasedIds.containsKey(s.get("orderUuid").textValue())) {
                return Outcomes.unavailable("planning-release-receipt-missing");
            }
        }

        ArrayNode requests = F.arrayNode();
        List<ObjectNode> delays = new ArrayList<>();
        for (JsonNode row : requestRows) {
            JsonNode derivative = productionMap.get(key(row.get("model"), row.get("derivative")));
            if (derivative == null || !Js.integer(row.get("quantity"))) {
                return Outcomes.unavailable("planning-catalog-mapping-missing");
            }
            ObjectNode r = requests.addObject();
            r.set("requestId", row.get("requestId"));
            r.set("commandId", row.get("commandId"));
            r.set("derivativeId", derivative.get("derivativeId"));
            r.set("quantity", row.get("quantity"));
            r.set("state", row.get("state"));
            r.set("requestedAt", row.get("requestedAt"));
            for (JsonNode h : Js.items(row.get("history"))) {
                Long at = instant(h.get("at"));
                if ("delayed".equals(h.path("state").textValue()) && at != null && at <= now) {
                    ObjectNode d = F.objectNode().put("kind", "delayed");
                    d.set("requestId", row.get("requestId"));
                    d.set("at", h.get("at"));
                    d.set("delayUntil", h.get("until"));
                    d.set("reason", h.get("reason"));
                    delays.add(d);
                }
            }
        }
        List<JsonNode> ordered = new ArrayList<>(supplyRows);
        ordered.sort(Comparator.<JsonNode>comparingLong(s -> instant(s.get("confirmedAt")))
                .thenComparing(s -> s.get("supplyId").textValue()));
        Map<String, Long> total = new HashMap<>();
        List<ObjectNode> confirmations = new ArrayList<>();
        for (JsonNode a : ordered) {
            String requestId = a.get("requestId").textValue();
            long sum = total.merge(requestId, a.get("quantity").longValue(), Long::sum);
            long wanted = requestById.get(requestId).get("quantity").longValue();
            ObjectNode c = F.objectNode().put("kind", sum < wanted ? "partly-confirmed" : "confirmed").put("requestId", requestId);
            c.set("supplyId", a.get("supplyId"));
            c.set("quantity", a.get("quantity"));
            c.set("at", a.get("confirmedAt"));
            confirmations.add(c);
        }
        List<ObjectNode> responses = new ArrayList<>(confirmations);
        responses.addAll(delays);
        responses.addAll(releases);
        responses.sort(Comparator.<ObjectNode>comparingLong(r -> instant(r.get("at"))).thenComparing(PostgresPlanningSupply::responseId));

        ObjectNode value = F.objectNode();
        value.put("runId", runId);
        value.put("asOf", asOf);
        value.set("stock", sorted(stock, "stockId"));
        ObjectNode summary = value.putObject("unboundStock");
        summary.put("count", unbound.size());
        ArrayNode models = summary.putArray("models");
        TreeSet<String> names = new TreeSet<>();
        for (JsonNode attrs : unbound) {
            String name = unboundName(attrs);
            if (name != null) {
                names.add(name);
            }
        }
        names.forEach(models::add);
        value.set("inbound", sorted(inbound, "supplyId"));
        value.set("requests", sorted(requests, "requestId"));
        ArrayNode responseArray = value.putArray("responses");
        responses.forEach(responseArray::add);
        ObjectNode versions = value.putObject("versions");
        ObjectNode stockInput = F.objectNode();
        stockInput.set("stock", rows.get("stock"));
        stockInput.set("holds", rows.get("holds"));
        ObjectNode supplyInput = F.objectNode();
        supplyInput.set("requests", rows.get("requests"));
        supplyInput.set("confirmations", rows.get("confirmations"));
        supplyInput.set("receipts", rows.get("receipts"));
        versions.put("stock", Canonical.digest(stockInput));
        versions.put("supply", Canonical.digest(supplyInput));
        versions.put("catalog", catalogVersion);
        return Outcomes.ok(value);
    }

    private static String responseId(JsonNode r) {
        JsonNode supply = r.get("supplyId");
        return r.get("requestId").textValue() + "|" + r.get("kind").textValue() + "|" + (supply == null || supply.isNull() ? "" : supply.textValue());
    }

    private static boolean unique(List<JsonNode> rows, String field) {
        Set<String> seen = new HashSet<>();
        for (JsonNode r : rows) {
            if (!text(r.get(field)) || !seen.add(r.get(field).textValue())) {
                return false;
            }
        }
        return true;
    }

    private static Map<String, JsonNode> index(List<JsonNode> rows, String field) {
        Map<String, JsonNode> out = new HashMap<>();
        rows.forEach(r -> out.put(r.get(field).textValue(), r));
        return out;
    }

    private static ArrayNode sorted(ArrayNode items, String field) {
        List<JsonNode> list = new ArrayList<>(Js.items(items));
        list.sort(Comparator.comparing(n -> n.get(field).textValue()));
        ArrayNode out = F.arrayNode();
        list.forEach(out::add);
        return out;
    }
}
