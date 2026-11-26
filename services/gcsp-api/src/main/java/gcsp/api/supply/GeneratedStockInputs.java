package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.*;
import gcsp.api.policy.*;
import gcsp.api.recommendation.Gates;
import gcsp.api.recommendation.RecommendationConfig;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** Native inputs from the retained corpus and PolicyService; generation and persistence belong to the caller. */
public final class GeneratedStockInputs {
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private final Path corpusRoot;
    private final Path referenceRoot;
    private final Path assetsRoot;
    private final PolicyService policy;

    public GeneratedStockInputs(Path corpusRoot, Path referenceRoot, Path assetsRoot, PolicyService policy) {
        this.corpusRoot = corpusRoot;
        this.referenceRoot = referenceRoot;
        this.assetsRoot = assetsRoot;
        this.policy = policy;
    }

    /** Success is a generator request without inventory; refusals carry status and code. */
    public JsonNode load(String runId, String policyVersion, Instant clock, JsonNode scenario, JsonNode tranche) {
        try {
            if (runId == null || runId.isBlank() || policyVersion == null || clock == null) return failure("invalid", "invalid-generator-input");
            PolicyRead read = new PolicyRead(runId, ISO.format(clock), policyVersion);
            CorpusStore store = new CorpusStore(corpusRoot);
            LoadOutcome loaded = store.load();
            if (!"ok".equals(loaded.status()) || loaded.active() == null) return failure("unavailable", "registry-unavailable");
            ActiveInfo active = loaded.active();
            Path selected = corpusRoot.resolve("versions").resolve(active.manifestDigest());
            byte[] manifestBytes = Files.readAllBytes(selected.resolve("manifest.json"));
            if (!HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(manifestBytes)).equals(active.manifestDigest())) {
                return failure("unavailable", "retained-corpus-unavailable");
            }
            JsonNode manifest = JSON.readTree(manifestBytes);
            ObjectNode assumptions = F.objectNode();
            JsonNode lines = assumption("stock.corpusModelLines.v1", read, assumptions).path("value");
            JsonNode labels = assumption("stock.optionLabels.v1", read, assumptions).path("value");
            if (!validLines(lines) || !validLabels(labels)) return failure("invalid", "unsupported-plan-policy");
            ObjectNode plan = plan(selected, manifest, active, lines, labels);
            if (plan.path("configurations").isEmpty()) return failure("invalid", "no-usable-corpus-rows");
            for (String key : List.of("supply.release.size", "supply.weeklyReleaseVolume", "supply.release.cadence")) assumption(key, read, assumptions);
            for (JsonNode key : plan.path("aggregateKeys")) assumption(key.asText(), read, assumptions);
            optionalAssumption("supply.release.modelMix", read, assumptions);
            optionalAssumption("policy.displayLabels.v1", read, assumptions);
            JsonNode mapping = assumption("stock.eligibilityModelKeys.v1", read, assumptions).path("value");
            if (!mapping.isObject()) return failure("unavailable", "eligibility-keys-unavailable");
            EvidenceRegistry registry = new DefinitionRegistry(new DisplayImageRegistry(EvidenceRegistry.of(store),
                    new DisplayCatalogue(referenceRoot.resolve("display-images.v1.json"), assetsRoot)),
                    new ConfigurationDefinitions(referenceRoot.resolve("configuration-definitions.v1.json")));
            VehicleEvidenceLookup lookup = new VehicleEvidenceLookup(registry, null);
            ObjectNode configurations = F.objectNode();
            for (JsonNode binding : plan.path("configurations")) {
                String id = binding.path("configurationId").asText();
                EvidenceSource source = registry.getConfiguration(id);
                if (source == null || source.record() == null) return failure("unavailable", "configuration-unavailable");
                ObjectNode details = lookup.resolve(new EvidenceRequest("configuration", id, null), null);
                if (!Set.of("complete", "partial").contains(details.path("status").asText())) return failure("unavailable", "configuration-unavailable");
                ((ObjectNode) details.path("identity")).remove("vin");
                ObjectNode configuration = configurations.putObject(id);
                configuration.set("record", source.record());
                configuration.set("active", JSON.valueToTree(source.active()));
                configuration.set("images", JSON.valueToTree(source.images()));
                configuration.set("extraFacts", GeneratedStockConfigurationFacts.extra(source.record(), details, mapping));
            }
            ObjectNode request = F.objectNode().put("runId", runId).put("seed", "gcsp-demo-stock-v1")
                    .put("policyVersion", policyVersion).put("clockInstant", ISO.format(clock)).put("stockAccount", "gcsp-demo-scheme-stock");
            request.set("plan", plan);
            request.set("assumptions", assumptions);
            request.set("configurations", configurations);
            ObjectNode visibility = request.putObject("visibility");
            visibility.putArray("companyIds").add("demo-bmw-fs-uk").add("demo-bmw-rr-production");
            visibility.putArray("schemeIds").add("choices-fs-uk").add("choices-rr-production");
            visibility.putNull("employeeIds");
            JsonNode guarantee = tranche == null ? null : tranche.get("guarantee");
            request.set("guarantee", guarantee == null ? F.nullNode() : guarantee.deepCopy());
            ArrayNode qualifying = request.putArray("qualifyingConfigurationIds");
            if (guarantee != null && !guarantee.isNull()) {
                Guarantee check = guarantee(read, scenario, guarantee, assumptions);
                if (check == null) return failure("unavailable", "release-guarantee-unavailable");
                for (JsonNode binding : plan.path("configurations")) {
                    String id = binding.path("configurationId").asText();
                    if (qualifies(read, check, id, configurations.path(id).path("extraFacts"))) qualifying.add(id);
                }
            }
            return request;
        } catch (InputFailure e) {
            return failure("unavailable", e.getMessage());
        } catch (Exception e) {
            return failure("unavailable", "stock-generation-unavailable");
        }
    }

    private JsonNode assumption(String key, PolicyRead read, ObjectNode assumptions) {
        PolicyResult result = policy.getAssumption(key, read);
        if (!result.ok() || !read.policyVersion().equals(result.policyVersion()) || !key.equals(result.value().path("key").asText())) {
            throw new InputFailure("required-stock-policy-unavailable");
        }
        assumptions.set(key, result.value().deepCopy());
        return result.value();
    }

    private void optionalAssumption(String key, PolicyRead read, ObjectNode assumptions) {
        PolicyResult result = policy.getAssumption(key, read);
        if (result.ok() && read.policyVersion().equals(result.policyVersion())) assumptions.set(key, result.value().deepCopy());
    }

    private ObjectNode plan(Path selected, JsonNode manifest, ActiveInfo active, JsonNode lines, JsonNode labels) throws Exception {
        JsonNode fleet = JSON.readTree(Files.readAllBytes(corpusRoot.getParent().resolve("fleet-plan.json")));
        if (!fleet.path("coverage").path("schemeModelLines").isArray()) throw new InputFailure("retained-corpus-unavailable");
        TreeMap<String, TreeMap<String, List<String>>> groups = new TreeMap<>();
        Map<String, JsonNode> mappings = new HashMap<>();
        for (JsonNode line : lines) mappings.put(line.path("modelLineId").asText(), line);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var input = new DigestInputStream(Files.newInputStream(selected.resolve("configurations.jsonl")), digest);
                BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String raw;
            while ((raw = reader.readLine()) != null) {
                if (raw.isEmpty()) continue;
                JsonNode row = JSON.readTree(raw);
                JsonNode mapped = lines.get(row.path("configuration").path("generation").asText());
                if (mapped == null) continue;
                List<String> paint = new ArrayList<>();
                List<String> upholstery = new ArrayList<>();
                for (JsonNode option : row.path("canonicalIdentity").path("factoryOptionCodes")) {
                    String code = option.asText();
                    if (code.matches("P[0-9A-Z]{4}")) paint.add(code);
                    if (code.matches("F[0-9A-Z]{4}")) upholstery.add(code);
                }
                if (paint.size() != 1 || upholstery.size() != 1) continue;
                JsonNode colour = labels.path("paint").get(paint.getFirst());
                JsonNode fabric = labels.path("upholstery").get(upholstery.getFirst());
                if (!text(colour) || !text(fabric)) continue;
                groups.computeIfAbsent(mapped.path("modelLineId").asText(), ignored -> new TreeMap<>())
                        .computeIfAbsent(colour.asText(), ignored -> new ArrayList<>()).add(row.path("configurationId").asText());
            }
        }
        if (!HexFormat.of().formatHex(digest.digest()).equals(manifest.path("checksums").path("configurations.jsonl").asText())) {
            throw new InputFailure("retained-corpus-unavailable");
        }
        Path relative = assetsRoot.normalize().relativize(corpusRoot.normalize());
        String location = relative.startsWith("..") ? corpusRoot.getFileName().toString() : relative.toString();
        ObjectNode plan = F.objectNode().put("kind", "retained-corpus").put("source", "FUCQ-61 retained corpus " + location)
                .put("datasetId", active.datasetId()).put("corpusVersion", active.version());
        ArrayNode configurations = plan.putArray("configurations");
        ObjectNode aggregateKeys = plan.putObject("aggregateKeys");
        ObjectNode titles = plan.putObject("titles");
        ObjectNode displayNames = plan.putObject("displayNames");
        groups.forEach((line, colours) -> {
            JsonNode mapping = mappings.get(line);
            aggregateKeys.put(line, "stock.aggregate." + line);
            titles.set(line, mapping.path("title").deepCopy());
            displayNames.set(line, mapping.has("displayName") ? mapping.get("displayName").deepCopy() : mapping.path("title").deepCopy());
            colours.forEach((colour, ids) -> ids.stream().sorted().limit(8).forEach(id -> configurations.addObject()
                    .put("configurationId", id).put("modelLineId", line).put("colour", colour)));
        });
        return plan;
    }

    private record Guarantee(PolicyContext context, double allowance, ObjectNode essentials,
            ObjectNode employeeFacts, RecommendationConfig config, boolean chargingRequired) {}

    private Guarantee guarantee(PolicyRead read, JsonNode scenario, JsonNode wanted, ObjectNode assumptions) {
        try {
            String principalId = wanted.path("principalId").asText();
            JsonNode people = assumption("identity.demo.principals", read, assumptions).path("value");
            JsonNode mapping = assumption("eligibility.context.mapping", read, assumptions).path("value");
            if (!validPrincipals(people, mapping)) return null;
            JsonNode person = null;
            for (JsonNode candidate : people) if (principalId.equals(candidate.path("principalId").asText())) person = candidate;
            JsonNode input = null;
            for (JsonNode brief : scenario.path("inputs").path("briefs")) if (principalId.equals(brief.path("principalId").asText())) input = brief;
            if (person == null || input == null) return null;
            PolicyContext context = new PolicyContext(null, person.path("companyId").asText(), person.path("schemeId").asText(), person.path("gradeId").asText());
            PolicyResult allowance = policy.getAllowance(context, read);
            if (!allowance.ok()) return null;
            JsonNode recommendation = assumption("employee.recommendation.v1", read, assumptions).path("value");
            JsonNode lifecycle = assumption("brief.lifecycle.v1", read, assumptions).path("value");
            JsonNode required = assumption("eligibility.homeCharging.requiredForPlugIn", read, assumptions).path("value");
            ObjectNode essentials = F.objectNode();
            for (var entry : input.path("essentials").properties()) {
                JsonNode definition = "charging".equals(entry.getKey()) ? lifecycle.path("charging") : recommendation.path("essentials").path(entry.getKey());
                if (definition.isMissingNode() || definition.isNull()) return null;
                if ("charging".equals(entry.getKey())) continue;
                ObjectNode requirement = essentials.putObject(entry.getKey()).put("state", "confirmed")
                        .put("source", "scenario:" + scenario.path("scenarioId").asText());
                if (definition.has("operator")) requirement.set("operator", definition.get("operator").deepCopy());
                if (definition.has("unit")) requirement.set("unit", definition.get("unit").deepCopy());
                requirement.set("value", entry.getValue().deepCopy());
            }
            JsonNode charging = input.path("essentials").get("charging");
            ObjectNode facts = F.objectNode();
            ObjectNode fact = facts.putObject("charging").put("status", charging == null || charging.isNull() ? "unknown" : "known");
            fact.set("value", charging == null ? F.nullNode() : charging.deepCopy());
            fact.putNull("unit");
            fact.putObject("provenance").put("sourceRef", charging == null ? "brief:unresolved" : "scenario:" + scenario.path("scenarioId").asText())
                    .put("version", "release-guarantee").put("observedAt", read.asOf()).put("assurance", "synthetic-scenario");
            return new Guarantee(context, allowance.value().path("monthlyPoints").asDouble(), essentials, facts,
                    new RecommendationConfig(recommendation), truthy(required));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private boolean qualifies(PolicyRead read, Guarantee check, String id, JsonNode extra) {
        ObjectNode wrapped = F.objectNode();
        ObjectNode car = F.objectNode().put("configurationId", id);
        extra.properties().forEach(entry -> {
            JsonNode fact = entry.getValue();
            if (!fact.has("status") && !fact.has("provenance")) {
                JsonNode value = fact.isObject() && fact.size() == 2 && fact.has("value") && fact.has("unit") ? fact.get("value") : fact;
                ObjectNode provenance = F.objectNode().put("sourceRef", "generator:stock-generator.v1").put("observedAt", read.asOf())
                        .put("version", "stock-generator.v1:" + read.policyVersion()).put("assurance", "synthetic-scenario");
                ObjectNode known = GeneratedStockConfigurationFacts.known(value, provenance);
                if (fact.has("unit")) known.set("unit", fact.get("unit").deepCopy());
                fact = known;
            }
            wrapped.set(entry.getKey(), fact.deepCopy());
            if ("known".equals(fact.path("status").asText())) car.set(entry.getKey(), fact.path("value").deepCopy());
        });
        PolicyResult eligibility = policy.getEligibility(check.context(), car, read);
        PolicyResult points = policy.getPointsCost(check.context(), car, read);
        if (!eligibility.ok() || !"eligible".equals(eligibility.value().path("state").asText()) || !points.ok()
                || points.value().path("monthlyPoints").asDouble() > check.allowance()) return false;
        ObjectNode snapshot = F.objectNode();
        snapshot.set("facts", wrapped);
        ObjectNode brief = F.objectNode();
        brief.set("essentials", check.essentials());
        Gates.Result essentials = Gates.evaluateEssentials(snapshot, brief, check.config(), true);
        Gates.Result charging = Gates.chargingGates(snapshot, check.employeeFacts(), check.config(), check.chargingRequired());
        return essentials.blockers().isEmpty() && essentials.unknowns().isEmpty() && charging.blockers().isEmpty() && charging.unknowns().isEmpty();
    }

    private static boolean validPrincipals(JsonNode people, JsonNode mapping) {
        if (!people.isArray() || people.isEmpty() || !mapping.isArray()) return false;
        Set<JsonNode> principalIds = new HashSet<>(), employeeIds = new HashSet<>(), slots = new HashSet<>();
        int presenters = 0;
        Set<String> allowed = Set.of("principalId", "employeeId", "name", "roles", "companyId", "schemeId", "gradeId", "entitlementSlotId");
        for (JsonNode person : people) {
            if (!person.isObject()) return false;
            for (var entry : person.properties()) if (!allowed.contains(entry.getKey())) return false;
            for (String key : List.of("principalId", "employeeId", "name")) if (!nonempty(person.get(key))) return false;
            if (!principalIds.add(person.get("principalId")) || !employeeIds.add(person.get("employeeId"))) return false;
            JsonNode roles = person.path("roles");
            if (!roles.isArray() || roles.isEmpty() || roles.size() > 2) return false;
            Set<String> unique = new HashSet<>();
            for (JsonNode role : roles) if (!role.isTextual() || !Set.of("employee", "greg", "presenter").contains(role.asText()) || !unique.add(role.asText())) return false;
            if (unique.contains("presenter")) { if (roles.size() != 1) return false; presenters++; continue; }
            boolean matched = false;
            for (JsonNode row : mapping) {
                if (!row.path("companyId").equals(person.path("companyId")) || !row.path("schemeId").equals(person.path("schemeId"))) continue;
                if (!unique.contains("employee")) matched = true;
                else for (JsonNode grade : row.path("gradeIds")) matched |= grade.equals(person.path("gradeId")) && nonempty(person.get("entitlementSlotId"));
            }
            if (!matched || unique.contains("employee") && !slots.add(person.get("entitlementSlotId"))) return false;
        }
        return presenters == 1;
    }

    private static boolean validLines(JsonNode lines) {
        if (!lines.isObject() || lines.isEmpty()) return false;
        for (JsonNode line : lines) if (!line.isObject() || !text(line.get("modelLineId")) || !text(line.get("title"))
                || line.has("displayName") && !text(line.get("displayName"))) return false;
        return true;
    }

    private static boolean validLabels(JsonNode labels) {
        if (!labels.isObject()) return false;
        for (String kind : List.of("paint", "upholstery")) {
            if (!labels.path(kind).isObject()) return false;
            for (JsonNode label : labels.path(kind)) if (!text(label)) return false;
        }
        return true;
    }

    private static boolean nonempty(JsonNode node) { return node != null && node.isTextual() && !node.asText().isEmpty(); }
    private static boolean text(JsonNode node) { return nonempty(node) && !node.asText().isBlank() && node.asText().length() <= 512; }
    private static boolean truthy(JsonNode n) { return n != null && !n.isNull() && (!n.isBoolean() || n.asBoolean()) && (!n.isNumber() || n.asDouble() != 0) && (!n.isTextual() || !n.asText().isEmpty()); }
    private static ObjectNode failure(String status, String code) {
        return F.objectNode().put("status", status).put("code", code).put("reason", "Generated stock is unavailable.").put("retryable", "unavailable".equals(status));
    }
    private static final class InputFailure extends RuntimeException {
        InputFailure(String code) { super(code); }
    }
}
