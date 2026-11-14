package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class NodeParityTest {

    private static final Path DIR = Paths.get("src/test/resources/account/node-baseline");

    @Test
    void everyNodeGoldenIsReproducedExactly() throws IOException {
        TreeSet<String> names = new TreeSet<>();
        try (Stream<Path> files = Files.list(DIR)) {
            files.map(f -> f.getFileName().toString()).filter(f -> f.endsWith(".json"))
                    .forEach(f -> names.add(f.substring(0, f.length() - 5)));
        }
        assertTrue(names.size() >= 11, "golden set shrank: " + names);
        List<String> exercised = new java.util.ArrayList<>();
        for (String name : names) {
            GoldenFixture fx = new GoldenFixture(name);
            JsonNode expected = fx.golden.get("expected");
            AccountOutcome actual = fx.read();
            assertEquals(expected.get("status").asText(), actual.status(), name);
            if (actual.isOk()) {
                assertEquals(expected.get("value"), actual.value(), name);
            } else {
                for (String key : List.of("status", "code", "source", "retryable", "reason", "view")) {
                    assertEquals(expected.get(key), actual.refusal().get(key), name + "." + key);
                }
            }
            exercised.add(name);
        }
        assertEquals(List.copyOf(names), exercised);
        assertTrue(exercised.contains("jordan-absent") && exercised.contains("sam-driver-invalid"));
    }
}
