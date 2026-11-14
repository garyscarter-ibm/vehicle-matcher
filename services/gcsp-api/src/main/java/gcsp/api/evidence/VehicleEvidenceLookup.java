package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import gcsp.api.evidence.StockPort.RunLookup;
import gcsp.api.evidence.StockPort.StockRead;
import gcsp.api.evidence.StockPort.StockRecord;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Read-only same-process lookup ported from Node vehicle-lookup.js; failures never reflect the input id. */
public final class VehicleEvidenceLookup implements VehicleLookupPort {

    private static final List<String> ALLOWED_PINS =
            List.of("configurationId", "market", "bodyType", "profileId", "snapshotVersion");
    private static final Pattern ORDER_NUMBER = Pattern.compile("\\d{7}");

    private final EvidenceRegistry registry;
    private final StockPort stock;

    /** A null registry or stock port is an unconfigured source and yields source-unavailable. */
    public VehicleEvidenceLookup(EvidenceRegistry registry, StockPort stock) {
        this.registry = registry;
        this.stock = stock;
    }

    /** The exact Node result object; every call returns a fresh tree the caller may mutate. */
    @Override
    public ObjectNode resolve(EvidenceRequest request, EvidenceContext context) {
        String kind = request == null ? null : request.kind();
        if (request == null || !requestValid(request)) return EvidenceFailures.failure("invalid-input", kind);
        String id = VehicleIdentifiers.canonical(kind, request.id());
        if (id == null) return EvidenceFailures.failure("invalid-input", kind);
        try {
            if (registry == null) return EvidenceFailures.failure("source-unavailable", kind);
            StockRecord stockRecord = null;
            EvidenceSource source;
            if ("stock".equals(kind)) {
                if (stock == null || context == null || !context.trusted()) {
                    return EvidenceFailures.failure("source-unavailable", kind);
                }
                RunLookup current = stock.currentRun(context.environmentId());
                if (current == null || !"ok".equals(current.status())) return EvidenceFailures.failure("source-unavailable", kind);
                if (!context.runId().equals(current.runId())) return EvidenceFailures.failure("identity-mismatch", kind);
                StockRead found = stock.read(context, id);
                if (found == null || !"ok".equals(found.status())) return sourceFailure(found == null ? null : found.status(), kind);
                stockRecord = found.record();
                JsonNode association = stockRecord == null ? null : VehicleDetails.stockSyntheticIdentity(stockRecord);
                if (stockRecord == null || !id.equals(stockRecord.orderUuid()) || !context.runId().equals(stockRecord.runId())
                        || !Js.text(stockRecord.configurationId()) || stockRecord.orderNumber() == null
                        || !ORDER_NUMBER.matcher(stockRecord.orderNumber()).matches()
                        || !Js.is(Js.field(association, "identityKind"), "synthetic")
                        || !Js.text(Js.field(association, "vehicleId"))
                        || !Js.text(Js.field(association, "originatingDatasetId"))) {
                    return EvidenceFailures.failure("identity-mismatch", kind);
                }
                source = registry.getConfiguration(stockRecord.configurationId());
                // A known stock row whose configuration is absent has a broken association, not an unknown order UUID.
                if (source != null && "not-found".equals(source.status())) return EvidenceFailures.failure("identity-mismatch", kind);
                if (!accepted(source)) return sourceFailure(source == null ? null : source.status(), kind);
                if (!VehicleDetails.validSource(source)) return EvidenceFailures.failure("source-unavailable", kind);
                if (!bindingMatches(association, stockRecord.configurationId(), source.record())) {
                    return EvidenceFailures.failure("identity-mismatch", kind);
                }
                // A reset may race the read; never return a previous run's stock as the new run's stock.
                RunLookup still = stock.currentRun(context.environmentId());
                if (still == null || !"ok".equals(still.status())) return EvidenceFailures.failure("source-unavailable", kind);
                if (!context.runId().equals(still.runId())) return EvidenceFailures.failure("identity-mismatch", kind);
            } else {
                source = "vin".equals(kind) ? registry.getVin(id) : registry.getConfiguration(id);
                if (!accepted(source)) return sourceFailure(source == null ? null : source.status(), kind);
                if (!VehicleDetails.validSource(source)) return EvidenceFailures.failure("source-unavailable", kind);
                JsonNode record = source.record();
                if ("configuration".equals(kind) && !Js.is(record.get("configurationId"), id)) {
                    return EvidenceFailures.failure("identity-mismatch", kind);
                }
                if ("vin".equals(kind)) {
                    JsonNode vehicle = source.vehicle();
                    JsonNode usage = Js.field(vehicle, "usage");
                    if (!Js.isObject(vehicle) || !Js.is(vehicle.get("vin17"), id)
                            || !Js.is(vehicle.get("identityKind"), "synthetic")
                            || !(Js.is(usage, "current-car") || Js.is(usage, "delivered-car"))
                            || !bindingMatches(vehicle, Js.field(vehicle, "configurationId") == null ? null
                                    : vehicle.get("configurationId").textValue(), record)) {
                        return EvidenceFailures.failure("identity-mismatch", kind);
                    }
                }
            }
            if (!expectedMatches(request.expected(), source)) return EvidenceFailures.failure("identity-mismatch", kind);
            JsonNode catalogueStatus = Js.field(Js.field(source.record(), "catalogue"), "status");
            if (Js.is(catalogueStatus, "unsupported")) return EvidenceFailures.failure("unsupported", kind);
            if (Js.is(catalogueStatus, "identity-mismatch")) return EvidenceFailures.failure("identity-mismatch", kind);
            return VehicleDetails.details(kind, id, source, stockRecord);
        } catch (RuntimeException e) {
            return EvidenceFailures.failure("source-unavailable", kind);
        }
    }

