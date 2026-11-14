package gcsp.api.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CorpusResults.ConfigurationResult;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Integrity decisions that need a modified copy of the small reference store. */
class CorpusStoreIntegrityTest {

    private static final String C1F8 = "c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709";
    private static final String CONFIG = "UkVGMTpSRUZFUkVOQ0U=";

    @TempDir
    Path temp;
    Path store;
    Path version;

    @BeforeEach
    void copyReference() throws IOException {
        store = temp.resolve("store");
        EvidenceFixtures.copyTree(EvidenceFixtures.required(EvidenceFixtures.RESOURCES.resolve("stores/ok-copy")), store);
        version = store.resolve("versions").resolve(C1F8);
    }

    private static String code(LoadOutcome outcome) {
        return outcome.failure() == null ? null : outcome.failure().code();
    }

    private String loadCause() {
        LoadOutcome outcome = new CorpusStore(store).load();
        assertEquals("source-unavailable", outcome.status());
        assertEquals("selected-corpus-invalid", code(outcome));
        return outcome.failure().cause();
    }

    /** Rewrites one JSONL file and, unless told not to, its manifest checksum, so later checks are reached. */
    private void rewrite(String file, UnaryOperator<String> change, boolean updateChecksum) throws IOException {
        Path path = version.resolve(file);
        String text = change.apply(Files.readString(path));
        Files.writeString(path, text);
        if (updateChecksum) manifest(m -> ((ObjectNode) m.get("checksums"))
                .put(file, CanonicalJson.sha256Hex(text.getBytes(StandardCharsets.UTF_8))));
    }

    private void manifest(java.util.function.Consumer<ObjectNode> change) throws IOException {
        ObjectNode manifest = (ObjectNode) EvidenceFixtures.MAPPER.readTree(Files.readAllBytes(version.resolve("manifest.json")));
        change.accept(manifest);
        Files.writeString(version.resolve("manifest.json"), CanonicalJson.content(manifest));
    }

    @Test
    void rowTamperAfterLoadIsNeverServed() throws IOException {
        CorpusStore corpus = new CorpusStore(store);
        assertEquals("ok", corpus.load().status());
        assertEquals("partial", corpus.getConfiguration(CONFIG).status());
        Path file = version.resolve("configurations.jsonl");
        byte[] bytes = Files.readAllBytes(file);
        int at = new String(bytes, StandardCharsets.UTF_8).indexOf("2026-11-01");
        bytes[at + 9] = '2';
        Files.write(file, bytes);
        ConfigurationResult result = corpus.getConfiguration(CONFIG);
        assertEquals("source-unavailable", result.status());
        assertEquals("indexed-corpus-changed", result.failure().code());
        assertNull(result.record());
        var vin = corpus.getVin("WBA33DB08TC426611");
        assertEquals("source-unavailable", vin.status());
        assertEquals("indexed-corpus-changed", vin.failure().code());
        assertNull(vin.vehicle());
    }

    @Test
    void truncatedFileAfterLoadIsNeverServed() throws IOException {
        CorpusStore corpus = new CorpusStore(store);
        corpus.load();
        try (var channel = java.nio.channels.FileChannel.open(version.resolve("configurations.jsonl"), StandardOpenOption.WRITE)) {
            channel.truncate(100);
        }
        assertEquals("indexed-corpus-changed", corpus.getConfiguration(CONFIG).failure().code());
    }

    @Test
    void returnedRowsAreDetachedCopies() {
        CorpusStore corpus = new CorpusStore(store);
        corpus.load();
        ((ObjectNode) corpus.getConfiguration(CONFIG).record()).put("mutated", true);
        assertNull(corpus.getConfiguration(CONFIG).record().get("mutated"));
        ((ObjectNode) corpus.status().active().counts()).put("mutated", true);
        assertNull(corpus.status().active().counts().get("mutated"));
    }

    @Test
    void manifestBytesChangeBreaksTheDirectoryIdentity() throws IOException {
        manifest(m -> m.put("note", "x"));
        assertEquals("manifest-digest-mismatch", loadCause());
    }

    @Test
    void manifestWithWrongSchemaVersionOrChecksumShapeIsRejected() throws IOException {
        manifest(m -> m.put("schemaVersion", "3"));
        assertEquals("manifest-schema", loadCause());
    }

    @Test
    void manifestMissingAChecksumIsRejected() throws IOException {
        manifest(m -> ((ObjectNode) m.get("checksums")).remove("images.jsonl"));
        assertEquals("manifest-schema", loadCause());
    }

    @Test
    void manifestMalformedIsRejected() throws IOException {
        Files.writeString(version.resolve("manifest.json"), "{not json");
        assertEquals("manifest-schema", loadCause());
    }

    @Test
    void countMismatchIsRejected() throws IOException {
        manifest(m -> ((ObjectNode) m.get("counts")).put("vinMappings", 2));
        assertEquals("count-mismatch", loadCause());
    }

    @Test
    void vinReferencingAMissingConfigurationIsRejected() throws IOException {
        rewrite("vins.jsonl", t -> t.replace("\"configurationId\":\"" + CONFIG + "\"", "\"configurationId\":\"nope\""), true);
        assertEquals("dangling-configuration", loadCause());
    }

    @Test
    void vin7NotMatchingVin17IsRejected() throws IOException {
        rewrite("vins.jsonl", t -> t.replace("\"vin7\":\"C426611\"", "\"vin7\":\"C426612\""), true);
        assertEquals("vin-schema", loadCause());
    }

