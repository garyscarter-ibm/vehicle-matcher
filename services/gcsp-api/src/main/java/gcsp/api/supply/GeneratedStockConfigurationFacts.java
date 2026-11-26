package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** run-stock-generation.js factsForConfiguration and selectedConfigurationDefinitionFacts, without VIN facts. */
final class GeneratedStockConfigurationFacts {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private GeneratedStockConfigurationFacts() {}

    static ObjectNode extra(JsonNode record, ObjectNode details, JsonNode mapping) {
        ObjectNode out = F.objectNode();
        JsonNode selected = record.path("catalogue").path("equipment").path("selected");
        if ("known".equals(selected.path("state").asText()) && selected.path("options").isArray()) {
            LinkedHashSet<JsonNode> codes = new LinkedHashSet<>();
            selected.path("options").forEach(codes::add);
            selected.path("accessories").forEach(code -> codes.add(code.isTextual() ? code : code.path("code")));
            ObjectNode selection = out.putObject("optionSelection");
            ObjectNode value = selection.putObject("value").put("kind", "selected-catalogue");
            ArrayNode values = value.putArray("codes");
            codes.forEach(code -> values.add(code.deepCopy()));
            boolean complete = F.textNode("2").equals(record.path("catalogue").path("schemaVersion"))
                    ? F.booleanNode(true).equals(selected.path("factoryComplete")) && F.booleanNode(true).equals(selected.path("accessoryCodesComplete"))
                    : F.textNode("1").equals(record.path("catalogue").path("schemaVersion")) && F.booleanNode(true).equals(selected.path("complete"))
                            && "complete".equals(selected.path("completeness").asText());
            value.put("complete", complete);
            if (record.path("configuration").has("vgModelCode")) value.set("modelCode", record.path("configuration").get("vgModelCode").deepCopy());
            value.set("sourceRef", record.path("configurationId").deepCopy());
            selection.putNull("unit");
        }
        JsonNode key = mapping.get(record.path("configuration").path("agModelCode").asText());
        if (key != null && key.isTextual()) {
            ObjectNode eligibility = out.putObject("eligibilityModelKey");
            eligibility.set("value", key.deepCopy());
            eligibility.putNull("unit");
            out.setAll(GeneratedStockBrowseFacts.forKey(key.asText()));
        }
        out.setAll(definitionFacts(details));
        ObjectNode provenance = F.objectNode().put("sourceRef", record.path("sourceContext").path("sourceRefs").toString())
                .put("observedAt", record.path("sourceContext").path("observedDate").asText() + "T00:00:00.000Z")
                .put("version", record.path("snapshotVersion").asText()).put("assurance", "model-reference");
        out.set("configurationEvidence", known(details, provenance));
        JsonNode transmission = details.path("description").path("powertrain").path("transmission");
        if ("known".equals(transmission.path("state").asText())) out.set("gearbox", known(transmission.path("value"), provenance));
        else {
            ObjectNode unknown = known(F.nullNode(), provenance);
            unknown.put("status", "unknown");
            ((ObjectNode) unknown.get("provenance")).put("assurance", "unknown");
            out.set("gearbox", unknown);
        }
        return out;
    }

    private static ObjectNode definitionFacts(JsonNode details) {
        ObjectNode out = F.objectNode();
        JsonNode equipment = details.path("equipment");
        JsonNode selected = equipment.path("selected");
        if (!"known".equals(selected.path("state").asText()) || !details.path("identity").path("configurationId")
                .equals(details.path("resolved").path("configurationId"))) return out;
        List<JsonNode> definitions = new ArrayList<>();
        for (JsonNode definition : equipment.path("definitions")) {
            boolean included = false;
            for (JsonNode code : selected.path("options")) included |= code.equals(definition.path("code"));
            if (included && "known".equals(definition.path("label").path("state").asText())) definitions.add(definition);
        }
        for (String category : List.of("paint", "fabric")) {
            List<JsonNode> entries = definitions.stream().filter(d -> category.equals(d.path("category").asText())).toList();
            if (entries.size() == 1) out.set("paint".equals(category) ? "colour" : "interior",
                    definitionFact(entries.getFirst().path("label").path("value"), entries, details));
        }
        List<JsonNode> options = definitions.stream().filter(d -> !Set.of("paint", "fabric").contains(d.path("category").asText())).toList();
        if (!options.isEmpty()) {
            ArrayNode values = F.arrayNode();
            options.forEach(d -> values.add(d.path("label").path("value").deepCopy()));
            int missing = selected.path("options").size() - definitions.size();
            if (missing > 0) values.add(missing + " selected " + (missing == 1 ? "code" : "codes") + " without a readable definition");
            out.set("options", definitionFact(values, options, details));
        }
        return out;
    }

    private static ObjectNode definitionFact(JsonNode value, List<JsonNode> entries, JsonNode details) {
        ArrayNode origins = F.arrayNode();
        JsonNode resolution = details.path("equipment").path("resolution");
        for (JsonNode entry : entries) {
            boolean unresolved = false;
            for (JsonNode missing : resolution.path("unresolved")) unresolved |= missing.path("code").equals(entry.path("code"));
            JsonNode label = entry.path("label").path("provenance");
            ObjectNode origin = origins.addObject().put("code", entry.path("code").asText());
            origin.set("sourceRef", label.path("source").deepCopy());
            origin.put("observedAt", label.path("observedDate").asText() + "T00:00:00.000Z");
            origin.put("version", resolution.path("version").isTextual() && resolution.path("resolvedCount").asInt() > 0 && !unresolved
                    ? resolution.path("version").asText() + ":" + resolution.path("digest").asText() : details.path("versions").path("snapshot").asText());
        }
        ObjectNode first = origins.get(0).deepCopy();
        first.remove("code");
        boolean mixed = false;
        LinkedHashSet<String> versions = new LinkedHashSet<>();
        String observedAt = "";
        for (JsonNode origin : origins) {
            for (String key : List.of("sourceRef", "observedAt", "version")) mixed |= !origin.path(key).equals(first.path(key));
            versions.add(origin.path("version").asText());
            if (origin.path("observedAt").asText().compareTo(observedAt) > 0) observedAt = origin.path("observedAt").asText();
        }
        ObjectNode provenance = first;
        if (mixed) {
            ArrayNode list = F.arrayNode();
            versions.forEach(list::add);
            provenance = F.objectNode().put("sourceRef", origins.toString()).put("observedAt", observedAt)
                    .put("version", versions.size() == 1 ? versions.iterator().next() : list.toString());
        }
        provenance.put("assurance", "model-reference");
        return known(value, provenance);
    }

    static ObjectNode known(JsonNode value, JsonNode provenance) {
        ObjectNode fact = F.objectNode().put("status", "known");
        fact.set("value", value.deepCopy());
        fact.putNull("unit");
        fact.set("provenance", provenance.deepCopy());
        return fact;
    }
}
