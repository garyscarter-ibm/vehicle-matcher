package gcsp.api.comparison;

import static gcsp.api.comparison.ReplayRecords.JSON;
import static gcsp.api.comparison.ReplayRecords.check;
import static gcsp.api.comparison.ReplayRecords.typedFact;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import gcsp.api.policy.PolicyClock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Port of comparisonStockRows and the per-seed car grouping: exact cars, and the groups that share configuration and facts. */
final class ReplayStock {

    /** One exact car as the run stores it; releaseMs and untilMs are its availability window. */
    record Row(String orderUuid, String orderNumber, String configurationId, ObjectNode snapshot, ObjectNode visibility,
            String releaseId, String releaseAt, long releaseMs, ObjectNode availability, String factsDigest) {

        long untilMs() {
            return ComparisonValidation.parseInstant(availability.get("availableUntil").textValue()).getAsLong();
        }

        ObjectNode attributes() {
            ObjectNode out = JSON.objectNode();
            out.set("facts", snapshot);
            out.put("factsDigest", factsDigest);
            out.set("visibility", visibility);
            out.put("orderNumber", orderNumber);
            ObjectNode release = out.putObject("release");
            release.put("releaseId", releaseId);
            release.put("at", releaseAt);
            release.set("availability", availability);
            return out;
        }
    }

    /** Cars sharing configuration and facts; the first is the representative the evaluator sees. */
    record Group(String groupId, Row representative, List<String> orderUuids) {}

    record Groups(List<Group> list, Map<String, String> groupOf) {}

    private ReplayStock() {}

    static List<Row> rows(ComparisonInputs inputs, JsonNode adapterRow) {
        JsonNode manifest = inputs.manifest();
        JsonNode adapter = adapterRow.get("value");
        JsonNode after = adapter.get("stockAvailabilityDaysAfterHorizon");
        check(inputs.stock().size() < 10000000 && after != null && ComparisonValidation.safeInteger(after)
                && after.doubleValue() > 0, "comparison.recordAdapter.v1");
        String startsAt = manifest.get("startsAt").textValue();
        long start = ComparisonValidation.parseInstant(startsAt).getAsLong();
        String until = PolicyClock.iso(java.time.Instant.ofEpochMilli(start
                + (long) ((manifest.get("horizonDays").doubleValue() + after.doubleValue()) * 86400000L)));
        Map<String, JsonNode> releaseOf = new HashMap<>();
        Map<String, Integer> releases = new HashMap<>();
        for (JsonNode release : inputs.releaseSchedule()) {
            for (JsonNode id : release.get("orderUuids")) {
                releaseOf.put(id.textValue(), release);
                releases.merge(id.textValue(), 1, Integer::sum);
            }
        }
        Set<String> companies = new LinkedHashSet<>();
        Set<String> schemes = new LinkedHashSet<>();
        for (JsonNode e : inputs.employees()) {
            companies.add(e.get("companyId").textValue());
            schemes.add(e.get("schemeId").textValue());
        }
        Map<String, ObjectNode> factsByLine = new HashMap<>();
        List<Row> out = new ArrayList<>(inputs.stock().size());
        IdentityHashMap<JsonNode, String> digests = new IdentityHashMap<>();
        int index = 0;
        for (JsonNode car : inputs.stock()) {
            String uuid = car.get("orderUuid").textValue();
            JsonNode release = releaseOf.get(uuid);
            check(release != null && releases.get(uuid) == 1
                    && ComparisonValidation.parseInstant(release.get("at").textValue()).isPresent(), "releaseSchedule");
            String line = car.get("modelLine").textValue();
            String key = line + "\u0000" + car.get("eligibilityModelKey").textValue();
            ObjectNode facts = factsByLine.computeIfAbsent(key, k -> {
                ObjectNode f = JSON.objectNode();
                JsonNode raw = adapter.get("stockFactsByModelLine").get(line);
                if (raw != null) raw.fields().forEachRemaining(e -> f.set(e.getKey(), typedFact(e.getValue(), adapterRow, startsAt)));
                for (String name : List.of("eligibilityModelKey", "modelLine")) {
                    ObjectNode known = JSON.objectNode();
                    known.put("status", "known");
                    known.set("value", car.get(name));
                    known.putNull("unit");
                    f.set(name, typedFact(known, adapterRow, startsAt));
                }
                return f;
            });
            ObjectNode snapshot = JSON.objectNode();
            snapshot.put("contractVersion", "vehicle-snapshot-v1");
            snapshot.put("candidateKey", "comparison-synthetic:exact-stock:" + uuid);
            snapshot.put("sourceNamespace", "comparison-synthetic");
            snapshot.put("identityKind", "exact-stock");
            snapshot.putObject("sourceKeys").put("stockId", uuid);
            snapshot.put("snapshotVersion", car.get("snapshotVersion").textValue() + ":" + adapter.get("fixtureVersion").textValue());
            snapshot.put("observedAt", startsAt);
            snapshot.putObject("display").set("name", car.get("configuration").get("model"));
            snapshot.set("facts", facts);
            ObjectNode visibility = JSON.objectNode();
            visibility.set("companyIds", JSON.arrayNode());
            companies.forEach(((com.fasterxml.jackson.databind.node.ArrayNode) visibility.get("companyIds"))::add);
            visibility.set("schemeIds", JSON.arrayNode());
            schemes.forEach(((com.fasterxml.jackson.databind.node.ArrayNode) visibility.get("schemeIds"))::add);
            visibility.putNull("employeeIds");
            String at = release.get("at").textValue();
            ObjectNode availability = JSON.objectNode();
            availability.put("state", "available");
            availability.put("availableFrom", at);
            availability.put("availableUntil", until);
            availability.put("version", "comparison:" + manifest.get("inputHash").textValue() + ":" + release.get("releaseId").textValue());
            out.add(new Row(uuid, String.format("%07d", ++index), car.get("configurationId").textValue(), snapshot,
                    visibility, release.get("releaseId").textValue(), at,
                    ComparisonValidation.parseInstant(at).getAsLong(), availability,
                    digests.computeIfAbsent(facts, CanonicalJson::digest)));
        }
        return out;
    }

    static Groups groups(List<Row> rows) {
        Map<String, Group> byKey = new LinkedHashMap<>();
        Map<String, String> groupOf = new HashMap<>();
        for (Row row : rows) {
            String key = row.configurationId() + "\u0000" + row.factsDigest();
            Group group = byKey.get(key);
            if (group == null) {
                group = new Group("group-" + (byKey.size() + 1), row, new ArrayList<>());
                byKey.put(key, group);
            }
            group.orderUuids().add(row.orderUuid());
            groupOf.put(row.orderUuid(), group.groupId());
        }
        return new Groups(new ArrayList<>(byKey.values()), groupOf);
    }
}
