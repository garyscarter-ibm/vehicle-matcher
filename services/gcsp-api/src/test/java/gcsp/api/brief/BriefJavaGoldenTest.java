package gcsp.api.brief;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectWriter;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.ws.rs.core.Response;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.TreeSet;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * FUCQ-441: the real BriefService bodies, wrapped by BriefResource.respond, for one employee's editor journey, kept as
 * goldens the Angular client and store consume as-is. -Dgcsp.brief.golden.write=true regenerates; otherwise exact compare.
 */
class BriefJavaGoldenTest {

    static final Path DIR = Path.of("src/test/resources/brief/java-golden");
    static final String MANIFEST = "manifest.json";
    private static final String CAR = "contract-1";
    private static final boolean WRITE = Boolean.getBoolean("gcsp.brief.golden.write");
    private static final ObjectWriter OUT = Json.M.writer(new DefaultPrettyPrinter().withObjectIndenter(new DefaultIndenter("  ", "\n")));

    BriefFixture f;
    private final List<ObjectNode> steps = new ArrayList<>();

    @BeforeEach
    void setUp() throws Exception {
        f = BriefFixture.create();
        f.account.facts = Optional.of(new BriefAccountPort.AccountFacts(new BriefAccountPort.CurrentContract(CAR, "Model X"), "facts-1",
                new BriefAccountPort.Known(j("{\"employeeId\":\"emp-1\"}"), j("{\"contractId\":\"" + CAR + "\",\"model\":\"Model X\"}"),
                        j("[{\"name\":\"Pat\"}]"), j("{\"clock\":\"clock-1\"}"), "account-context-1", "clock-1",
                        j("{\"essentials\":{},\"annualMileage\":{\"value\":8000,\"unit\":\"miles\"}}"), "provider-facts-1")));
    }

    @AfterEach
    void tearDown() throws Exception {
        if (f != null) f.close();
    }

    private static JsonNode j(String json) {
        try {
            return Json.M.readTree(json);
        } catch (Exception e) {
            throw new IllegalArgumentException(json, e);
        }
    }

    private static ObjectNode command(String id, long brief, long draft) {
        return Harness.envelope(id, brief, draft);
    }

    /** Runs one operation through the real HTTP mapping and records method, path, request, status and body. */
    private JsonNode step(String name, String method, String path, ObjectNode request, Supplier<BriefResult> op) {
        Response r = BriefResource.respond(op.get());
        JsonNode body = (JsonNode) r.getEntity();
        ObjectNode s = Json.obj();
        s.put("file", String.format("%02d-%s.json", steps.size() + 1, name)).put("step", name);
        s.put("method", method).put("path", path);
        s.set("request", request == null ? Json.M.nullNode() : request.deepCopy());
        s.put("status", r.getStatus());
        s.set("body", body.deepCopy());
        steps.add(s);
        return body;
    }

    private JsonNode editor(String name) {
        return step(name, "GET", "/brief/editor", null, () -> f.service.readEditor(f.scope));
    }

    private static JsonNode value(JsonNode body) {
        assertEquals("ok", body.path("status").asText(), body.toString());
        return body.get("value");
    }

