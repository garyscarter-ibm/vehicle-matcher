package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.BoundedVehicleRead.Response;
import gcsp.api.evidence.OfflineCardReader.OfflineResponse;
import gcsp.api.evidence.StockPort.StockClassification;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** Finite provider reads, server-owned routing and the absence of any network capability. */
class BoundedReadAndRoutingTest {

    private static final JsonNode FIXTURE = ProviderCases.ALTERNATE_FIXTURE;
    private static final EvidenceContext CONTEXT = EvidenceContext.fromJson(FIXTURE.get("context"));
    private static final String CONFIG = FIXTURE.get("entries").get(0).get("key").get("token").textValue();
    private static final String OTHER_CONFIG = FIXTURE.get("entries").get(1).get("key").get("token").textValue();
    private static final String VIN = "WBA33DB08TC426611";
    private static final EvidenceRequest CONFIG_REQUEST = new EvidenceRequest("configuration", CONFIG, null);

    private static VehicleRouting allow(String configurationId, String vehicleId) {
        return new VehicleRouting((req, ctx) -> new VehicleRouting.Classified("ok", "synthetic", false, configurationId, vehicleId),
                "alternate-offline");
    }

    @Test
    void aReadPastItsDeadlineIsCancelledAndRetriedThenUnavailable() {
        AtomicInteger attempts = new AtomicInteger();
        AtomicInteger cancelled = new AtomicInteger();
        BoundedVehicleRead read = new BoundedVehicleRead("offline", 5, 2, (request, context, signal) -> {
            attempts.incrementAndGet();
            try {
                Thread.sleep(60_000);
            } catch (InterruptedException e) {
                cancelled.incrementAndGet();
                throw e;
            }
            return new Response(200, null);
        });
        long started = System.nanoTime();
        ObjectNode result = new VehicleDetailsConsumer(read).resolve(CONFIG_REQUEST, CONTEXT);
        long millis = (System.nanoTime() - started) / 1_000_000;
        assertEquals("source-unavailable", result.get("status").textValue());
        assertEquals(2, result.get("transport").get("attempts").intValue());
        assertEquals("unavailable", result.get("transport").get("outcome").textValue());
        assertTrue(result.get("transport").get("status").isNull());
        assertEquals("offline", result.get("transport").get("protocol").textValue());
        assertEquals(2, attempts.get());
        assertTrue(millis < 900, "took " + millis + " ms");
        long deadline = System.nanoTime() + 2_000_000_000L;
        while (cancelled.get() < 2 && System.nanoTime() < deadline) Thread.onSpinWait();
        assertEquals(2, cancelled.get(), "each attempt is interrupted");
    }

    @Test
    void anAttemptThatIgnoresInterruptionStillSeesTheAbortSignal() throws Exception {
        AtomicInteger sawAbort = new AtomicInteger();
        BoundedVehicleRead read = new BoundedVehicleRead("in-process", 5, 1, (request, context, signal) -> {
            long end = System.nanoTime() + 300_000_000L;
            while (System.nanoTime() < end) if (signal.aborted()) {
                sawAbort.incrementAndGet();
                break;
            }
            return new Response(null, null);
        });
        assertEquals("source-unavailable", new VehicleDetailsConsumer(read).resolve(CONFIG_REQUEST, CONTEXT).get("status").textValue());
        Thread.sleep(50);
        assertEquals(1, sawAbort.get());
    }

