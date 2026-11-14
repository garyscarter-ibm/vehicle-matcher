package gcsp.api.account;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.BiFunction;

/**
 * Maps a dated HR export (gcsp-hr-export/1) into the records shape, re-reading the file per call so a bad file
 * is a source failure, never stale data. Facts are never repaired.
 */
public final class HrSnapshotRecords implements AccountRecordsPort {

    public static final String SCHEMA = "gcsp-hr-export/1";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Map<String, String> PROVENANCE = Map.of("kind", "mode", "ref", "sourceRef",
            "version", "sourceVersion", "schema", "schemaVersion", "effective", "effectiveFrom",
            "observed", "observedAt");

    /** A load failure with a message that never carries file content. */
    static final class SnapshotException extends Exception {
        SnapshotException(String message) {
            super(message);
        }
    }

    private final Path path;

    HrSnapshotRecords(Path path) {
        this.path = path;
    }

    /** Startup check: the file must exist and carry the expected top-level schema, else the service stops. */
    public static HrSnapshotRecords open(String pathText) {
        if (pathText == null || pathText.isBlank()) {
            throw new IllegalStateException("gcsp.account.provider=hr-snapshot needs gcsp.account.hr-snapshot.path");
        }
        Path p = Paths.get(pathText.trim());
        try {
            load(p);
        } catch (SnapshotException e) {
            throw new IllegalStateException("gcsp.account.hr-snapshot.path " + p + " is unusable: " + e.getMessage());
        }
        return new HrSnapshotRecords(p);
    }

    static JsonNode load(Path file) throws SnapshotException {
        if (!Files.isRegularFile(file)) throw new SnapshotException("file not found");
        JsonNode root;
        try {
            root = JSON.readTree(file.toFile());
        } catch (JsonProcessingException e) {
            throw new SnapshotException("not valid JSON");
        } catch (IOException e) {
            throw new SnapshotException("not readable");
        }
        JsonNode extract = root == null ? null : root.get("extract");
        if (root == null || !root.isObject() || !text(root.get("schema")) || !SCHEMA.equals(root.get("schema").textValue())
                || extract == null || !extract.isObject() || !text(extract.get("environment"))
                || !text(extract.get("run")) || root.get("people") == null || !root.get("people").isArray()) {
            throw new SnapshotException("does not match schema " + SCHEMA);
        }
        return root;
    }

    @Override
    public SourceResult readEmployment(String environmentId, String runId, String employeeId) {
        return read(environmentId, runId, employeeId, (extract, person) -> {
            JsonNode m = person.get("membership");
            ObjectNode out = F.objectNode();
            out.set("employeeId", person.get("personnelNumber"));
            copy(out, "name", person, "displayName");
            copy(out, "companyId", m, "company");
            copy(out, "schemeId", m, "scheme");
            copy(out, "gradeId", m, "grade");
            copy(out, "entitlementSlotId", m, "entitlementSlot");
            return out;
        });
    }

    @Override
    public SourceResult readEmployeeContract(AccountScope scope) {
        return read(scope.environmentId(), scope.runId(), scope.employeeId(), (extract, person) -> {
            ObjectNode out = base(extract, person);
            ObjectNode account = out.putObject("account");
            copy(account, "employeeId", person, "employeeRef");
            copy(account, "name", person, "displayName");
            JsonNode m = person.get("membership");
            copy(account, "companyId", m, "company");
            copy(account, "gradeId", m, "grade");
            copy(account, "schemeId", m, "scheme");
            copy(account, "employeeNumber", person, "staffNumber");
            copy(account, "address", person, "home");
            copy(account, "contact", person, "reach");
            copy(account, "allowanceOverride", person, "allowanceOverride");
            JsonNode agreements = person.get("agreements");
            if (agreements != null && agreements.isArray()) {
                ArrayNode contracts = out.putArray("contracts");
                Map<String, ArrayNode> grouped = new LinkedHashMap<>();
                for (JsonNode a : agreements) {
                    if (!a.isObject()) throw new IllegalStateException("agreement is not an object");
                    if ("current".equals(text(a, "state"))) contracts.add(agreement(person, a, true));
                    String scheme = text(a, "scheme");
                    if (scheme == null) throw new IllegalStateException("agreement without a scheme");
                    grouped.computeIfAbsent(scheme, k -> F.arrayNode()).add(agreement(person, a, false));
                }
                JsonNode empty = person.get("schemesWithoutHistory");
                if (empty != null && empty.isArray()) {
                    empty.forEach(e -> grouped.putIfAbsent(e.asText(), F.arrayNode()));
                }
                ArrayNode histories = out.putArray("histories");
                grouped.forEach((scheme, rows) -> {
                    ObjectNode h = histories.addObject().put("schemeId", scheme);
                    h.set("entries", rows);
                });
            }
            JsonNode entitlements = person.get("entitlements");
            if (entitlements != null && entitlements.isArray()) {
                ArrayNode slots = out.putArray("slots");
                for (JsonNode e : entitlements) {
                    ObjectNode slot = slots.addObject();
                    slot.set("employeeId", person.get("personnelNumber"));
                    copy(slot, "entitlementSlotId", e, "slot");
                    copy(slot, "capacity", e, "capacity");
                    copy(slot, "employeeCapacity", e, "employeeCapacity");
                    slot.set("runId", extract.get("run"));
                    copy(slot, "version", e, "version");
                    copy(slot, "createdAt", e, "createdAt");
                    copy(slot, "updatedAt", e, "updatedAt");
                    copy(slot, "contractId", e, "contract");
                    copy(slot, "renewalId", e, "renewal");
                    copy(slot, "state", e, "state");
                }
            }
            return out;
        });
    }

