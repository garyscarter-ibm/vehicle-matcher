package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Port of the Node stock pull port: exact car fields, the pull envelope and the tranche shape. */
public final class PullValidator {

    public static final String VERSION = "1.0.0";
    static final Set<String> STOCK_FIELDS = Set.of("orderUuid", "orderNumber", "configurationId", "wholesalerOrderId",
            "revision", "account", "visibility", "agModelCode", "vgModelCode", "facts", "corpusVersion", "availability");
    private static final Set<String> ENVELOPE = Set.of("schemaVersion", "runId", "observedAt", "source", "tranche", "stock");
    private static final Set<String> SOURCE = Set.of("providerId", "version", "label", "mode");
    private static final Set<String> MODES = Set.of("synthetic", "dated-snapshot", "authorised-live");
    private static final Set<String> TRANCHE = Set.of("trancheId", "windowId", "availableAt", "supplyId", "orderUuids");
    private static final Pattern UUID_V4 = Pattern.compile(
            "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$");
    private static final Pattern ORDER_NUMBER = Pattern.compile("^\\d{7}$");

    private PullValidator() {}

    public record Tranche(String trancheId, String windowId, String availableAt, String supplyId,
            List<String> orderUuids, JsonNode node) {}

    /** A validated pull: provider source, the tranche if any, and every car (exact fields only). */
    public record Snapshot(JsonNode source, Tranche tranche, List<ObjectNode> stock, JsonNode raw) {}

    public sealed interface Result {}

    public record Valid(Snapshot snapshot) implements Result {}

    public record Invalid(String field, String reason) implements Result {}

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && n.asText().length() >= 1 && n.asText().length() <= 512;
    }

    /** True when observedAt is a valid instant before asOf and older than the policy age. */
    public static boolean isStale(JsonNode value, Instant asOf, int maxAgeMinutes) {
        Instant observed = value == null ? null : Iso.parse(value.path("observedAt").asText(null));
        if (observed == null || !observed.isBefore(asOf)) return false;
        return asOf.toEpochMilli() - observed.toEpochMilli() > maxAgeMinutes * 60_000L;
    }

    public static boolean validCar(JsonNode car) {
        if (car == null || !car.isObject()) return false;
        Iterator<String> names = car.fieldNames();
        while (names.hasNext()) if (!STOCK_FIELDS.contains(names.next())) return false;
        if (!car.path("orderUuid").isTextual() || !UUID_V4.matcher(car.get("orderUuid").asText()).matches()) return false;
        if (!car.path("orderNumber").isTextual() || !ORDER_NUMBER.matcher(car.get("orderNumber").asText()).matches()) {
            return false;
        }
        JsonNode cfg = car.path("configurationId");
        if (!cfg.isTextual() || cfg.asText().isEmpty() || cfg.asText().length() > 4096) return false;
        if (car.has("wholesalerOrderId")) {
            JsonNode w = car.get("wholesalerOrderId");
            if (!w.isIntegralNumber() || !w.canConvertToLong() || w.asLong() < 10_000_000L || w.asLong() > 99_999_999L) {
                return false;
            }
        }
        if (car.has("revision")) {
            JsonNode r = car.get("revision");
            if (!r.isIntegralNumber() || !r.canConvertToLong() || r.asLong() <= 0) return false;
        }
        if (car.has("availability")) {
            JsonNode a = car.get("availability");
            if (!a.isObject() || a.size() != 1 || !a.has("availableUntil")
                    || Iso.parse(a.get("availableUntil").asText(null)) == null || !a.get("availableUntil").isTextual()) {
                return false;
            }
        }
        return noVin(car);
    }

    private static boolean noVin(JsonNode n) {
        if (n.isObject()) {
            for (Iterator<Map.Entry<String, JsonNode>> it = n.fields(); it.hasNext();) {
                Map.Entry<String, JsonNode> e = it.next();
                String key = e.getKey().toLowerCase();
                if (key.equals("vin") || key.equals("vin7") || key.equals("vin17") || !noVin(e.getValue())) return false;
            }
        } else if (n.isArray()) {
            for (JsonNode child : n) if (!noVin(child)) return false;
        }
        return true;
    }

    public static Result validate(JsonNode value, String runId, Instant asOf) {
        Invalid stockBad = new Invalid("stock", "Malformed, duplicated or wrong-run stock snapshot.");
        if (value == null || !value.isObject()) return stockBad;
        for (Iterator<String> it = value.fieldNames(); it.hasNext();) if (!ENVELOPE.contains(it.next())) return stockBad;
        JsonNode source = value.path("source");
        if (!VERSION.equals(value.path("schemaVersion").asText(null)) || !runId.equals(value.path("runId").asText(null))
                || !Iso.format(asOf).equals(value.path("observedAt").asText(null)) || !source.isObject()
                || !value.path("stock").isArray()) {
            return stockBad;
        }
        for (Iterator<String> it = source.fieldNames(); it.hasNext();) if (!SOURCE.contains(it.next())) return stockBad;
        for (String key : List.of("providerId", "version", "label")) if (!text(source.get(key))) return stockBad;
        if (!source.path("mode").isTextual() || !MODES.contains(source.get("mode").asText())) return stockBad;
        List<ObjectNode> stock = new ArrayList<>();
        Set<String> uuids = new HashSet<>();
        Set<String> numbers = new HashSet<>();
        for (JsonNode car : value.get("stock")) {
            if (!validCar(car) || !uuids.add(car.get("orderUuid").asText())
                    || !numbers.add(car.get("orderNumber").asText())) {
                return stockBad;
            }
            stock.add(((ObjectNode) car).deepCopy());
        }
        if (!value.has("tranche")) return new Invalid("tranche", "Expected a released exact-car tranche at the current time.");
        JsonNode t = value.get("tranche");
        Tranche tranche = null;
        if (!t.isNull()) {
            tranche = tranche(t, asOf, uuids);
            if (tranche == null) return new Invalid("tranche", "Expected a released exact-car tranche at the current time.");
        }
        return new Valid(new Snapshot(source.deepCopy(), tranche, stock, value.deepCopy()));
    }

    private static Tranche tranche(JsonNode t, Instant asOf, Set<String> stockUuids) {
        if (!t.isObject()) return null;
        for (Iterator<String> it = t.fieldNames(); it.hasNext();) if (!TRANCHE.contains(it.next())) return null;
        if (!text(t.get("trancheId")) || !text(t.get("windowId"))) return null;
        Instant availableAt = t.path("availableAt").isTextual() ? Iso.parse(t.get("availableAt").asText()) : null;
        if (availableAt == null || availableAt.isAfter(asOf)) return null;
        if (!t.has("supplyId") || !(t.get("supplyId").isNull() || text(t.get("supplyId")))) return null;
        JsonNode ids = t.path("orderUuids");
        if (!ids.isArray() || ids.isEmpty()) return null;
        List<String> orderUuids = new ArrayList<>();
        for (JsonNode id : ids) {
            if (!id.isTextual() || !stockUuids.contains(id.asText()) || orderUuids.contains(id.asText())) return null;
            orderUuids.add(id.asText());
        }
        String supplyId = t.get("supplyId").isNull() ? null : t.get("supplyId").asText();
        return new Tranche(t.get("trancheId").asText(), t.get("windowId").asText(), t.get("availableAt").asText(),
                supplyId, orderUuids, t.deepCopy());
    }
}
