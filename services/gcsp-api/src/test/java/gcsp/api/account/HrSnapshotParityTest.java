package gcsp.api.account;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Shape two of the parity proof: the same goldens, supplied through the HR export provider. */
class HrSnapshotParityTest {

    private static final Path DIR = Paths.get("src/test/resources/account/node-baseline");

    @TempDir
    Path tmp;

    private static List<String> goldenNames() throws IOException {
        TreeSet<String> names = new TreeSet<>();
        try (Stream<Path> files = Files.list(DIR)) {
            files.map(f -> f.getFileName().toString()).filter(f -> f.endsWith(".json"))
                    .forEach(f -> names.add(f.substring(0, f.length() - 5)));
        }
        return new ArrayList<>(names);
    }

    private AccountOutcome read(GoldenFixture fx, ObjectNode export) throws IOException {
        Path file = tmp.resolve(fx.name + ".json");
        HrExportFixture.write(file, export);
        return fx.service(HrSnapshotRecords.open(file.toString())).readAccount(fx.scope);
    }

    @Test
    void everyNodeGoldenIsReproducedFromTheHrExport() throws IOException {
        List<String> exercised = new ArrayList<>();
        for (String name : goldenNames()) {
            GoldenFixture fx = new GoldenFixture(name);
            JsonNode expected = fx.golden.get("expected");
            AccountOutcome actual = read(fx, HrExportFixture.export(List.of(fx)));
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
        assertEquals(goldenNames(), exercised);
        assertTrue(exercised.size() >= 11);
    }

    @Test
    void theExportIsNotTheNodeRecordsShape() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        ObjectNode export = HrExportFixture.export(List.of(fx));
        JsonNode person = export.get("people").get(0);
        assertFalse(person.has("contracts") || person.has("histories") || person.has("drivers") || person.has("account"));
        assertNotEquals(fx.input.get("manualContext").get("contracts"), person.get("agreements"));
        assertTrue(person.get("agreements").get(0).has("dates"));
    }

    @Test
    void personNotInTheExportIsNotFound() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        Path file = tmp.resolve("paula.json");
        HrExportFixture.write(file, HrExportFixture.export(List.of(fx)));
        HrSnapshotRecords records = HrSnapshotRecords.open(file.toString());
        assertEquals(SourceResult.NOT_FOUND, records.readEmployment("manual-test", fx.scope.runId(), "nobody").status());
        assertEquals(SourceResult.NOT_FOUND, records.readDrivers(
                new AccountScope(fx.scope.environmentId(), fx.scope.runId(), "nobody", null, List.of(), null, null, null,
                        null, "p")).status());
    }

    @Test
    void extractForAnotherEnvironmentOrRunIsASourceFailure() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        Path file = tmp.resolve("paula.json");
        HrExportFixture.write(file, HrExportFixture.export(List.of(fx)));
        HrSnapshotRecords records = HrSnapshotRecords.open(file.toString());
        SourceResult wrongRun = records.readEmployment(fx.scope.environmentId(), "another-run", fx.scope.employeeId());
        assertEquals(SourceResult.UNAVAILABLE, wrongRun.status());
        assertEquals("hr-snapshot-scope", wrongRun.code());
        assertEquals("hr-snapshot-scope",
                records.readEmployment("other-env", fx.scope.runId(), fx.scope.employeeId()).code());
    }

    @Test
    void missingProvenanceReachesTheServiceWhichRefusesIt() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        ObjectNode export = HrExportFixture.export(List.of(fx));
        ((ObjectNode) export.get("people").get(0)).remove("provenance");
        AccountOutcome o = read(fx, export);
        assertEquals("unavailable", o.status());
        assertEquals("employee-contract-invalid", o.refusal().get("source").asText());
    }

    @Test
    void unknownFactsPassThroughUnchanged() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        ObjectNode export = HrExportFixture.export(List.of(fx));
        ObjectNode unknown = GoldenFixture.JSON.createObjectNode().put("status", "unknown").put("reason", "not-supplied");
        ((ObjectNode) export.get("people").get(0).get("facts")).set("charging", unknown);
        SourceResult drivers = HrSnapshotRecords.open(write(export)).readDrivers(fx.scope);
        assertEquals(unknown, drivers.value().get("employeeFacts").get("charging"));
    }

    @Test
    void duplicatePersonnelNumberIsInvalidNotGuessed() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        ObjectNode export = HrExportFixture.export(List.of(fx, fx));
        SourceResult r = HrSnapshotRecords.open(write(export)).readEmployment(fx.scope.environmentId(), fx.scope.runId(),
                fx.scope.employeeId());
        assertEquals(SourceResult.INVALID, r.status());
    }

    @Test
    void fileThatTurnsCorruptAfterStartupIsASourceFailure() throws IOException {
        GoldenFixture fx = new GoldenFixture("paula");
        Path file = tmp.resolve("live.json");
        HrExportFixture.write(file, HrExportFixture.export(List.of(fx)));
        HrSnapshotRecords records = HrSnapshotRecords.open(file.toString());
        assertTrue(records.readDrivers(fx.scope).isOk());
        Files.writeString(file, "{ not json");
        SourceResult after = records.readDrivers(fx.scope);
        assertEquals(SourceResult.UNAVAILABLE, after.status());
        Files.delete(file);
        assertEquals(SourceResult.UNAVAILABLE, records.readEmployment(fx.scope.environmentId(), fx.scope.runId(),
                fx.scope.employeeId()).status());
    }

    private String write(ObjectNode export) throws IOException {
        Path file = tmp.resolve("x.json");
        HrExportFixture.write(file, export);
        return file.toString();
    }
}