    @Override
    public SourceResult readDrivers(AccountScope scope) {
        return read(scope.environmentId(), scope.runId(), scope.employeeId(), (extract, person) -> {
            ObjectNode out = base(extract, person);
            JsonNode holders = person.get("licenceHolders");
            if (holders != null && holders.isArray()) {
                ArrayNode drivers = out.putArray("drivers");
                for (JsonNode h : holders) {
                    ObjectNode d = drivers.addObject();
                    copy(d, "driverId", h, "id");
                    d.set("employeeId", person.get("personnelNumber"));
                    copy(d, "name", h, "name");
                    copy(d, "kind", h, "kind");
                    copy(d, "relationship", h, "relationship");
                    copy(d, "eligible", h, "eligible");
                    JsonNode l = h.get("licence");
                    if (l != null && l.isObject()) {
                        ObjectNode licence = d.putObject("licence");
                        copy(licence, "displayNumber", l, "number");
                        copy(licence, "categories", l, "classes");
                        copy(licence, "validFrom", l, "from");
                        copy(licence, "validUntil", l, "to");
                        provenance(licence, "source", l.get("provenance"));
                    }
                }
            }
            copy(out, "employeeFacts", person, "facts");
            return out;
        });
    }

    private SourceResult read(String environmentId, String runId, String employeeId,
            BiFunction<JsonNode, JsonNode, ObjectNode> mapper) {
        JsonNode root;
        try {
            root = load(path);
        } catch (SnapshotException e) {
            return SourceResult.unavailable("hr-snapshot-unreadable");
        }
        JsonNode extract = root.get("extract");
        if (!extract.get("environment").textValue().equals(environmentId)
                || !extract.get("run").textValue().equals(runId)) {
            return SourceResult.unavailable("hr-snapshot-scope");
        }
        JsonNode found = null;
        for (JsonNode p : root.get("people")) {
            if (p.isObject() && text(p.get("personnelNumber")) && p.get("personnelNumber").textValue().equals(employeeId)) {
                if (found != null) return SourceResult.invalid("hr-snapshot-duplicate-person");
                found = p;
            }
        }
        if (found == null) return SourceResult.notFound();
        try {
            return SourceResult.ok(mapper.apply(extract, found));
        } catch (RuntimeException e) {
            return SourceResult.invalid("hr-snapshot-malformed");
        }
    }

    private static ObjectNode base(JsonNode extract, JsonNode person) {
        ObjectNode out = F.objectNode();
        out.set("runId", extract.get("run"));
        out.set("environmentId", extract.get("environment"));
        out.set("employeeId", person.get("personnelNumber"));
        copy(out, "recordSetId", person, "recordSet");
        provenance(out, "source", person.get("provenance"));
        copy(out, "repositoryVersion", person, "recordVersion");
        return out;
    }

    /** An open contract takes its collection window from renewalWindow when HR publishes one. */
    private static ObjectNode agreement(JsonNode person, JsonNode a, boolean contract) {
        ObjectNode out = F.objectNode();
        copy(out, "contractId", a, "id");
        out.set("employeeId", person.get("personnelNumber"));
        copy(out, "schemeId", a, "scheme");
        copy(out, "slotId", a, "slot");
        copy(out, "driverId", a, "driver");
        copy(out, "status", a, "state");
        copy(out, "model", a, "model");
        copy(out, "media", a, "media");
        copy(out, "vehicle", a, "vehicle");
        JsonNode dates = a.get("dates");
        copy(out, "actualCollectionDate", dates, "collected");
        copy(out, "contractEndDate", dates, "ends");
        copy(out, "returnedDate", dates, "returned");
        copy(out, "earliestCollectionDate", dates, "earliest");
        copy(out, "latestCollectionDate", dates, "latest");
        JsonNode mileage = a.get("mileage");
        copy(out, "annualMileage", mileage, "annual");
        copy(out, "mileageUnit", mileage, "unit");
        copy(out, "months", mileage, "months");
        copy(out, "currentOdometer", mileage, "odometer");
        provenance(out, "source", a.get("provenance"));
        JsonNode window = contract ? a.get("renewalWindow") : null;
        if (window != null && window.isObject()) {
            copy(out, "earliestCollectionDate", window, "earliest");
            copy(out, "latestCollectionDate", window, "latest");
        }
        return out;
    }

    private static void provenance(ObjectNode to, String key, JsonNode p) {
        if (p == null || !p.isObject()) return;
        ObjectNode source = to.putObject(key);
        PROVENANCE.forEach((from, target) -> copy(source, target, p, from));
    }

    /** Copies a field when the export has it (null included); an absent field stays absent. */
    private static void copy(ObjectNode to, String toKey, JsonNode from, String fromKey) {
        if (from != null && from.isObject() && from.has(fromKey)) to.set(toKey, from.get(fromKey));
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual();
    }

    private static String text(JsonNode n, String key) {
        JsonNode v = n.get(key);
        return text(v) ? v.textValue() : null;
    }
}
