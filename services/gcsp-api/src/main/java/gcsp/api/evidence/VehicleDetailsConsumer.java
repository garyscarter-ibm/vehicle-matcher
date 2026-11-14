package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.VehicleProvider.ProviderResponse;
import gcsp.api.evidence.VehicleProvider.Transport;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** The application-service port: trusted requests in, provider-independent facts or a typed failure out. */
public final class VehicleDetailsConsumer {

    private static final Set<String> FAILURE_STATUSES =
            Set.of("invalid-input", "not-found", "unsupported", "source-unavailable", "identity-mismatch");
    private static final Set<String> EXPECTED = Set.of("configurationId", "vehicleId", "datasetId", "originatingDatasetId",
            "corpusVersion", "snapshotVersion", "profileId", "market", "model", "bodyType", "powertrain", "agModelCode",
            "vgModelCode", "observedDate", "catalogueDate", "productionDate", "registrationDate", "effectDate", "orderDate", "taxDate");
    private static final List<String> PROJECTION = List.of("requested", "resolved", "identity", "versions", "description",
            "technical", "equipment", "images", "source", "completeness", "presentation");
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final VehicleProvider adapter;

    public VehicleDetailsConsumer(VehicleProvider adapter) {
        this.adapter = adapter;
    }

    /** Server-owned construction: a request cannot select a provider or a URL. */
    public static VehicleDetailsConsumer configured(String provider, VehicleLookupPort lookup, OfflineCardReader offline,
            VehicleRouting route, int timeoutMs, int maxAttempts) {
        if ("lookup".equals(provider)) return new VehicleDetailsConsumer(new LookupVehicleAdapter(lookup, route, timeoutMs, maxAttempts));
        if ("alternate-offline".equals(provider)) {
            return new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(offline, route, timeoutMs, maxAttempts));
        }
        throw new IllegalArgumentException("Unsupported configured vehicle provider.");
    }

    /** Returns Node's {contractVersion, status, vehicle, failure, transport}; a fresh tree on every call. */
    public ObjectNode resolve(EvidenceRequest request, EvidenceContext context) {
        String kind = request == null ? null : request.kind();
        String id = request == null ? null : VehicleIdentifiers.canonical(kind, request.id());
        if (request == null || request.malformed() || id == null || !pinsValid(request.expected())) return failure("invalid-input", kind, null);
        EvidenceRequest trusted = new EvidenceRequest(kind, id, request.expected(), false);
        if ("stock".equals(kind) && !trusted(context)) return failure("source-unavailable", kind, null);
        ProviderResponse response;
        try {
            response = adapter == null ? null : adapter.resolve(trusted, context);
        } catch (RuntimeException e) {
            return failure("source-unavailable", kind, null);
        }
        Transport t = response == null ? null : response.transport();
        if (t == null || !("in-process".equals(t.protocol()) || "offline".equals(t.protocol())) || t.attempts() < 1 || t.attempts() > 2
                || !("answered".equals(t.outcome()) || "unavailable".equals(t.outcome()))
                || t.status() != null && (t.status() < 100 || t.status() > 599)) {
            return failure("source-unavailable", kind, null);
        }
        if (!"answered".equals(t.outcome()) || t.status() != null && t.status() != 200) return failure("source-unavailable", kind, t);
        try {
            JsonNode w = response.result();
            if (!Js.isObject(w) || !Js.is(w.get("contractVersion"), EvidenceFailures.VERSION) || !Js.is(w.get("schemaVersion"), "1")) {
                return failure("source-unavailable", kind, t);
            }
            JsonNode status = w.get("status");
            if (status != null && status.isTextual() && FAILURE_STATUSES.contains(status.textValue())) {
                if (!Js.isObject(w.get("failure")) || w.get("identity") == null || !w.get("identity").isNull()
                        || w.get("resolved") == null || !w.get("resolved").isNull()) return failure("source-unavailable", kind, t);
                return failure(status.textValue(), kind, t);
            }
            if (!ContractChecks.validSuccess(w)) return failure("source-unavailable", kind, t);
            if (!ContractChecks.matches(trusted, w)) return failure("identity-mismatch", kind, t);
            ObjectNode out = F.objectNode();
            out.put("contractVersion", EvidenceFailures.VERSION);
            out.set("status", status.deepCopy());
            ObjectNode vehicle = out.putObject("vehicle");
            for (String name : PROJECTION) vehicle.set(name, w.get(name).deepCopy());
            out.putNull("failure");
            out.set("transport", transport(t));
            return out;
        } catch (RuntimeException e) {
            return failure("source-unavailable", kind, t);
        }
    }

    private static boolean pinsValid(Map<String, String> expected) {
        if (expected == null) return true;
        for (Map.Entry<String, String> pin : expected.entrySet()) {
            if (!EXPECTED.contains(pin.getKey()) || !ContractChecks.textOk(pin.getValue())) return false;
        }
        return true;
    }

    private static boolean trusted(EvidenceContext c) {
        return c != null && ContractChecks.textOk(c.runId()) && ContractChecks.textOk(c.environmentId())
                && ContractChecks.textOk(c.principalId()) && c.roles() != null && c.roles().stream().allMatch(ContractChecks::textOk);
    }

    private static ObjectNode transport(Transport t) {
        ObjectNode node = F.objectNode();
        if (t == null) node.putNull("protocol");
        else node.put("protocol", t.protocol());
        if (t == null || t.status() == null) node.putNull("status");
        else node.put("status", t.status());
        node.put("attempts", t == null ? 0 : t.attempts());
        node.put("outcome", t == null ? "unavailable" : t.outcome());
        return node;
    }

    private static ObjectNode failure(String status, String kind, Transport t) {
        ObjectNode out = F.objectNode();
        out.put("contractVersion", EvidenceFailures.VERSION);
        out.put("status", status);
        out.putNull("vehicle");
        out.set("failure", EvidenceFailures.failure(status, kind).get("failure"));
        out.set("transport", transport(t));
        return out;
    }
}