    @Test
    void aFailedTransportStatusIsRetriedThenUnavailableWithTheStatusKept() {
        AtomicInteger attempts = new AtomicInteger();
        OfflineCardReader reader = (category, token, ctx) -> {
            attempts.incrementAndGet();
            return new OfflineResponse(503, FIXTURE.get("entries").get(0).get("document"));
        };
        ObjectNode result = new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader, allow(CONFIG, null), 1000, 2))
                .resolve(CONFIG_REQUEST, CONTEXT);
        assertEquals("source-unavailable", result.get("status").textValue());
        assertEquals(503, result.get("transport").get("status").intValue());
        assertEquals(2, result.get("transport").get("attempts").intValue());
        assertEquals(2, attempts.get());
        for (int status : new int[] {301, 302, 404}) {
            attempts.set(0);
            OfflineCardReader redirecting = (category, token, ctx) -> {
                attempts.incrementAndGet();
                return new OfflineResponse(status, null);
            };
            assertEquals("source-unavailable", new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(redirecting, allow(CONFIG, null), 1000, 2))
                    .resolve(CONFIG_REQUEST, CONTEXT).get("status").textValue());
            assertEquals(2, attempts.get());
        }
    }

    @Test
    void aReaderThatThrowsIsUnavailableAndInvalidBoundsAreRejected() {
        OfflineCardReader broken = (category, token, ctx) -> {
            throw new IOException("disk gone");
        };
        ObjectNode result = new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(broken, allow(CONFIG, null), 1000, 2))
                .resolve(CONFIG_REQUEST, CONTEXT);
        assertEquals("source-unavailable", result.get("status").textValue());
        assertEquals(2, result.get("transport").get("attempts").intValue());
        BoundedVehicleRead.Attempt attempt = (request, context, signal) -> new Response(null, null);
        for (int[] bounds : new int[][] {{0, 1}, {5001, 1}, {1000, 0}, {1000, 3}, {-1, 1}}) {
            assertThrows(IllegalArgumentException.class, () -> new BoundedVehicleRead("offline", bounds[0], bounds[1], attempt));
        }
        assertThrows(IllegalArgumentException.class, () -> new BoundedVehicleRead("live", 1000, 1, attempt));
        assertThrows(IllegalArgumentException.class, () -> new BoundedVehicleRead("offline", 1000, 1, null));
        assertThrows(IllegalArgumentException.class, () -> new LookupVehicleAdapter(null, null, 0, 1));
        assertThrows(IllegalArgumentException.class, () -> new AlternateOfflineVehicleAdapter(null, null, 1000, 3));
        for (String provider : new String[] {"live", "bmw", "https://example.invalid/", null}) {
            assertThrows(IllegalArgumentException.class, () -> new VehicleRouting((CorpusStore) null, null, provider));
            assertThrows(IllegalArgumentException.class, () -> VehicleDetailsConsumer.configured(provider, null, null, null, 1000, 1));
        }
    }

    @Test
    void anUnknownConfigurationOrVinNeverReachesTheProviderRead() {
        CorpusStore store = LookupCases.store("lookup-reference.v1");
        AtomicInteger reads = new AtomicInteger();
        OfflineCardReader reader = (category, token, ctx) -> {
            reads.incrementAndGet();
            return new OfflineResponse(200, FIXTURE.get("entries").get(0).get("document"));
        };
        VehicleDetailsConsumer consumer = new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader,
                new VehicleRouting(store, null, "alternate-offline"), 1000, 2));
        for (EvidenceRequest request : List.of(new EvidenceRequest("vin", "ZZZZZZZZ0ZZ000000", null),
                new EvidenceRequest("configuration", java.util.Base64.getEncoder().encodeToString("UNKNOWN:CODE".getBytes()), null))) {
            ObjectNode result = consumer.resolve(request, CONTEXT);
            assertEquals("not-found", result.get("status").textValue());
            assertEquals(1, result.get("transport").get("attempts").intValue());
        }
        assertEquals(0, reads.get());
        assertEquals("partial", consumer.resolve(new EvidenceRequest("configuration", CONFIG, null), CONTEXT).get("status").textValue());
        assertEquals(1, reads.get(), "the known configuration reads once and the post-read recheck does not read again");
    }

    @Test
    void aStockClassificationMismatchIsAnIdentityMismatchBeforeAnyRead() {
        CorpusStore store = LookupCases.store("lookup-reference.v1");
        String order = FIXTURE.get("entries").get(3).get("key").get("token").textValue();
        AtomicInteger reads = new AtomicInteger();
        OfflineCardReader reader = (category, token, ctx) -> {
            reads.incrementAndGet();
            return new OfflineResponse(200, FIXTURE.get("entries").get(3).get("document"));
        };
        JsonNode row = EvidenceFixtures.MAPPER.createObjectNode().put("orderUuid", order);
        for (StockClassification classification : List.of(StockClassification.mismatch(), StockClassification.unavailable(),
                new StockClassification("surprise", null, null))) {
            StockPort stock = ProviderCases.stock(CONTEXT, row, classification);
            ObjectNode result = new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader,
                    new VehicleRouting(store, stock, "alternate-offline"), 1000, 1)).resolve(new EvidenceRequest("stock", order, null), CONTEXT);
            assertEquals(classification.status().equals("identity-mismatch") ? "identity-mismatch" : "source-unavailable",
                    result.get("status").textValue(), classification.status());
        }
        StockPort missing = ProviderCases.stock(CONTEXT, row, StockClassification.notFound());
        assertEquals("not-found", new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader,
                new VehicleRouting(store, missing, "alternate-offline"), 1000, 1)).resolve(new EvidenceRequest("stock", order, null), CONTEXT)
                .get("status").textValue());
        assertEquals(0, reads.get());
        // A stock id under another run is a mismatch, and a stock request with no port is unavailable.
        EvidenceContext old = new EvidenceContext("old-run", CONTEXT.environmentId(), CONTEXT.principalId(), CONTEXT.roles());
        assertEquals("identity-mismatch", new VehicleRouting(store, ProviderCases.stock(CONTEXT, row, StockClassification.notFound()), "lookup")
                .route(new EvidenceRequest("stock", order, null), old).denial());
        assertEquals("source-unavailable", new VehicleRouting(store, null, "lookup").route(new EvidenceRequest("stock", order, null), CONTEXT).denial());
        assertEquals(0, reads.get());
    }

    @Test
    void aProviderAnswerWhoseIdentityDiffersFromTheBindingIsAnIdentityMismatch() {
        JsonNode document = FIXTURE.get("entries").get(2).get("document");
        OfflineCardReader reader = (category, token, ctx) -> new OfflineResponse(200, document);
        EvidenceRequest request = new EvidenceRequest("vin", VIN, null);
        assertEquals("partial", run(reader, allow(document.get("card").get("identifiers").get("composition").textValue(), "reference-vehicle-1"), request));
        assertEquals("identity-mismatch", run(reader, allow(OTHER_CONFIG, "reference-vehicle-1"), request));
        assertEquals("identity-mismatch", run(reader, allow(document.get("card").get("identifiers").get("composition").textValue(), "another-vehicle"), request));
        VehicleRouting live = new VehicleRouting((req, ctx) -> new VehicleRouting.Classified("ok", "synthetic", true, CONFIG, null), "lookup");
        assertEquals("source-unavailable", live.route(request, CONTEXT).denial());
        VehicleRouting real = new VehicleRouting((req, ctx) -> new VehicleRouting.Classified("ok", "real", false, CONFIG, null), "lookup");
        assertEquals("source-unavailable", real.route(request, CONTEXT).denial());
        assertEquals("source-unavailable", new VehicleRouting((req, ctx) -> {
            throw new IllegalStateException("boom");
        }, "lookup").route(request, CONTEXT).denial());
        assertEquals("source-unavailable", new VehicleRouting((VehicleRouting.Classifier) null, "lookup").route(request, CONTEXT).denial());
    }

    private static String run(OfflineCardReader reader, VehicleRouting route, EvidenceRequest request) {
        return new VehicleDetailsConsumer(new AlternateOfflineVehicleAdapter(reader, route, 1000, 1)).resolve(request, CONTEXT)
                .get("status").textValue();
    }

    @Test
    void noMainSourceUsesAnyNetworkApi() throws IOException {
        Path root = EvidenceFixtures.MODULE.resolve("src/main/java/gcsp/api/evidence");
        List<String> banned = List.of("HttpClient", "HttpURLConnection", "URLConnection", "java.net.Socket", "ServerSocket",
                "DatagramSocket", "SocketChannel", "java.net.http", ".openConnection", ".openStream", "InetAddress",
                "javax.net", "WebClient", "RestClient");
        try (Stream<Path> files = Files.walk(root)) {
            for (Path file : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator) {
                String text = Files.readString(file);
                for (String word : banned) assertFalse(text.contains(word), file.getFileName() + " mentions " + word);
                assertFalse(text.matches("(?s).*\\bjava\\.net\\.(?!IDN;).*"), file.getFileName() + " uses java.net");
            }
        }
    }
}
