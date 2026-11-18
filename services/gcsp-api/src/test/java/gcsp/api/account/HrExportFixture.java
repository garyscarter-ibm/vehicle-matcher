package gcsp.api.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Test-only: turns a Node golden's input into a dated HR export, a deliberately different JSON shape. */
final class HrExportFixture {

    private HrExportFixture() {}

    /** One export holding one person per golden (a golden with no manual context contributes nobody). */
    static ObjectNode export(List<GoldenFixture> goldens) {
        GoldenFixture first = goldens.get(0);
        List<ObjectNode> people = new ArrayList<>();
        for (GoldenFixture g : goldens) {
            if (!g.input.get("manualContext").isNull()) people.add(person(g));
        }
        return export(first.scope.environmentId(), first.scope.runId(), first.now, people);
    }

    static ObjectNode export(String environment, String run, String generatedAt, List<ObjectNode> people) {
        ObjectNode root = GoldenFixture.JSON.createObjectNode().put("schema", HrSnapshotRecords.SCHEMA);
        root.putObject("extract").put("environment", environment).put("run", run).put("generatedAt", generatedAt);
        ArrayNode list = root.putArray("people");
        people.forEach(list::add);
        return root;
    }

    static void write(Path file, JsonNode export) throws IOException {
        Files.createDirectories(file.getParent());
        Files.write(file, GoldenFixture.JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(export));
    }

    static ObjectNode person(GoldenFixture g) {
        return person(g.scope.employeeId(), g.scope.companyId(), g.scope.schemeId(), g.scope.gradeId(),
                g.scope.entitlementSlotId(), g.input.get("manualContext"), g.input.get("slots"), g.input.get("employeeVersion"));
    }

    /** slots are flat entitlement slots (slot id key entitlementSlotId, the record's extra keys alongside). */
    static ObjectNode person(String employeeId, String company, String scheme, String grade, String entitlementSlot,
            JsonNode m, JsonNode slots, JsonNode recordVersion) {
        JsonNode acc = m.get("account");
        ObjectNode p = GoldenFixture.JSON.createObjectNode();
        p.put("personnelNumber", employeeId);
        p.set("employeeRef", acc.get("employeeId"));
        p.set("displayName", acc.get("name"));
        p.set("staffNumber", acc.get("employeeNumber"));
        p.putObject("membership").put("company", company).put("scheme", scheme)
                .put("grade", grade).put("entitlementSlot", entitlementSlot);
        p.set("recordSet", m.get("recordSetId"));
        p.set("provenance", provenance(m.get("source")));
        p.set("home", acc.get("address"));
        p.set("reach", acc.get("contact"));
        p.set("allowanceOverride", acc.get("allowanceOverride"));
        ArrayNode holders = p.putArray("licenceHolders");
        for (JsonNode d : m.get("drivers")) {
            ObjectNode h = holders.addObject();
            h.set("id", d.get("driverId"));
            h.set("kind", d.get("kind"));
            h.set("name", d.get("name"));
            if (d.has("relationship")) h.set("relationship", d.get("relationship"));
            h.set("eligible", d.get("eligible"));
            JsonNode l = d.get("licence");
            h.putObject("licence").put("number", l.get("displayNumber").textValue()).set("classes", l.get("categories"));
            ObjectNode licence = (ObjectNode) h.get("licence");
            licence.set("from", l.get("validFrom"));
            licence.set("to", l.get("validUntil"));
            licence.set("provenance", provenance(l.get("source")));
        }
        p.set("facts", m.get("employeeFacts"));
        ArrayNode agreements = p.putArray("agreements");
        List<String> empty = new ArrayList<>();
        Map<String, JsonNode> contractsById = new LinkedHashMap<>();
        m.get("contracts").forEach(c -> contractsById.put(c.get("contractId").textValue(), c));
        for (JsonNode h : m.get("histories")) {
            if (h.get("entries").isEmpty()) empty.add(h.get("schemeId").textValue());
            for (JsonNode e : h.get("entries")) {
                ObjectNode a = agreement(e);
                JsonNode contract = "current".equals(e.get("status").textValue())
                        ? contractsById.get(e.get("contractId").textValue()) : null;
                if (contract != null && !contract.equals(e)) {
                    a.putObject("renewalWindow").set("earliest", contract.get("earliestCollectionDate"));
                    ((ObjectNode) a.get("renewalWindow")).set("latest", contract.get("latestCollectionDate"));
                }
                agreements.add(a);
            }
        }
        ArrayNode none = p.putArray("schemesWithoutHistory");
        empty.forEach(none::add);
        ArrayNode entitlements = p.putArray("entitlements");
        for (JsonNode s : slots) {
            ObjectNode e = entitlements.addObject();
            e.set("slot", s.get("entitlementSlotId"));
            e.set("capacity", s.get("capacity"));
            e.set("employeeCapacity", s.get("employeeCapacity"));
            if (s.has("contractId")) e.set("contract", s.get("contractId"));
            if (s.has("renewalId")) e.set("renewal", s.get("renewalId"));
            if (s.has("state")) e.set("state", s.get("state"));
            e.set("version", s.get("version"));
            e.set("createdAt", s.get("createdAt"));
            e.set("updatedAt", s.get("updatedAt"));
        }
        p.set("recordVersion", recordVersion);
        return p;
    }

    private static ObjectNode agreement(JsonNode e) {
        ObjectNode a = GoldenFixture.JSON.createObjectNode();
        a.set("id", e.get("contractId"));
        a.set("scheme", e.get("schemeId"));
        if (e.has("slotId")) a.set("slot", e.get("slotId"));
        if (e.has("driverId")) a.set("driver", e.get("driverId"));
        a.set("state", e.get("status"));
        a.set("vehicle", e.get("vehicle"));
        a.set("model", e.get("model"));
        a.set("media", e.get("media"));
        ObjectNode dates = a.putObject("dates");
        move(dates, "collected", e, "actualCollectionDate");
        move(dates, "ends", e, "contractEndDate");
        move(dates, "returned", e, "returnedDate");
        move(dates, "earliest", e, "earliestCollectionDate");
        move(dates, "latest", e, "latestCollectionDate");
        ObjectNode mileage = a.putObject("mileage");
        move(mileage, "annual", e, "annualMileage");
        move(mileage, "unit", e, "mileageUnit");
        move(mileage, "months", e, "months");
        move(mileage, "odometer", e, "currentOdometer");
        if (mileage.isEmpty()) a.remove("mileage");
        a.set("provenance", provenance(e.get("source")));
        return a;
    }

    private static void move(ObjectNode to, String key, JsonNode from, String fromKey) {
        if (from.has(fromKey)) to.set(key, from.get(fromKey));
    }

    private static ObjectNode provenance(JsonNode s) {
        ObjectNode p = GoldenFixture.JSON.createObjectNode();
        p.set("kind", s.get("mode"));
        p.set("ref", s.get("sourceRef"));
        p.set("version", s.get("sourceVersion"));
        p.set("schema", s.get("schemaVersion"));
        p.set("effective", s.get("effectiveFrom"));
        p.set("observed", s.get("observedAt"));
        return p;
    }
}
