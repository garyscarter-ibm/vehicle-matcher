package gcsp.api.comparison;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;

/** Port of the record builders of server/gcsp/comparison/harness.js: typed facts, employee facts and manual records. */
final class ReplayRecords {

    static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    static final ObjectMapper MAPPER = new ObjectMapper();

    private ReplayRecords() {}

    static ComparisonRunError refuse(String code, String boundary) {
        return new ComparisonRunError(code, boundary);
    }

    static void check(boolean condition, String boundary) {
        if (!condition) throw refuse("invalid-input", boundary);
    }

    /** JSON text round trip, so in-memory nodes compare equal to what jsonb returns. */
    static JsonNode normal(JsonNode node) {
        try {
            return MAPPER.readTree(node.toString());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    static JsonNode number(double value) {
        return value == Math.rint(value) && Math.abs(value) < 9.007199254740992E15
                ? JSON.numberNode((long) value) : JSON.numberNode(value);
    }

    static String text(JsonNode node) {
        return node != null && node.isTextual() ? node.textValue() : null;
    }

    static ObjectNode typedFact(JsonNode raw, JsonNode row, String now) {
        String key = row.get("key").textValue();
        JsonNode status = raw == null ? null : raw.get("status");
        JsonNode value = raw == null ? null : raw.get("value");
        JsonNode unit = raw == null ? null : raw.get("unit");
        boolean unknown = "unknown".equals(text(status));
        boolean known = "known".equals(text(status));
        check(raw != null && raw.isObject() && (known || unknown) && (value != null && value.isNull()) == unknown
                && unit != null && (unit.isNull() || unit.isTextual()), key);
        ObjectNode out = JSON.objectNode();
        out.set("status", status);
        if (value != null) out.set("value", value.deepCopy());
        out.set("unit", unit);
        ObjectNode provenance = out.putObject("provenance");
        provenance.set("sourceRef", row.get("source"));
        provenance.put("version", row.get("policyVersion").textValue() + ":" + key);
        provenance.put("observedAt", now);
        provenance.put("assurance", unknown ? "unknown" : "synthetic-scenario");
        return out;
    }

    static ObjectNode underlyingEssentials(JsonNode employee) {
        ObjectNode out = JSON.objectNode();
        employee.get("underlyingNeeds").get("essentials").fields().forEachRemaining(e -> {
            ObjectNode requirement = ((ObjectNode) e.getValue()).deepCopy();
            requirement.put("state", "confirmed").put("source", "synthetic-underlying-needs");
            out.set(e.getKey(), requirement);
        });
        return out;
    }

    /** Employee facts shared by the manual records and the per-seed evaluation. */
    static ObjectNode employeeFacts(JsonNode employee, JsonNode adapterRow, String now) {
        ObjectNode out = JSON.objectNode();
        adapterRow.get("value").get("employeeFacts").fields()
                .forEachRemaining(e -> out.set(e.getKey(), typedFact(e.getValue(), adapterRow, now)));
        out.set("essentials", underlyingEssentials(employee));
        ObjectNode required = JSON.objectNode();
        required.put("status", "known");
        required.set("value", employee.get("renewalAt"));
        required.putNull("unit");
        out.set("requiredBy", typedFact(required, adapterRow, now));
        return out;
    }

    static ObjectNode driverFact(JsonNode adapterRow, String now) {
        return typedFact(adapterRow.get("value").get("driver").get("eligible"), adapterRow, now);
    }

    static String slotId(String id) {
        return "comparison-slot:" + id;
    }

    static String driverId(String id) {
        return "comparison-driver:" + id;
    }

    static String contractId(String id) {
        return "comparison-current:" + id;
    }

    static String renewalId(String id) {
        return "comparison-renewal:" + id;
    }

    // Seeded through employeeId, so the cohort's inputHash and every other generated value stay unchanged.
    private static double share(String id, String field) {
        ArrayNode in = JSON.arrayNode().add(id).add("comparison-current-contract").add(field);
        return Long.parseLong(CanonicalJson.digest(in).substring(0, 8), 16) / 4294967296.0;
    }

    /** The manual-context record the account and driver ports read for one employee. */
    static ObjectNode manualRecord(JsonNode employee, JsonNode adapterRow, String now, JsonNode modelLines) {
        JsonNode adapter = adapterRow.get("value");
        String id = employee.get("employeeId").textValue();
        JsonNode mileage = adapter.get("employeeFacts").get("annualMileage");
        check(mileage != null && "known".equals(text(mileage.get("status"))) && mileage.get("value") != null
                && mileage.get("value").isIntegralNumber() && "mi/year".equals(text(mileage.get("unit")))
                && modelLines != null && modelLines.isArray() && modelLines.size() > 0
                && adapter.path("contact").path("phone").isTextual(), "comparison.recordAdapter.v1");
        ObjectNode source = JSON.objectNode();
        source.put("mode", "synthetic");
        source.set("sourceRef", adapterRow.get("source"));
        source.put("schemaVersion", "1");
        source.put("sourceVersion", adapterRow.get("policyVersion").textValue() + ":" + adapter.get("fixtureVersion").textValue());
        source.put("effectiveFrom", now);
        source.put("observedAt", now);
        ObjectNode licence = ((ObjectNode) adapter.get("driver").get("licence")).deepCopy();
        licence.set("source", source.deepCopy());
        String renewalAt = employee.get("renewalAt").textValue();
        String model = modelLines.get((int) Math.floor(share(id, "model") * modelLines.size())).textValue();
        int bar = model.indexOf('|');
        ObjectNode contract = JSON.objectNode();
        contract.put("contractId", contractId(id));
        contract.put("employeeId", id);
        contract.set("schemeId", employee.get("schemeId"));
        contract.put("slotId", slotId(id));
        contract.put("driverId", driverId(id));
        contract.put("status", "current");
        contract.put("contractEndDate", renewalAt.substring(0, 10));
        contract.put("earliestCollectionDate", now.substring(0, 10));
        contract.put("latestCollectionDate", renewalAt.substring(0, 10));
        contract.set("source", source.deepCopy());
        // Up to one year at the policy's annual mileage; the model is one of the scheme's configured lines.
        contract.put("model", bar < 0 ? model : model.substring(0, bar) + " " + model.substring(bar + 1));
        ObjectNode odometer = contract.putObject("currentOdometer");
        odometer.put("value", (long) Math.floor(share(id, "odometer") * mileage.get("value").doubleValue()));
        odometer.put("unit", "mi");

        ObjectNode record = JSON.objectNode();
        record.put("recordSetId", "comparison:" + id + ":" + adapter.get("fixtureVersion").textValue());
        record.set("source", source);
        ObjectNode account = record.putObject("account");
        account.put("employeeId", id);
        account.put("name", id);
        account.set("companyId", employee.get("companyId"));
        account.set("gradeId", employee.get("gradeId"));
        account.set("schemeId", employee.get("schemeId"));
        account.putNull("allowanceOverride");
        ObjectNode contact = account.putObject("contact");
        contact.set("phone", adapter.get("contact").get("phone"));
        contact.put("email", adapter.get("contact").get("emailTemplate").textValue().replace("{employeeId}", id));
        ObjectNode driver = record.putArray("drivers").addObject();
        driver.put("driverId", driverId(id));
        driver.put("employeeId", id);
        driver.put("name", id);
        driver.set("kind", adapter.get("driver").get("kind"));
        driver.set("eligible", typedFact(adapter.get("driver").get("eligible"), adapterRow, now));
        driver.set("licence", licence);
        record.set("employeeFacts", employeeFacts(employee, adapterRow, now));
        record.putArray("contracts").add(contract.deepCopy());
        ObjectNode history = record.putArray("histories").addObject();
        history.set("schemeId", employee.get("schemeId"));
        history.putArray("entries").add(contract);
        return record;
    }
}
