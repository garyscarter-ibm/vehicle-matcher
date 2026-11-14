package gcsp.api.evidence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/** One streaming pass keeps offsets, digests and metadata; get() re-reads a row and re-checks its sha256. */
final class IndexedJsonl {

    static final long DEFAULT_MAX_BYTES = 64L * 1024 * 1024;
    static final long HARD_CAP_BYTES = 256L * 1024 * 1024;
    static final int MAX_ROW_BYTES = 1024 * 1024;
    static final int MAX_ROWS = 100_000;
    private static final int CHUNK = 64 * 1024;

    /** Compact per-row metadata; fields not meaningful for a file kind are null. */
    record Meta(String key, String configurationId, String vin17, String vin7, String associationDigest,
            List<String> imageIds) {}

    record Entry(Meta meta, long offset, int length, String lineDigest, String recordDigest) {
        String key() {
            return meta.key();
        }
    }

    /** Validates a parsed row and returns its metadata, or throws CorpusException. */
    interface RowHandler {
        Meta accept(JsonNode row);
    }

    private final Path path;
    private final String checksum;
    private final List<Entry> entries;
    private final Map<String, Entry> byKey;
    private final CorpusException deferred;

    private IndexedJsonl(Path path, String checksum, List<Entry> entries, Map<String, Entry> byKey,
            CorpusException deferred) {
        this.path = path;
        this.checksum = checksum;
        this.entries = entries;
        this.byKey = byKey;
        this.deferred = deferred;
    }

    /** Throws the first row-shape or duplicate-key failure; call after the checksum check, as Node orders them. */
    void requireValidRows() {
        if (deferred != null) throw deferred;
    }

    String checksum() {
        return checksum;
    }

    int size() {
        return entries.size();
    }

    List<Entry> entries() {
        return entries;
    }

    Entry entry(String key) {
        return key == null ? null : byKey.get(key);
    }

    /** Row-shape and duplicate-key failures are deferred to requireValidRows(); limits and JSON errors throw at once. */
    static IndexedJsonl index(Path path, long maxBytes, RowHandler handler, String duplicateCode) {
        String name = String.valueOf(path.getFileName());
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            if (!Files.isRegularFile(path) || channel.size() > maxBytes) {
                throw new CorpusException("artifact-size", "Artifact exceeds the bounded streaming file limit.");
            }
            MessageDigest fileHash = CanonicalJson.sha256();
            List<Entry> entries = new ArrayList<>();
            Map<String, Entry> byKey = new HashMap<>();
            ByteBuffer chunk = ByteBuffer.allocate(CHUNK);
            CorpusException[] deferred = new CorpusException[1];
            byte[] line = new byte[8192];
            int lineLength = 0;
            long consumed = 0;
            long total = 0;
            int read;
            while ((read = channel.read(chunk)) > 0) {
                total += read;
                if (total > maxBytes) {
                    throw new CorpusException("artifact-size", "Artifact exceeds the bounded streaming file limit.");
                }
                byte[] data = chunk.array();
                fileHash.update(data, 0, read);
                int start = 0;
                for (int i = 0; i < read; i++) {
                    if (data[i] != '\n') continue;
                    int part = i + 1 - start;
                    line = ensure(line, lineLength, part);
                    System.arraycopy(data, start, line, lineLength, part);
                    lineLength += part;
                    addRow(entries, byKey, line, lineLength, consumed, handler, duplicateCode, name, deferred);
                    consumed += lineLength;
                    lineLength = 0;
                    start = i + 1;
                }
                int rest = read - start;
                if (rest > 0) {
                    line = ensure(line, lineLength, rest);
                    System.arraycopy(data, start, line, lineLength, rest);
                    lineLength += rest;
                    if (lineLength > MAX_ROW_BYTES) {
                        throw new CorpusException("artifact-row-size", "JSONL record exceeds its bounded row limit.");
                    }
                }
                chunk.clear();
            }
            if (lineLength > 0) {
                throw new CorpusException("truncated-jsonl",
                        name + " must end with a newline; interrupted records cannot activate.");
            }
            return new IndexedJsonl(path, HexFormat.of().formatHex(fileHash.digest()), List.copyOf(entries), byKey,
                    deferred[0]);
        } catch (IOException e) {
            throw new CorpusException("artifact-unavailable",
                    "Read the complete candidate from an accessible explicit directory; no version was selected.");
        }
    }

    private static byte[] ensure(byte[] buffer, int used, int extra) {
        if (used + extra <= buffer.length) return buffer;
        if (used + extra > MAX_ROW_BYTES + CHUNK) {
            throw new CorpusException("artifact-row-size", "JSONL record exceeds its bounded row limit.");
        }
        byte[] grown = new byte[Math.max(buffer.length * 2, used + extra)];
        System.arraycopy(buffer, 0, grown, 0, used);
        return grown;
    }

    private static void addRow(List<Entry> entries, Map<String, Entry> byKey, byte[] line, int length, long offset,
            RowHandler handler, String duplicateCode, String name, CorpusException[] deferred) {
        if (length > MAX_ROW_BYTES) {
            throw new CorpusException("artifact-row-size", "JSONL record exceeds its bounded row limit.");
        }
        if (entries.size() >= MAX_ROWS) {
            throw new CorpusException("artifact-row-count", "JSONL record count exceeds its bounded limit.");
        }
        String label = name + ":" + (entries.size() + 1);
        JsonNode row;
        try {
            row = StrictJson.parse(line, length);
        } catch (IOException e) {
            throw new CorpusException("malformed-jsonl", label + " is not a complete UTF-8 JSON object.");
        }
        if (!row.isObject()) throw new CorpusException("artifact-schema", label + " must contain an object.");
        String recordDigest;
        try {
            recordDigest = CanonicalJson.digest(row);
        } catch (IllegalArgumentException e) {
            throw new CorpusException("artifact-unavailable", label + " is not canonical JSON data.");
        }
        Meta meta;
        try {
            meta = handler.accept(row);
            if (byKey.containsKey(meta.key())) {
                throw new CorpusException(duplicateCode, label + " repeats a key already present in the file.");
            }
        } catch (CorpusException e) {
            if (deferred[0] == null) deferred[0] = e;
            return;
        }
        Entry entry = new Entry(meta, offset, length,
                CanonicalJson.sha256Hex(java.util.Arrays.copyOf(line, length)), recordDigest);
        entries.add(entry);
        byKey.put(meta.key(), entry);
    }

    /** Reads one row by position, re-checks its digest and returns a fresh detached tree; null for an unknown key. */
    JsonNode get(String key) {
        Entry entry = entry(key);
        if (entry == null) return null;
        ByteBuffer buffer = ByteBuffer.allocate(entry.length());
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) {
            long position = entry.offset();
            while (buffer.hasRemaining()) {
                int count = channel.read(buffer, position);
                if (count < 0) throw changed("Indexed artifact became incomplete.");
                position += count;
            }
            if (!CanonicalJson.sha256Hex(buffer.array()).equals(entry.lineDigest())) {
                throw changed("Indexed record bytes changed.");
            }
            return StrictJson.parse(buffer.array(), buffer.array().length);
        } catch (CharacterCodingException | JsonProcessingException e) {
            throw changed("Indexed record is not valid JSON.");
        } catch (IOException e) {
            throw changed("Indexed artifact is no longer accessible.");
        }
    }

    private static CorpusException changed(String message) {
        return new CorpusException("artifact-changed", message);
    }
}