    @Test
    void duplicateConfigurationKeysAreRejected() throws IOException {
        rewrite("configurations.jsonl", t -> {
            String first = t.substring(0, t.indexOf('\n') + 1);
            return first + t;
        }, true);
        manifest(m -> ((ObjectNode) m.get("counts")).put("configurations", 3));
        assertEquals("duplicate-configuration", loadCause());
    }

    @Test
    void missingTrailingNewlineIsTruncatedJsonl() throws IOException {
        rewrite("vins.jsonl", t -> t.substring(0, t.length() - 1), true);
        assertEquals("truncated-jsonl", loadCause());
    }

    @Test
    void invalidUtf8IsMalformedJsonl() throws IOException {
        Path path = version.resolve("images.jsonl");
        Files.write(path, new byte[] {'{', '"', 'a', '"', ':', '"', (byte) 0xC3, (byte) 0x28, '"', '}', '\n'});
        String sum = CanonicalJson.sha256Hex(Files.readAllBytes(path));
        manifest(m -> ((ObjectNode) m.get("checksums")).put("images.jsonl", sum));
        assertEquals("malformed-jsonl", loadCause());
    }

    @Test
    void nonObjectRowIsRejected() throws IOException {
        Path path = version.resolve("images.jsonl");
        Files.writeString(path, "[1]\n");
        String sum = CanonicalJson.sha256Hex(Files.readAllBytes(path));
        manifest(m -> ((ObjectNode) m.get("checksums")).put("images.jsonl", sum));
        assertEquals("artifact-schema", loadCause());
    }

    @Test
    void rowOverOneMebibyteIsRejected() throws IOException {
        Path path = version.resolve("images.jsonl");
        Files.writeString(path, "{\"x\":\"" + "a".repeat(1024 * 1024) + "\"}\n");
        assertEquals("artifact-row-size", loadCause());
    }

    @Test
    void fileOverTheConfiguredLimitIsRejectedAndTheCapIsEnforced() {
        CorpusStore small = new CorpusStore(store, 1000);
        assertEquals("artifact-size", small.load().failure().cause());
        assertThrows(IllegalArgumentException.class, () -> new CorpusStore(store, 256L * 1024 * 1024 + 1));
        assertThrows(IllegalArgumentException.class, () -> new CorpusStore(Path.of("relative")));
        assertNotNull(new CorpusStore(store, 256L * 1024 * 1024));
    }

    @Test
    void historyThatLacksTheSelectedRowsRefusesAndRecoveryNeedsAValidPrevious() throws IOException {
        LoadOutcome outcome = new CorpusStore(EvidenceFixtures.RESOURCES.resolve("stores/not-in-history")).load();
        assertEquals("selection-history-mismatch", code(outcome));
        assertTrue(outcome.failure().historyChanged());
        assertNull(outcome.active());
    }

    @Test
    void activePointerWithAnInvalidSelectionFallsBackToPrevious() throws IOException {
        Files.writeString(store.resolve("active.json"), CanonicalJson.content(EvidenceFixtures.MAPPER.readTree(
                "{\"schemaVersion\":\"1\",\"selected\":{\"directory\":\"x\",\"manifestDigest\":\"x\"},"
                        + "\"previous\":{\"directory\":\"" + C1F8 + "\",\"manifestDigest\":\"" + C1F8 + "\"}}")));
        LoadOutcome outcome = new CorpusStore(store).load();
        assertTrue(outcome.recovered());
        assertEquals("selection-invalid", code(outcome));
        assertEquals(C1F8, outcome.active().manifestDigest());
    }

    @Test
    void emptyStoreHasAnEmptyHistoryButNoCorpus() throws IOException {
        Path empty = Files.createDirectory(temp.resolve("empty"));
        CorpusStore corpus = new CorpusStore(empty);
        assertEquals("corpus-absent", code(corpus.load()));
        assertEquals("not-found", corpus.classifyIdentity("WBA33DB08TC426611").status());
        assertEquals("source-unavailable", corpus.getConfiguration(CONFIG).status());
        assertEquals("corpus-absent", corpus.getConfiguration(CONFIG).failure().code());
    }

    @Test
    void readsBeforeLoadAreSourceUnavailable() {
        CorpusStore corpus = new CorpusStore(store);
        assertEquals("corpus-absent", corpus.getConfiguration(CONFIG).failure().code());
        assertEquals("corpus-absent", corpus.getVin("WBA33DB08TC426611").failure().code());
        assertEquals("source-unavailable", corpus.classifyIdentity("WBA33DB08TC426611").status());
        assertEquals("source-unavailable", corpus.status().status());
    }

    @Test
    void failedReloadKeepsTheLastCompleteVersionReadable() throws IOException {
        CorpusStore corpus = new CorpusStore(store);
        corpus.load();
        Files.delete(store.resolve("identity-inventory.json"));
        LoadOutcome outcome = corpus.load();
        assertEquals("identity-inventory-unavailable", code(outcome));
        assertEquals("ok", corpus.status().status());
        assertEquals("partial", corpus.getConfiguration(CONFIG).status());
    }

    @Test
    void duplicateKeysTakeTheLastValueAndTrailingTokensFail() throws IOException {
        JsonNode parsed = StrictJson.parse("{\"a\":1,\"a\":2}".getBytes(StandardCharsets.UTF_8), 13);
        assertEquals(2, parsed.get("a").asInt());
        assertThrows(IOException.class, () -> StrictJson.parse("{} {}".getBytes(StandardCharsets.UTF_8), 5));
    }
}
