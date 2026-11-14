package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.OfflineCardReader.OfflineResponse;
import gcsp.api.evidence.StockPort.RunLookup;
import gcsp.api.evidence.StockPort.StockClassification;
import gcsp.api.evidence.StockPort.StockRead;
import gcsp.api.evidence.StockPort.StockRecord;
import gcsp.api.evidence.VehicleProvider.ProviderResponse;
import gcsp.api.evidence.VehicleProvider.Transport;
import gcsp.api.evidence.VehicleRouting.Classified;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

/** Replays the s4 matrix cases against the Java consumer with the doubles Node recorded. */
final class ProviderCases {

    static final Path FIXTURES = EvidenceFixtures.MODULE.resolve("../../server/test/fixtures/gcsp/vehicle-evidence").normalize();
    static final Path ALTERNATE = FIXTURES.resolve("alternate-provider.json");
    static final JsonNode ALTERNATE_FIXTURE = read(ALTERNATE);
    static final JsonNode EMPTY_CASES = read(FIXTURES.resolve("empty-mandatory-elements-cases.json"));

    private ProviderCases() {}

    static JsonNode read(Path path) {
        try {
            return EvidenceFixtures.MAPPER.readTree(Files.readAllBytes(path));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** What the doubles saw while a case ran. */
    static final class Counts {
        final AtomicInteger reads = new AtomicInteger();
    }

    static JsonNode lookupBase(JsonNode matrix, String name) {
        if (name.startsWith("empty")) return EMPTY_CASES.get("cases").get(Integer.parseInt(name.substring(5))).get("direct").deepCopy();
        return matrix.get("bases").get(name).deepCopy();
    }

    static JsonNode document(JsonNode entry) {
        return ALTERNATE_FIXTURE.get("entries").get(entry.get("docBase").intValue()).get("document").deepCopy();
    }

    static ObjectNode run(JsonNode matrix, JsonNode entry, Counts counts) {
        String provider = entry.get("provider").textValue();
        JsonNode request = entry.get("request");
        EvidenceContext context = EvidenceContext.fromJson(entry.get("context"));
        boolean routed = entry.path("route").asBoolean(true);
        JsonNode ops = entry.get("ops");
        VehicleRouting route = routed ? new VehicleRouting(classifier(entry.get("classification")), provider.equals("lookup") ? "lookup" : "alternate-offline") : null;
        VehicleDetailsConsumer consumer;
        if (provider.equals("direct")) {
            JsonNode transport = entry.get("transport");
            JsonNode base = lookupBase(matrix, entry.get("lookupBase").textValue());
            Transport t = new Transport(text(transport.get("protocol")), transport.get("status").isNull() ? null : transport.get("status").intValue(),
                    transport.get("attempts").intValue(), text(transport.get("outcome")));
            consumer = new VehicleDetailsConsumer((trusted, ctx) -> new ProviderResponse(t, base));
        } else if (provider.equals("lookup")) {
            JsonNode base = entry.has("lookupBase") ? lookupBase(matrix, entry.get("lookupBase").textValue()) : entry.get("lookupResult").deepCopy();
            apply(base, ops);
            consumer = new VehicleDetailsConsumer(new LookupVehicleAdapter((req, ctx) -> {
                counts.reads.incrementAndGet();
                return base.deepCopy();
            }, route, 1000, 1));
        } else {
            JsonNode doc = entry.has("docBase") ? document(entry) : entry.get("document").deepCopy();
            if (entry.has("docBase")) apply(doc, ops);
            Integer status = entry.has("transportStatus") ? entry.get("transportStatus").intValue() : null;
            OfflineCardReader reader = (category, token, ctx) -> {
                counts.reads.incrementAndGet();
                return new OfflineResponse(status, doc.deepCopy());
            };
            consumer = new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader, route, 1000, 1));
        }
        return consumer.resolve(EvidenceRequest.fromJson(request), context);
    }

    private static String text(JsonNode node) {
        return node.isTextual() ? node.textValue() : null;
    }

    static VehicleRouting.Classifier classifier(JsonNode classification) {
        return (req, ctx) -> {
            if (classification == null || !classification.isObject()) return null;
            JsonNode live = classification.get("liveEligible");
            boolean liveEligible = !(live != null && live.isBoolean() && !live.booleanValue());
            return new Classified(text(classification.path("status")), text(classification.path("identityKind")), liveEligible,
                    text(classification.path("configurationId")), text(classification.path("vehicleId")));
        };
    }

    static void apply(JsonNode root, JsonNode ops) {
        if (ops == null) return;
        for (JsonNode op : ops) {
            boolean delete = op.has("del");
            String[] parts = (delete ? op.get("del") : op.get("set")).textValue().split("\\.");
            JsonNode node = root;
            for (int i = 0; i < parts.length - 1 && node != null; i++) node = child(node, parts[i]);
            if (node == null || !node.isContainerNode()) continue;
            String last = parts[parts.length - 1];
            JsonNode value = delete ? null : op.get("value");
            if (value != null && value.has("$nan")) value = DoubleNode.valueOf(Double.NaN);
            if (node instanceof ObjectNode object) {
                if (delete) object.remove(last);
                else object.set(last, value.deepCopy());
            } else if (node instanceof ArrayNode array && !delete) {
                array.set(Integer.parseInt(last), value.deepCopy());
            }
        }
    }

    private static JsonNode child(JsonNode node, String key) {
        if (node.isArray()) return node.get(Integer.parseInt(key));
        return node.isObject() ? node.get(key) : null;
    }

    /** A stock port with a fixed current run, one readable order and its inventory classification. */
    static StockPort stock(EvidenceContext context, JsonNode stockRow, StockClassification classification) {
        return new StockPort() {
            @Override
            public RunLookup currentRun(String environmentId) {
                return new RunLookup("ok", context.runId());
            }

            @Override
            public StockRead read(EvidenceContext ctx, String orderUuid) {
                if (!orderUuid.equals(stockRow.get("orderUuid").textValue())) return new StockRead("not-found", null);
                return new StockRead("ok", new StockRecord(stockRow.get("runId").textValue(), orderUuid,
                        stockRow.get("orderNumber").textValue(), stockRow.get("configurationId").textValue(), stockRow.get("facts")));
            }

            @Override
            public StockClassification classify(EvidenceContext ctx, String orderUuid) {
                return orderUuid.equals(stockRow.get("orderUuid").textValue()) ? classification : StockClassification.notFound();
            }
        };
    }
}
