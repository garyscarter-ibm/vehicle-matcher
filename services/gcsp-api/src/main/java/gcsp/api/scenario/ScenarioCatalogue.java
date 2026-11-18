package gcsp.api.scenario;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** The catalogue as the presenter sees it. A journey is available only with a reviewed start loader; none exists yet. */
public final class ScenarioCatalogue {

    private static final JsonNodeFactory F = JsonNodeFactory.instance;

    /** One scenario with its resolved versions and availability. */
    public record Entry(String scenarioId, String name, String kind, String scenarioVersion, String fixtureVersion,
            String policyVersion, boolean available, List<String> missingCapabilities, ObjectNode view) {

        public boolean mechanics() {
            return "mechanics".equals(kind);
        }

        /** The identity of the scenario as shown on a current run. */
        public ObjectNode summary() {
            return F.objectNode().put("scenarioId", scenarioId).put("name", name).put("scenarioVersion", scenarioVersion)
                    .put("fixtureVersion", fixtureVersion).put("policyVersion", policyVersion);
        }
    }

    private final String catalogueVersion;
    private final String policyVersion;
    private final List<Entry> entries;

    private ScenarioCatalogue(String catalogueVersion, String policyVersion, List<Entry> entries) {
        this.catalogueVersion = catalogueVersion;
        this.policyVersion = policyVersion;
        this.entries = entries;
    }

    /** Mechanics takes its versions from the clock policy; a journey keeps the file's. */
    public static ScenarioCatalogue build(DemoPreparationFile file, String policyVersion, String clockScenarioVersion,
            String clockFixtureVersion, String clockStart, JsonNode namedTimes) {
        List<Entry> out = new ArrayList<>();
        for (JsonNode s : file.scenarios()) {
            boolean mechanics = "mechanics".equals(s.get("kind").textValue());
            List<String> missing = new ArrayList<>();
            if (!mechanics) s.get("requiredCapabilities").forEach(c -> missing.add(c.textValue()));
            String scenarioVersion = mechanics ? clockScenarioVersion : s.path("scenarioVersion").asText();
            String fixtureVersion = mechanics ? clockFixtureVersion : s.path("fixtureVersion").asText();
            ObjectNode view = F.objectNode();
            view.put("scenarioId", s.get("scenarioId").textValue()).put("name", s.get("name").textValue())
                    .put("kind", s.get("kind").textValue()).put("scenarioVersion", scenarioVersion)
                    .put("fixtureVersion", fixtureVersion).put("policyVersion", policyVersion)
                    .put("clockStart", clockStart);
            view.set("namedTimes", namedTimes.deepCopy());
            var people = view.putArray("principals");
            for (JsonNode id : s.get("principalIds")) {
                Optional<JsonNode> person = file.person(id.asText());
                if (person.isEmpty()) throw new IllegalStateException("A scenario names an unknown principal");
                people.addObject().put("employeeId", person.get().get("employeeId").textValue())
                        .put("name", person.get().get("name").textValue()).set("roles", person.get().get("roles").deepCopy());
            }
            ObjectNode availability = view.putObject("availability");
            availability.put("available", missing.isEmpty()).put("outcome", missing.isEmpty() ? "available" : "not available yet");
            var list = availability.putArray("missingCapabilities");
            missing.forEach(list::add);
            view.put("inputProvenance", mechanics ? "fictional-clock-mechanics-only" : missing.isEmpty()
                    ? "versioned-fictional-journey-inputs; applied through actual services after reset"
                    : "versioned-fictional-journey-inputs; required domain services unavailable");
            out.add(new Entry(s.get("scenarioId").textValue(), s.get("name").textValue(), s.get("kind").textValue(),
                    scenarioVersion, fixtureVersion, policyVersion, missing.isEmpty(), List.copyOf(missing), view));
        }
        return new ScenarioCatalogue(file.catalogueVersion(), policyVersion, List.copyOf(out));
    }

    public Optional<Entry> find(String scenarioId) {
        return entries.stream().filter(e -> e.scenarioId().equals(scenarioId)).findFirst();
    }

    public Entry mechanics() {
        return entries.stream().filter(Entry::mechanics).findFirst().orElseThrow();
    }

    public ObjectNode view() {
        ObjectNode out = F.objectNode().put("catalogueVersion", catalogueVersion).put("policyVersion", policyVersion);
        var list = out.putArray("scenarios");
        entries.forEach(e -> list.add(e.view().deepCopy()));
        return out;
    }

    public String catalogueVersion() {
        return catalogueVersion;
    }
}
