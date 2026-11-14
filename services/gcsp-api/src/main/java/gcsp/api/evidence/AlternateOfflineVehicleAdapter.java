package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.BoundedVehicleRead.Response;
import gcsp.api.evidence.OfflineCardReader.OfflineResponse;
import gcsp.api.evidence.VehicleRouting.Route;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/** An intentionally fictional offline shape (offline-cards/1), not a BMW schema or a live-provider promise. */
public final class AlternateOfflineVehicleAdapter implements VehicleProvider {

    private static final Map<String, String> CATEGORY = Map.of("configuration", "composition", "stock", "order", "vin", "delivered");
    private static final Map<String, String> OUTCOMES = Map.of("missing", "not-found", "unsupported", "unsupported",
            "unavailable", "source-unavailable", "mismatch", "identity-mismatch", "invalid", "invalid-input");
    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    private final BoundedVehicleRead read;

    public AlternateOfflineVehicleAdapter(OfflineCardReader reader, VehicleRouting route, int timeoutMs, int maxAttempts) {
        this.read = new BoundedVehicleRead("offline", timeoutMs, maxAttempts, (request, context, signal) -> {
            Route denied = route == null ? null : route.route(request, context);
            if (denied != null && denied.denied()) return new Response(null, EvidenceFailures.failure(denied.denial(), request.kind()));
            if (signal.aborted()) return new Response(null, EvidenceFailures.failure("source-unavailable", request.kind()));
            OfflineResponse response = reader == null ? null : reader.read(CATEGORY.get(request.kind()), request.id(), context);
            Integer status = response == null ? null : response.transportStatus();
            if (status != null && status != 200) return new Response(status, null);
            try {
                JsonNode result = map(request, context, response == null ? null : response.document(), route);
                return new Response(status, result);
            } catch (RuntimeException | java.io.IOException e) {
                return new Response(status, EvidenceFailures.failure("source-unavailable", request.kind()));
            }
        });
    }

    @Override
    public ProviderResponse resolve(EvidenceRequest trusted, EvidenceContext context) {
        return read.resolve(trusted, context);
    }

    private static JsonNode map(EvidenceRequest request, EvidenceContext context, JsonNode document, VehicleRouting route)
            throws java.io.IOException {
        JsonNode payload = document;
        if (document != null && document.isTextual()) {
            byte[] bytes = document.textValue().getBytes(StandardCharsets.UTF_8);
            payload = StrictJson.parse(bytes, bytes.length);
        }
        if (!Js.truthy(payload) || !Js.is(Js.field(payload, "edition"), "offline-cards/1")) throw new IllegalStateException("Unsupported offline document");
        JsonNode outcome = payload.get("result");
        String key = outcome == null ? "undefined" : Js.coerce(outcome);
        if (OUTCOMES.containsKey(key)) return EvidenceFailures.failure(OUTCOMES.get(key), request.kind());
        if (!(Js.is(outcome, "complete") || Js.is(outcome, "partial"))) throw new IllegalStateException("Invalid offline result");
        JsonNode card = payload.get("card");
        if (!Js.isObject(card)) throw new IllegalStateException("Missing card");
        JsonNode ids = card.get("identifiers");
        if ("stock".equals(request.kind())) {
            JsonNode scope = card.get("scope");
            if (!Js.isObject(scope) || !scope.path("run").isTextual() || !scope.path("environment").isTextual()) {
                throw new IllegalStateException("Missing stock scope");
            }
            if (context == null || !scope.get("run").textValue().equals(context.runId())
                    || !scope.get("environment").textValue().equals(context.environmentId())) {
                return EvidenceFailures.failure("identity-mismatch", request.kind());
            }
        }
        if (ids == null || ids.isNull()) throw new IllegalStateException("Missing identifiers");
        ObjectNode result = F.objectNode();
        result.put("contractVersion", EvidenceFailures.VERSION);
        result.put("schemaVersion", "1");
        result.put("provider", "alternate-offline");
        result.put("providerVersion", "1");
        result.set("status", outcome);
        put(result, "requested", card.get("query"));
        put(result, "resolved", card.get("answer"));
        ObjectNode identity = result.putObject("identity");
        put(identity, "kind", Js.field(ids, "category"));
        put(identity, "identityKind", Js.field(ids, "flavour"));
        put(identity, "configurationId", Js.field(ids, "composition"));
        put(identity, "vehicleId", Js.field(ids, "subject"));
        put(identity, "datasetId", Js.field(ids, "collection"));
        put(identity, "originatingDatasetId", Js.field(ids, "origin"));
        put(identity, "orderUuid", Js.field(ids, "order"));
        put(identity, "orderNumber", Js.field(ids, "displayOrder"));
        put(identity, "vin", Js.field(ids, "chassis"));
        put(identity, "usage", Js.field(ids, "purpose"));
        put(result, "versions", card.get("revisions"));
        put(result, "description", card.get("narrative"));
        JsonNode dimensions = card.get("dimensions");
        if (dimensions == null || !dimensions.isArray()) throw new IllegalStateException("Missing dimensions");
        ObjectNode technical = result.putObject("technical");
        for (JsonNode dimension : dimensions) {
            if (dimension.isNull()) throw new IllegalStateException("Null dimension");
            ObjectNode fact = F.objectNode();
            if (dimension.isObject()) {
                for (Iterator<Map.Entry<String, JsonNode>> it = dimension.fields(); it.hasNext(); ) {
                    Map.Entry<String, JsonNode> field = it.next();
                    if (!List.of("name", "reading", "measure", "meaning").contains(field.getKey())) fact.set(field.getKey(), field.getValue().deepCopy());
                }
            }
            put(fact, "value", Js.field(dimension, "reading"));
            put(fact, "unit", Js.field(dimension, "measure"));
            put(fact, "definition", Js.field(dimension, "meaning"));
            technical.set(Js.coerce(Js.field(dimension, "name")), fact);
        }
        put(result, "equipment", card.get("features"));
        JsonNode portraits = card.get("portraits");
        if (!Js.isObject(portraits) || portraits.get("pictures") == null || !portraits.get("pictures").isArray()) {
            throw new IllegalStateException("Missing portraits");
        }
        ObjectNode images = result.putObject("images");
        put(images, "state", portraits.get("knowledge"));
        put(images, "label", portraits.get("caption"));
        var items = images.putArray("items");
        for (JsonNode picture : portraits.get("pictures")) {
            if (picture.isNull()) throw new IllegalStateException("Null picture");
            ObjectNode item = items.addObject();
            put(item, "imageId", Js.field(picture, "reference"));
            put(item, "asset", Js.field(picture, "resource"));
            put(item, "role", Js.field(picture, "usage"));
            put(item, "fidelity", Js.field(picture, "accuracy"));
            put(item, "sourceKind", Js.field(picture, "origin"));
            put(item, "observedDate", Js.field(picture, "dated"));
            put(item, "label", Js.field(picture, "caption"));
        }
        put(result, "source", card.get("evidence"));
        put(result, "completeness", card.get("coverage"));
        put(result, "presentation", card.get("labels"));
        ObjectNode routing = result.putObject("routing");
        routing.put("mode", "offline");
        routing.put("liveEligible", false);
        result.putNull("failure");
        return route == null ? result : route.routedResult(request, context, result);
    }

    private static void put(ObjectNode target, String name, JsonNode value) {
        if (value != null) target.set(name, value.deepCopy());
    }
}