    private static boolean requestValid(EvidenceRequest request) {
        if (request.malformed()) return false;
        Map<String, String> expected = request.expected();
        if (expected == null) return true;
        for (Map.Entry<String, String> pin : expected.entrySet()) {
            if (!ALLOWED_PINS.contains(pin.getKey()) || !Js.text(pin.getValue())) return false;
        }
        return true;
    }

    private static boolean accepted(EvidenceSource source) {
        return source != null && ("ok".equals(source.status()) || "complete".equals(source.status())
                || "partial".equals(source.status()));
    }

    private static ObjectNode sourceFailure(String status, String kind) {
        boolean known = List.of("invalid-input", "not-found", "unsupported", "identity-mismatch").contains(status);
        return EvidenceFailures.failure(known ? status : "source-unavailable", kind);
    }

    private static boolean bindingMatches(JsonNode identity, String configurationId, JsonNode record) {
        return configurationId != null && Js.is(record.get("configurationId"), configurationId)
                && Js.strictEquals(Js.field(identity, "snapshotVersion"), record.get("snapshotVersion"))
                && Js.strictEquals(Js.field(identity, "configurationHash"),
                        TextNode.valueOf(CanonicalJson.digest(record.get("configuration"))));
    }

    private static boolean expectedMatches(Map<String, String> expected, EvidenceSource source) {
        if (expected == null) return true;
        JsonNode record = source.record();
        for (Map.Entry<String, String> pin : expected.entrySet()) {
            JsonNode actual = switch (pin.getKey()) {
                case "configurationId" -> record.get("configurationId");
                case "market" -> record.get("configuration").get("market");
                case "bodyType" -> record.get("configuration").get("body");
                case "profileId" -> Js.field(Js.field(source.vehicle(), "profile"), "profileId");
                case "snapshotVersion" -> record.get("snapshotVersion");
                default -> null;
            };
            if (!Js.is(actual, pin.getValue())) return false;
        }
        return true;
    }
}