    @Test
    void theEditorJourneyBodiesMatchTheCommittedGoldens() throws Exception {
        JsonNode first = value(editor("editor-initial"));
        assertEquals(0, first.get("initial").get("briefVersion").intValue());
        assertEquals(first.get("context").get("contextVersion"), first.get("versions").get("context"));

        ObjectNode prefs = command("golden-preferences-1", 0, 0);
        prefs.set("changes", j("{\"comfort\":{\"value\":50}}"));
        prefs.set("currentCarRating", j("{\"contractId\":\"" + CAR + "\",\"value\":4}"));
        JsonNode saved = value(step("preferences-save", "POST", "/brief/preferences", prefs, () -> f.service.savePreferences(f.scope, prefs)));
        assertEquals(1, saved.get("draftVersion").intValue());

        // Reload shows the server's saved version, not the request.
        JsonNode reloaded = value(editor("editor-after-save"));
        assertEquals(1, reloaded.get("initial").get("draftVersion").intValue());
        assertEquals(4, reloaded.get("initial").get("currentCarRating").get("value").intValue());

        ObjectNode brief = ((ObjectNode) reloaded.get("initial").get("brief")).deepCopy();
        Harness.choose(brief, "body", Harness.list("estate"), 50);
        Harness.choose(brief, "economy", Json.M.getNodeFactory().numberNode(50), 50);
        ObjectNode draft = command("golden-draft-1", 0, 1);
        draft.set("brief", brief);
        assertEquals(2, value(step("draft-save", "POST", "/brief/draft", draft, () -> f.service.saveDraft(f.scope, draft)))
                .get("draftVersion").intValue());

        ObjectNode confirm = command("golden-confirm-1", 0, 2);
        confirm.set("consent", j("{\"search\":true,\"hold\":true}"));
        JsonNode confirmed = value(step("confirm-with-consent", "POST", "/brief/confirm", confirm, () -> f.service.confirm(f.scope, confirm)));
        assertEquals(1, confirmed.get("brief").get("briefVersion").intValue());
        assertTrue(confirmed.get("activity").get("canSearch").booleanValue());
        assertEquals("engaged", value(editor("editor-confirmed")).get("initial").get("buddy").get("state").asText());

        ObjectNode pause = command("golden-pause-1", 1, 2);
        assertEquals(2, value(step("pause-search", "POST", "/brief/pause-search", pause, () -> f.service.pauseSearch(f.scope, pause)))
                .get("briefVersion").intValue());
        JsonNode paused = value(editor("editor-paused")).get("initial").get("buddy");
        assertEquals("disengaged", paused.get("state").asText());
        assertEquals("paused", paused.get("reason").asText());

        // A writer at the older brief version is refused and nothing is written.
        List<Long> before = f.snapshot();
        ObjectNode stale = command("golden-stale-1", 1, 2);
        stale.set("changes", j("{\"size\":{\"value\":100}}"));
        JsonNode refused = step("preferences-stale", "POST", "/brief/preferences", stale, () -> f.service.savePreferences(f.scope, stale));
        assertEquals(409, steps.get(steps.size() - 1).get("status").intValue());
        assertEquals("stale-version", refused.get("status").asText());
        assertEquals(before, f.snapshot());

        // Account facts unavailable: the read and the save are both a truthful 503 and nothing is written.
        f.account.facts = Optional.empty();
        assertEquals("unavailable", editor("editor-unavailable").get("status").asText());
        ObjectNode down = command("golden-unavailable-1", 2, 2);
        down.set("changes", j("{\"size\":{\"value\":100}}"));
        step("preferences-unavailable", "POST", "/brief/preferences", down, () -> f.service.savePreferences(f.scope, down));
        assertEquals(503, steps.get(steps.size() - 1).get("status").intValue());
        assertEquals(before, f.snapshot());

        compareOrWrite();
    }

    private void compareOrWrite() throws Exception {
        ObjectNode manifest = Json.obj();
        manifest.put("schemaVersion", 1).put("story", "FUCQ-441").put("basePath", "/api/gcsp/v1");
        manifest.put("producer", "gcsp.api.brief.BriefJavaGoldenTest via BriefService and BriefResource.respond");
        ObjectNode scope = manifest.putObject("scope");
        scope.put("environmentId", f.scope.environmentId()).put("runId", f.scope.runId()).put("employeeId", f.scope.employeeId())
                .put("principalId", f.scope.principalId()).put("policyVersion", f.scope.policyVersion());
        manifest.put("clock", BriefFixture.NOW.toString());
        ArrayNode list = manifest.putArray("steps");
        List<String> expected = new ArrayList<>(List.of(MANIFEST));
        for (ObjectNode s : steps) {
            list.addObject().put("file", s.get("file").asText()).put("step", s.get("step").asText())
                    .put("method", s.get("method").asText()).put("path", s.get("path").asText()).put("status", s.get("status").intValue());
            expected.add(s.get("file").asText());
        }
        List<String[]> files = new ArrayList<>();
        files.add(new String[] {MANIFEST, OUT.writeValueAsString(manifest) + "\n"});
        for (ObjectNode s : steps) files.add(new String[] {s.get("file").asText(), OUT.writeValueAsString(s) + "\n"});
        if (WRITE) {
            Files.createDirectories(DIR);
            for (String[] file : files) Files.writeString(DIR.resolve(file[0]), file[1], StandardCharsets.UTF_8);
        }
        assertTrue(Files.isDirectory(DIR), "No goldens at " + DIR.toAbsolutePath() + "; generate with -Dgcsp.brief.golden.write=true");
        try (Stream<Path> present = Files.list(DIR)) {
            assertEquals(new TreeSet<>(expected), new TreeSet<>(present.map(p -> p.getFileName().toString()).toList()),
                    "the golden folder holds exactly this journey's files");
        }
        for (String[] file : files) {
            Path p = DIR.resolve(file[0]);
            assertTrue(Files.exists(p), "missing golden " + p);
            assertEquals(Files.readString(p, StandardCharsets.UTF_8), file[1], "golden " + file[0] + " differs from the produced body");
        }
    }
}
