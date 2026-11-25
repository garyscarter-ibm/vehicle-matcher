package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.DisplayCatalogue;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PinnedPolicySnapshot;
import gcsp.api.policy.PolicyContext;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;

/** Frozen presenter release read: complete latest tranche, run-wide custody and actual offer outcomes. */
public final class PresenterReleaseProjection {
    static final String TOTALS = """
            WITH ids AS (
              SELECT DISTINCT jsonb_array_elements_text(order_uuids) AS id FROM stock_releases
              WHERE environment_id = ? AND run_id = ?
            ), holds AS (
              SELECT h.order_uuid, count(*) AS n, min(h.hold_type) AS type FROM custody_holds h
              JOIN ids ON ids.id = h.order_uuid
              WHERE h.environment_id = ? AND h.run_id = ?
                AND h.state IN ('active','claim-pending','release-pending','selection-pending','allocated')
              GROUP BY h.order_uuid
            )
            SELECT count(*),
              count(*) FILTER (WHERE s.state = 'released' AND h.n IS NULL),
              count(*) FILTER (WHERE h.n = 1 AND h.type = 'buddy-offer'),
              count(*) FILTER (WHERE h.n = 1 AND h.type = 'cart'),
              count(*) FILTER (WHERE s.order_uuid IS NULL OR h.n > 1
                OR (h.n IS NULL AND s.state <> 'released'))
            FROM ids LEFT JOIN stock_cars s ON s.environment_id = ? AND s.run_id = ? AND s.order_uuid = ids.id
            LEFT JOIN holds h ON h.order_uuid = ids.id
            """;
    static final String OFFERS = """
            SELECT count(*) FILTER (WHERE h.hold_type = 'buddy-offer' AND o.state = 'active' AND h.state = 'active' AND h.expires_at > ?),
              count(*) FILTER (WHERE h.hold_type = 'buddy-offer' AND o.state IN ('declined','rejected') AND h.state = 'released'
                AND h.attributes->>'releaseReason' = 'offer-declined'),
              count(*) FILTER (WHERE h.hold_type = 'buddy-offer' AND o.state = 'accepted' AND h.state = 'allocated'),
              count(*) FILTER (WHERE h.hold_id IS NULL OR h.order_uuid <> o.order_uuid)
            FROM buddy_offers o LEFT JOIN custody_holds h
              ON h.environment_id = o.environment_id AND h.run_id = o.run_id AND h.hold_id = o.hold_id
            WHERE o.environment_id = ? AND o.run_id = ?
            """;
    private static final Map<String, String> FUEL = Map.of("petrol", "Petrol", "diesel", "Diesel",
            "phev", "Plug-in hybrid", "ev", "Electric");
    private final DataSource source;
    private final DisplayCatalogue pictures;

    public PresenterReleaseProjection(DataSource source, DisplayCatalogue pictures) {
        this.source = source;
        this.pictures = pictures;
    }

