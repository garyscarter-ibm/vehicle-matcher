package gcsp.api.scenario;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** The generated, versioned demo preparation file: fictional people, their records and the scenario catalogue. */
public final class DemoPreparationFile {

    public static final String RESOURCE = "/gcsp/scenario/demo-preparation-v1.json";
    private static final ObjectMapper JSON = new ObjectMapper();

    private final JsonNode root;

    private DemoPreparationFile(JsonNode root) {
        this.root = root;
    }

    /** The packaged file; throws IllegalStateException when it is missing or invalid. */
    public static DemoPreparationFile load() {
        try (InputStream in = DemoPreparationFile.class.getResourceAsStream(RESOURCE)) {
            if (in == null) throw new IllegalStateException("The demo preparation file is missing");
            return parse(JSON.readTree(in));
        } catch (IOException e) {
            throw new IllegalStateException("The demo preparation file is unreadable", e);
        }
    }

    public static DemoPreparationFile parse(JsonNode root) {
        if (root == null || !root.path("schemaVersion").isInt() || root.path("schemaVersion").intValue() != 1
                || !text(root.get("preparationVersion")) || !text(root.get("label"))
                || !root.path("principals").isArray() || root.path("principals").isEmpty()
                || !text(root.path("catalogue").get("catalogueVersion"))
                || !root.path("catalogue").path("scenarios").isArray() || !root.path("catalogue").path("directory").isArray()) {
            throw new IllegalStateException("The demo preparation file is not in the expected shape");
        }
        Set<String> employees = new HashSet<>();
        for (JsonNode p : root.get("principals")) {
            for (String key : List.of("employeeId", "name", "companyId", "schemeId", "gradeId", "entitlementSlotId")) {
                if (!text(p.get(key))) throw new IllegalStateException("A principal lacks " + key);
            }
            if (!employees.add(p.get("employeeId").textValue()) || !p.path("record").isObject()
                    || !text(p.path("record").get("recordSetId")) || !p.path("recordVersion").canConvertToLong()
                    || !p.path("slots").isArray()) {
                throw new IllegalStateException("A principal record is invalid");
            }
            for (JsonNode s : p.get("slots")) {
                if (!text(s.get("slotId")) || !s.path("capacity").isInt() || !s.path("attributes").isObject()
                        || !s.path("version").canConvertToLong()) {
                    throw new IllegalStateException("A principal slot is invalid");
                }
            }
        }
        Set<String> ids = new HashSet<>();
        int mechanics = 0;
        for (JsonNode s : root.get("catalogue").get("scenarios")) {
            if (!text(s.get("scenarioId")) || !text(s.get("name")) || !text(s.get("kind")) || !ids.add(s.get("scenarioId").textValue())
                    || !s.path("principalIds").isArray() || !s.path("requiredCapabilities").isArray()) {
                throw new IllegalStateException("A catalogue scenario is invalid");
            }
            if ("mechanics".equals(s.get("kind").textValue())) mechanics++;
        }
        if (mechanics != 1) throw new IllegalStateException("The catalogue needs exactly one mechanics scenario");
        return new DemoPreparationFile(root);
    }

    private static boolean text(JsonNode n) {
        return n != null && n.isTextual() && !n.textValue().isBlank();
    }

    public String preparationVersion() {
        return root.get("preparationVersion").textValue();
    }

    public String catalogueVersion() {
        return root.get("catalogue").get("catalogueVersion").textValue();
    }

    public List<JsonNode> principals() {
        List<JsonNode> out = new ArrayList<>();
        root.get("principals").forEach(out::add);
        return out;
    }

    public List<JsonNode> scenarios() {
        List<JsonNode> out = new ArrayList<>();
        root.get("catalogue").get("scenarios").forEach(out::add);
        return out;
    }

    public Optional<JsonNode> scenario(String scenarioId) {
        return scenarios().stream().filter(s -> s.get("scenarioId").textValue().equals(scenarioId)).findFirst();
    }

    /** The display person (employeeId, name, roles) for a catalogue principal id. */
    public Optional<JsonNode> person(String principalId) {
        for (JsonNode d : root.get("catalogue").get("directory")) {
            if (principalId.equals(d.path("principalId").asText())) return Optional.of(d);
        }
        return Optional.empty();
    }
}
