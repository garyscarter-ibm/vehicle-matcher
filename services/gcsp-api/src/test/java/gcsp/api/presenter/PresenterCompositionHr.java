package gcsp.api.presenter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Test-only: one non-demo person as a dated HR export (the Node paula golden retargeted to employee-nova). */
final class PresenterCompositionHr {

    static final String EMPLOYEE = "employee-nova";
    static final String SLOT = "slot-nova";
    static final Path FILE = Path.of("target", "presenter-composition", "hr-export.json").toAbsolutePath();
    private static final ObjectMapper JSON = new ObjectMapper();

    private PresenterCompositionHr() {}

    /** The complete manual choices for this person (the golden's, retargeted). */
    static ObjectNode choices() {
        ObjectNode c = JSON.createObjectNode();
        c.put("mode", "replacement").put("oldContractId", "current:" + EMPLOYEE).put("slotId", SLOT)
                .put("schemeId", "choices-fs-uk").put("driverId", "driver:" + EMPLOYEE)
                .put("contractOptionId", "twelve-month-12000").put("requestedCollectionDate", "2026-11-12")
                .put("collectionLocationId", "demo-collection-centre").put("brand", "bmw")
                .put("expectedReturnMileage", 20000).put("specialRequirements", "");
        c.putObject("contact").put("phone", "01632 960000").put("email", "nova.mason@gcsp-demo.com");
        return c;
    }

    static void write(String environment, String run) throws IOException {
        JsonNode golden;
        try (InputStream in = PresenterCompositionHr.class.getResourceAsStream("/account/node-baseline/paula.json")) {
            golden = JSON.readTree(new String(in.readAllBytes(), StandardCharsets.UTF_8).replace("paula", "nova"));
        }
        JsonNode input = golden.get("input");
        ObjectNode root = JSON.createObjectNode().put("schema", "gcsp-hr-export/1");
        root.putObject("extract").put("environment", environment).put("run", run)
                .put("generatedAt", golden.get("now").textValue());
        root.putArray("people").add(person(input.get("manualContext"), input.get("slots"), input.get("employeeVersion")));
        Files.createDirectories(FILE.getParent());
        Files.write(FILE, JSON.writerWithDefaultPrettyPrinter().writeValueAsBytes(root));
    }

    private static ObjectNode person(JsonNode m, JsonNode slots, JsonNode recordVersion) {
        JsonNode acc = m.get("account");
        ObjectNode p = JSON.createObjectNode();
        p.put("personnelNumber", EMPLOYEE);
        p.set("employeeRef", acc.get("employeeId"));
        p.set("displayName", acc.get("name"));
        p.set("staffNumber", acc.get("employeeNumber"));
        p.putObject("membership").put("company", acc.get("companyId").textValue()).put("scheme", acc.get("schemeId").textValue())
                .put("grade", acc.get("gradeId").textValue()).put("entitlementSlot", SLOT);
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
            ObjectNode licence = h.putObject("licence");
            licence.put("number", l.get("displayNumber").textValue()).set("classes", l.get("categories"));
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
        ObjectNode a = JSON.createObjectNode();
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
        ObjectNode p = JSON.createObjectNode();
        p.set("kind", s.get("mode"));
        p.set("ref", s.get("sourceRef"));
        p.set("version", s.get("sourceVersion"));
        p.set("schema", s.get("schemaVersion"));
        p.set("effective", s.get("effectiveFrom"));
        p.set("observed", s.get("observedAt"));
        return p;
    }
}
