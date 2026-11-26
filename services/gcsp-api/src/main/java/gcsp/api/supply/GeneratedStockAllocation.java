package gcsp.api.supply;

import static gcsp.api.supply.GeneratedJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Pure stock-only allocation against the complete retained identity inventory. */
final class GeneratedStockAllocation {
    static final String VERSION = "synthetic-identities.sha256-v1";
    private GeneratedStockAllocation() {}

    static ObjectNode allocate(JsonNode inventory, String runId, String seed, JsonNode plan, List<ObjectNode> vehicles) {
        if (!validInventory(inventory)) unavailable("retained-allocation-inventory-unavailable");
        ObjectNode next = inventory.deepCopy();
        List<JsonNode> records = list(next.path("records"));
        Set<String> planned = new HashSet<>();
        vehicles.forEach(v -> planned.add(v.path("vehicleId").asText()));
        int before = records.size();
        records.removeIf(r -> runId.equals(r.path("runId").asText()) && "stock".equals(r.path("usage").asText())
                && !r.has("vin17") && !planned.contains(r.path("vehicleId").asText()));
        boolean changed = before != records.size();
        String corpus = plan.path("corpusVersion").asText();
        if (records.stream().anyMatch(r -> runId.equals(r.path("runId").asText()) && !corpus.equals(r.path("corpusVersion").asText()))) fail("version-conflict");
        int maxAttempts = inventory.path("limits").path("maxAttempts").asInt();
        int orderSpace = inventory.path("limits").path("orderNumberSpace").asInt();
        int wholesalerSpace = inventory.path("limits").path("wholesalerSpace").asInt();
        Set<String> uuids = new HashSet<>(), numbers = new HashSet<>();
        Set<Integer> wholesalers = new HashSet<>();
        Map<String, JsonNode> byVehicle = new HashMap<>(), physical = new HashMap<>();
        for (JsonNode row : records) {
            uuids.add(row.path("orderUuid").asText()); wholesalers.add(row.path("wholesalerOrderId").asInt());
            if (runId.equals(row.path("runId").asText())) { numbers.add(row.path("orderNumber").asText()); byVehicle.put(row.path("vehicleId").asText(), row); }
            if (row.has("vin17")) physical.put(row.path("vehicleId").asText(), row);
        }
        List<ObjectNode> sorted = new ArrayList<>(vehicles);
        sorted.sort(Comparator.comparing(v -> v.path("vehicleId").asText()));
        for (ObjectNode vehicle : sorted) {
            String vehicleId = vehicle.path("vehicleId").asText();
            ObjectNode common = obj("runId", runId, "vehicleId", vehicleId, "configurationId", vehicle.path("configurationId"),
                    "snapshotVersion", vehicle.path("snapshotVersion"), "configurationHash", digest(vehicle.path("configuration")),
                    "seed", seed, "corpusVersion", corpus, "generatorVersion", VERSION);
            JsonNode existing = byVehicle.get(vehicleId), held = physical.get(vehicleId);
            if (held != null) for (String key : List.of("configurationId", "snapshotVersion", "configurationHash", "corpusVersion", "generatorVersion")) {
                if (!held.path(key).equals(common.path(key))) fail("version-conflict");
            }
            if (existing != null) {
                for (String key : names(common)) if (!common.path(key).equals(existing.path(key))) fail("version-conflict");
                continue;
            }
            ArrayNode entropy = arr(VERSION, seed, runId, corpus, vehicleId);
            String uuid = null;
            for (int attempt = 0; attempt < maxAttempts; attempt++) {
                String candidate = uuid(append(entropy, "uuid", attempt));
                if (!uuids.contains(candidate)) { uuid = candidate; break; }
            }
            if (uuid == null) fail("exhausted");
            int start = (int) ordinal(append(entropy, "order-number"), orderSpace);
            String number = null;
            for (int attempt = 0; attempt < Math.min(maxAttempts, orderSpace); attempt++) {
                String candidate = String.format(Locale.ROOT, "%07d", (start + attempt) % orderSpace);
                if (!numbers.contains(candidate)) { number = candidate; break; }
            }
            if (number == null) fail("exhausted");
            start = (int) ordinal(append(entropy, "wholesaler"), wholesalerSpace);
            Integer wholesaler = null;
            for (int attempt = 0; attempt < Math.min(maxAttempts, wholesalerSpace); attempt++) {
                int candidate = 10000000 + (start + attempt) % wholesalerSpace;
                if (!wholesalers.contains(candidate)) { wholesaler = candidate; break; }
            }
            if (wholesaler == null) fail("exhausted");
            common.put("originatingDatasetId", plan.path("datasetId").asText()).put("identityKind", "synthetic").put("usage", "stock")
                    .put("orderUuid", uuid).put("orderNumber", number).put("wholesalerOrderId", wholesaler);
            records.add(common); byVehicle.put(vehicleId, common); uuids.add(uuid); numbers.add(number); wholesalers.add(wholesaler); changed = true;
        }
        records.sort(Comparator.comparing(r -> json(arr(r.path("runId"), r.path("vehicleId")), false)));
        next.set("records", node(records));
        if (changed) next.set("revision", node(inventory.path("revision").asLong() + 1));
        next.remove("contentDigest"); next.put("contentDigest", digest(next));
        return next;
    }

