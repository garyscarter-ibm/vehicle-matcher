package gcsp.api.evidence;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

/** Locates retained stores, fixture stores and goldens in place; a missing path fails the test. */
final class EvidenceFixtures {

    static final ObjectMapper MAPPER = new ObjectMapper();
    static final Path MODULE = Path.of(System.getProperty("basedir", "")).toAbsolutePath().normalize();
    static final Path RESOURCES = MODULE.resolve("src/test/resources/evidence");
    static final Path REAL = MODULE.resolve("../../server/data/gcsp/vehicle-evidence").normalize();

    private EvidenceFixtures() {}

    static Path required(Path path) {
        if (!Files.isDirectory(path)) throw new AssertionError("Required retained directory is missing: " + path);
        return path;
    }

    static JsonNode golden(String name) {
        try {
            return MAPPER.readTree(Files.readAllBytes(RESOURCES.resolve("golden").resolve(name)));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static void copyTree(Path from, Path to) throws IOException {
        try (Stream<Path> walk = Files.walk(from)) {
            for (Path source : (Iterable<Path>) walk::iterator) {
                Path target = to.resolve(from.relativize(source).toString());
                if (Files.isDirectory(source)) Files.createDirectories(target);
                else Files.copy(source, target);
            }
        }
    }
}