    /** Environment is deployment-owned; the active run is selected inside this same read-only snapshot. */
    public ObjectNode latest(String environment) throws SQLException {
        try (Connection c = source.getConnection()) {
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            c.setAutoCommit(false);
            try {
                ObjectNode out = snapshot(c, environment);
                c.rollback();
                return out;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    ObjectNode snapshot(Connection c, String environment) throws SQLException {
        RunContext scope;
        Instant now;
        try (PreparedStatement ps = c.prepareStatement("SELECT r.run_id, k.clock_instant FROM runs r "
                + "LEFT JOIN run_clocks k ON k.environment_id = r.environment_id AND k.run_id = r.run_id "
                + "WHERE r.environment_id = ? AND r.status = 'active'")) {
            ps.setString(1, environment);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) throw unavailable();
                scope = new RunContext(environment, rs.getString(1), SupplyRelease.ACTOR);
                var at = rs.getObject(2, OffsetDateTime.class);
                now = at == null ? null : at.toInstant();
            }
        }
        ObjectNode out = ReleasedStock.JSON.createObjectNode().put("runId", scope.runId());
        ObjectNode receipt = receipt(c, scope);
        out.set("release", receipt == null ? ReleasedStock.JSON.nullNode() : receipt);
        ObjectNode counts = out.putObject("counts");
        try (PreparedStatement ps = c.prepareStatement(TOTALS)) {
            for (int i = 1; i <= 6; i += 2) bind(ps, i, scope);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                if (rs.getLong(5) != 0) throw unavailable();
                counts.put("totalReleased", rs.getLong(1)).put("onScheme", rs.getLong(2))
                        .put("buddyAllocated", rs.getLong(3)).put("manuallyAllocated", rs.getLong(4));
            }
        }
        out.set("allocation", allocation(c, scope, now));
        ArrayNode cars = out.putArray("cars");
        out.putArray("modelLines");
        ObjectNode charts = out.putObject("charts");
        charts.putArray("colours"); charts.putArray("fuel"); charts.putArray("points");
        counts.put("released", 0).put("modelLines", 0).put("colours", 0);
        if (receipt == null) return out;
        PolicyService policy = null;
        try {
            policy = PinnedPolicySnapshot.read(c, scope, receipt.path("policyVersion").asText());
        } catch (SQLException e) {
            // Node's name, paint and points readers treat unavailable policy as unknown enrichment.
            if (!"P0002".equals(e.getSQLState())) throw e;
        }
        PolicyRead read = new PolicyRead(scope.runId(), receipt.path("releasedAt").asText(), receipt.path("policyVersion").asText());
        // A malformed optional snapshot is unknown; it cannot hide a legitimate recorded release.
        if (policy != null && !policy.getPolicySnapshot(read).ok()) policy = null;
        JsonNode labels = assumption(policy, read, "policy.displayLabels.v1").path("models");
        JsonNode paint = assumption(policy, read, "stock.optionLabels.v1").path("paint");
        JsonNode mapping = assumption(policy, read, "eligibility.context.mapping");
        PolicyContext context = null;
        for (JsonNode row : mapping) {
            if ("choices-fs-uk".equals(row.path("schemeId").asText())) {
                context = new PolicyContext(scope.runId(), row.path("companyId").asText(), row.path("schemeId").asText(),
                        row.path("gradeIds").path(0).asText());
                break;
            }
        }
        Map<String, String> picturePaints = pictures == null ? Map.of() : pictures.presenterPaints();
        Map<String, Long> colours = new HashMap<>(), fuels = new HashMap<>(), lines = new HashMap<>();
        Map<Double, Long> points = new HashMap<>();
        Map<String, Double> priced = new HashMap<>();
        String sql = "SELECT ids.id, s.configuration_id, s.attributes::text FROM jsonb_array_elements_text(?::jsonb) "
                + "WITH ORDINALITY ids(id, ordinal) LEFT JOIN stock_cars s ON s.environment_id = ? AND s.run_id = ? "
                + "AND s.order_uuid = ids.id ORDER BY ids.ordinal";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, receipt.path("orderUuids").toString()); bind(ps, 2, scope);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    if (rs.getString(2) == null) throw unavailable();
                    JsonNode attrs = ReleasedStock.json(rs.getString(3));
                    String key = fact(attrs, "eligibilityModelKey");
                    String line = fact(attrs, "modelLine");
                    if (line == null && key != null) line = key.split("\\|", -1)[0];
                    String image = text(attrs.path("facts").path("display").path("photo"));
                    if (image == null || !image.matches("/assets/gcsp-vehicle-evidence/[a-f0-9]{64}\\.webp")) {
                        JsonNode picture = pictures == null ? null : pictures.presenterImage(rs.getString(2), key);
                        image = picture == null ? null : "/" + picture.path("asset").asText();
                    }
                    String colour = fact(attrs, "colour");
                    if (colour == null && image != null && pictures != null) colour = text(paint.path(String.valueOf(picturePaints.get(image))));
                    String name = text(attrs.path("facts").path("display").path("name"));
                    String suffix = colour == null ? null : " in " + colour;
                    if (name != null && suffix != null && name.endsWith(suffix)) name = name.substring(0, name.length() - suffix.length());
                    if (name == null && key != null) name = name(labels, key, line);
                    String lineName = line == null ? null : name(labels, line, null);
                    if (line != null && lineName == null) lineName = name(labels, line + "|" + line.substring(line.lastIndexOf(' ') + 1), line);
                    ObjectNode car = cars.addObject().put("id", rs.getString(1));
                    nullable(car, "imageSrc", image); nullable(car, "modelName", name);
                    nullable(car, "colourName", colour); nullable(car, "modelLine", lineName);
                    car.put("imageAlt", name == null ? colour == null ? "" : colour : colour == null ? name : name + " in " + colour);
                    tally(colours, colour); tally(lines, lineName); tally(fuels, FUEL.getOrDefault(String.valueOf(fact(attrs, "fuel")), null));
                    if (key != null && context != null) {
                        if (!priced.containsKey(key)) {
                            PolicyResult cost = policy.getPointsCost(context, ReleasedStock.JSON.createObjectNode().put("eligibilityModelKey", key), read);
                            JsonNode value = cost.ok() ? cost.value().path("monthlyPoints") : null;
                            priced.put(key, value != null && value.isNumber() && Double.isFinite(value.doubleValue()) ? value.doubleValue() : null);
                        }
                        Double value = priced.get(key);
                        if (value != null) points.merge(value, 1L, Long::sum);
                    }
                }
            }
        }
        charts.set("colours", bars(colours)); charts.set("fuel", bars(fuels));
        ArrayNode pointBars = charts.putArray("points");
        points.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(e -> pointBars.addObject()
                .put("label", e.getKey() == Math.rint(e.getKey()) ? java.math.BigDecimal.valueOf(e.getKey()).toBigInteger().toString() : e.getKey().toString()).put("count", e.getValue()));
        ArrayNode modelLines = out.putArray("modelLines");
        ordered(lines).forEach(e -> modelLines.addObject().put("modelLine", e.getKey()).put("count", e.getValue()));
        counts.put("released", cars.size()).put("modelLines", lines.size()).put("colours", colours.size());
        return out;
    }

    private static ObjectNode receipt(Connection c, RunContext scope) throws SQLException {
        String sql = "SELECT tranche_id, window_id, supply_id, released_at, policy_version, source::text, "
                + "order_uuids::text, visible_order_uuids::text, tick_id FROM stock_releases "
                + "WHERE environment_id = ? AND run_id = ? ORDER BY released_at DESC, tranche_id DESC LIMIT 1";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, 1, scope);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                ObjectNode out = ReleasedStock.JSON.createObjectNode().put("trancheId", rs.getString(1)).put("windowId", rs.getString(2));
                nullable(out, "supplyId", rs.getString(3));
                out.put("releasedAt", Iso.format(rs.getObject(4, OffsetDateTime.class).toInstant())).put("policyVersion", rs.getString(5));
                out.set("source", ReleasedStock.json(rs.getString(6))); out.set("orderUuids", ReleasedStock.json(rs.getString(7)));
                out.set("visibleOrderUuids", ReleasedStock.json(rs.getString(8))); out.put("tickId", rs.getString(9));
                return out;
            }
        }
    }

    private static JsonNode allocation(Connection c, RunContext scope, Instant now) throws SQLException {
        if (now == null) return ReleasedStock.JSON.nullNode();
        try (PreparedStatement ps = c.prepareStatement(OFFERS)) {
            ps.setObject(1, now.atOffset(java.time.ZoneOffset.UTC)); bind(ps, 2, scope);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                if (rs.getLong(4) != 0) return ReleasedStock.JSON.nullNode();
                return ReleasedStock.JSON.createObjectNode().put("pending", rs.getLong(1)).put("declined", rs.getLong(2)).put("accepted", rs.getLong(3));
            }
        }
    }

    private static void bind(PreparedStatement ps, int start, RunContext scope) throws SQLException {
        ps.setString(start, scope.environmentId()); ps.setString(start + 1, scope.runId());
    }
    static final class Unavailable extends SQLException {
        Unavailable() { super("The release evidence is unavailable"); }
    }
    private static Unavailable unavailable() { return new Unavailable(); }
    private static String text(JsonNode n) { return n != null && n.isTextual() && !n.asText().isBlank() ? n.asText() : null; }
    private static String fact(JsonNode attrs, String key) { return text(attrs.path("facts").path("facts").path(key).path("value")); }
    private static JsonNode assumption(PolicyService p, PolicyRead r, String key) {
        if (p == null) return ReleasedStock.JSON.createObjectNode();
        PolicyResult result = p.getAssumption(key, r);
        return result.ok() ? result.value().path("value") : ReleasedStock.JSON.createObjectNode();
    }
    private static String name(JsonNode models, String key, String fallback) {
        String[] parts = key.split("\\|", 2);
        String engine = parts.length == 2 ? parts[1].replaceAll("\\s+", " ").trim() : "";
        String template = text(models.path(parts[0]));
        String base = template != null && (!engine.isEmpty() || !template.startsWith("{engine}"))
                ? template.replace("{engine}", engine) : fallback;
        if (base == null || base.isBlank()) return null;
        base = base.replaceAll("\\s+", " ").trim();
        return base.startsWith("BMW ") ? base : "BMW " + base;
    }
    private static void nullable(ObjectNode o, String key, String value) { if (value == null) o.putNull(key); else o.put(key, value); }
    private static void tally(Map<String, Long> counts, String key) { if (key != null) counts.merge(key, 1L, Long::sum); }
    private static List<Map.Entry<String, Long>> ordered(Map<String, Long> counts) {
        return counts.entrySet().stream().sorted(Map.Entry.<String, Long>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey())).toList();
    }
    private static ArrayNode bars(Map<String, Long> counts) {
        ArrayNode out = ReleasedStock.JSON.createArrayNode();
        ordered(counts).forEach(e -> out.addObject().put("label", e.getKey()).put("count", e.getValue()));
        return out;
    }
}