    private static String uuid(JsonNode entropy) {
        byte[] bytes = Arrays.copyOf(hash(json(entropy, false)), 16);
        bytes[6] = (byte) ((bytes[6] & 15) | 64); bytes[8] = (byte) ((bytes[8] & 63) | 128);
        String h = HexFormat.of().formatHex(bytes);
        return h.substring(0, 8) + "-" + h.substring(8, 12) + "-" + h.substring(12, 16) + "-" + h.substring(16, 20) + "-" + h.substring(20);
    }

    private static boolean validInventory(JsonNode inventory) {
        if (!inventory.isObject() || !"1".equals(inventory.path("schemaVersion").asText()) || !VERSION.equals(inventory.path("generatorVersion").asText())
                || !integer(inventory.path("revision")) || inventory.path("revision").asDouble() < 0 || !inventory.path("records").isArray()) return false;
        ObjectNode content = inventory.deepCopy(); content.remove("contentDigest");
        if (!digest(content).equals(inventory.path("contentDigest").asText())) return false;
        JsonNode limits = inventory.path("limits");
        if (!exact(limits, "maxAttempts", "serialSpace", "orderNumberSpace", "wholesalerSpace")) return false;
        for (String name : names(limits)) {
            int max = switch (name) { case "orderNumberSpace" -> 10000000; case "wholesalerSpace" -> 90000000; default -> 1000000; };
            if (!positive(limits.path(name)) || limits.path(name).asDouble() > max) return false;
        }
        Set<String> identities = new HashSet<>(), uuids = new HashSet<>(), wholesalers = new HashSet<>(), numbers = new HashSet<>();
        Map<String, String> physical = new HashMap<>(), vins = new HashMap<>(), shortVins = new HashMap<>();
        for (JsonNode row : inventory.path("records")) {
            for (String key : List.of("runId", "vehicleId", "configurationId", "snapshotVersion", "configurationHash", "seed", "corpusVersion", "originatingDatasetId")) {
                if (!row.path(key).isTextual() || row.path(key).asText().isEmpty() || row.path(key).asText().length() > 4096) return false;
            }
            if (!"synthetic".equals(row.path("identityKind").asText()) || !VERSION.equals(row.path("generatorVersion").asText())
                    || !row.path("orderUuid").asText().matches("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
                    || !row.path("orderNumber").asText().matches("[0-9]{7}") || !integer(row.path("wholesalerOrderId"))
                    || row.path("wholesalerOrderId").asLong() < 10000000 || row.path("wholesalerOrderId").asLong() > 99999999
                    || !List.of("stock", "delivered-car", "current-car").contains(row.path("usage").asText())) return false;
            if ("stock".equals(row.path("usage").asText())) {
                if (List.of("vin17", "vin7", "serial", "profile").stream().anyMatch(row::has)) return false;
            } else {
                if (!validVin(row)) return false;
                ArrayNode association = arr(row.path("vehicleId"), row.path("configurationId"), row.path("configurationHash"), row.path("snapshotVersion"), row.path("corpusVersion"));
                for (String field : List.of("vin17", "vin7", "serial", "profile", "sourceKind", "sources", "confidence", "unknownFields", "completeVinDecoded", "modelYear", "productionEra", "productionDate", "registrationDate", "vinAllocationOrigin")) {
                    if (!row.has(field)) return false;
                    association.add(row.path(field));
                }
                String value = digest(association);
                if (!association(physical, row.path("vehicleId").asText(), value) || !association(vins, row.path("vin17").asText(), value)
                        || !association(shortVins, row.path("vin7").asText(), value)) return false;
            }
            if (!identities.add(json(arr(row.path("runId"), row.path("vehicleId")), false)) || !uuids.add(row.path("orderUuid").asText())
                    || !wholesalers.add(row.path("wholesalerOrderId").asText()) || !numbers.add(json(arr(row.path("runId"), row.path("orderNumber")), false))) return false;
        }
        return true;
    }

    private static boolean association(Map<String, String> values, String key, String value) {
        return value.equals(values.putIfAbsent(key, value)) || value.equals(values.get(key));
    }

    private static boolean validVin(JsonNode row) {
        String vin = row.path("vin17").asText();
        if (!vin.matches("[A-HJ-NPR-Z0-9]{17}") || !row.path("vin7").asText().equals(vin.substring(10))
                || !row.path("serial").asText().matches("[0-9]{6}") || !row.path("serial").asText().equals(vin.substring(11))) return false;
        String letters = "ABCDEFGHJKLMNPRSTUVWXYZ", values = "12345678123457923456789";
        int[] weights = {8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2};
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            char c = vin.charAt(i); int value = Character.isDigit(c) ? c - '0' : values.charAt(letters.indexOf(c)) - '0'; sum += value * weights[i];
        }
        JsonNode p = row.path("profile"), origin = row.path("vinAllocationOrigin");
        return vin.charAt(8) == (sum % 11 == 10 ? 'X' : (char) ('0' + sum % 11)) && text(p.path("profileId"))
                && "1".equals(p.path("profileVersion").asText()) && "vin-profiles.v1".equals(p.path("registryVersion").asText())
                && p.path("referenceOnly").asBoolean() && "evidenced-reference".equals(row.path("sourceKind").asText())
                && row.path("sources").isArray() && !row.path("sources").isEmpty() && row.path("productionDate").isNull()
                && row.path("registrationDate").isNull() && row.path("completeVinDecoded").isBoolean() && !row.path("completeVinDecoded").asBoolean()
                && text(origin.path("seed")) && text(origin.path("runId")) && text(origin.path("originatingDatasetId"));
    }

    private static void fail(String status) { throw new Refusal(status, null, "synthetic-allocation-failed"); }
}
