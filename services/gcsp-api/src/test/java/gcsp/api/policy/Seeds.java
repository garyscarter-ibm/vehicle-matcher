package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Test access to the retained seed and the named in-memory mutations shared with policy-parity.mjs. */
final class Seeds {

    static final ObjectMapper MAPPER = new ObjectMapper();
    static final Path SEED_PATH = Path.of("../../server/gcsp/policy/seed-v1.json");
    private static final List<String> TABLES =
            List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions");

    private Seeds() {
    }

    static ObjectNode seed() {
        try {
            return (ObjectNode) MAPPER.readTree(Files.readAllBytes(SEED_PATH));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static ObjectNode assumption(ObjectNode seed, String key) {
        for (JsonNode row : seed.get("assumptions")) {
            if (key.equals(row.get("key").textValue())) {
                return (ObjectNode) row;
            }
        }
        throw new IllegalStateException(key);
    }

    static ObjectNode revise(ObjectNode seed, String policyVersion, String effectiveFrom) {
        seed.put("policyVersion", policyVersion);
        seed.put("effectiveFrom", effectiveFrom);
        for (String table : TABLES) {
            for (JsonNode row : seed.get(table)) {
                ((ObjectNode) row).put("policyVersion", policyVersion);
            }
        }
        return seed;
    }


    private static ObjectNode obj(JsonNode node) {
        return (ObjectNode) node;
    }

    private static JsonNode row(ObjectNode seed, String table, int index) {
        return seed.get(table).get(index);
    }

    private static ObjectNode copyOf(ObjectNode seed, String table, String key, String idField, String id) {
        ObjectNode copy = obj(row(seed, table, 0)).deepCopy();
        copy.put("key", key);
        copy.put(idField, id);
        ((ArrayNode) seed.get(table)).add(copy);
        return copy;
    }

    /** Single-defect mutations, one per name, mirroring `mutations` in policy-parity.mjs. */
    static void mutate(ObjectNode v, String name) {
        ObjectNode mapping = assumption(v, "eligibility.context.mapping");
        switch (name) {
            case "schema-2" -> v.put("schemaVersion", 2);
            case "blank-source" -> v.put("source", "  ");
            case "row-wrong-version" -> obj(row(v, "allowances", 0)).put("policyVersion", "other");
            case "row-bad-status" -> obj(row(v, "pricePlans", 0)).put("status", "guessed");
            case "row-bad-sourceDate" -> obj(row(v, "pricePlans", 0)).put("sourceDate", "2026-02-30");
            case "row-effectiveTo-before-from" -> obj(row(v, "allowances", 0)).put("effectiveTo", "2026-11-03T00:00:00Z");
            case "row-effectiveTo-equal-from" -> obj(row(v, "allowances", 0)).set("effectiveTo",
                    row(v, "allowances", 0).get("effectiveFrom"));
            case "row-bad-effectiveFrom" -> obj(row(v, "allowances", 0)).put("effectiveFrom", "2026-11-04");
            case "row-duplicate-key" -> obj(row(v, "allowances", 1)).set("key", row(v, "allowances", 0).get("key"));
            case "row-null-value" -> obj(v.get("assumptions").get(0)).putNull("value");
            case "row-missing-value" -> obj(v.get("assumptions").get(0)).remove("value");
            case "allowance-overlap" -> copyOf(v, "allowances", "dup.key", "allowanceId", "dup-id");
            case "allowance-adjacent-ok" -> {
                obj(row(v, "allowances", 0)).put("effectiveTo", "2026-12-01T00:00:00Z");
                ObjectNode a = copyOf(v, "allowances", "dup.key", "allowanceId", "dup-id");
                a.put("effectiveFrom", "2026-12-01T00:00:00Z");
                a.remove("effectiveTo");
            }
            case "allowance-points-mismatch" -> obj(row(v, "allowances", 0)).put("value",
                    row(v, "allowances", 0).get("value").intValue() + 1);
            case "allowance-negative" -> {
                obj(row(v, "allowances", 0)).put("monthlyPoints", -1);
                obj(row(v, "allowances", 0)).put("value", -1);
            }
            case "allowance-bad-grade" -> obj(row(v, "allowances", 0)).put("gradeId", "nope");
            case "allowance-bad-company" -> obj(row(v, "allowances", 0)).put("companyId", "nope");
            case "allowance-bad-unit" -> obj(row(v, "allowances", 0)).put("unit", "points");
            case "price-both-forms" -> obj(row(v, "pricePlans", 0)).put("configurationId", "cfg");
            case "price-neither-form" -> {
                obj(row(v, "pricePlans", 0)).remove("matchField");
                obj(row(v, "pricePlans", 0)).remove("matchValue");
            }
            case "price-bad-scheme" -> obj(row(v, "pricePlans", 0)).put("schemeId", "nope");
            case "price-duplicate-entry" -> {
                obj(row(v, "pricePlans", 1)).set("pricePlanId", row(v, "pricePlans", 0).get("pricePlanId"));
                obj(row(v, "pricePlans", 1)).set("priceEntryId", row(v, "pricePlans", 0).get("priceEntryId"));
            }
            case "price-overlap" -> copyOf(v, "pricePlans", "dup.price", "priceEntryId", "dup-entry");
            case "rule-bad-effect" -> obj(row(v, "eligibilityRules", 0)).put("effect", "maybe");
            case "rule-bad-operator" -> obj(row(v, "eligibilityRules", 0)).put("operator", "contains");
            case "rule-empty-grades" -> obj(row(v, "eligibilityRules", 0)).putArray("gradeIds");
            case "rule-duplicate-grade" -> ((ArrayNode) row(v, "eligibilityRules", 0).get("gradeIds"))
                    .add(row(v, "eligibilityRules", 0).get("gradeIds").get(0));
            case "rule-duplicate-id" -> obj(row(v, "eligibilityRules", 1)).set("ruleId",
                    row(v, "eligibilityRules", 0).get("ruleId"));
            case "rule-without-link" -> copyOf(v, "eligibilityRules", "orphan", "ruleId", "orphan");
            case "rule-grade-outside-scheme" -> ((ArrayNode) row(v, "eligibilityRules", 0).get("gradeIds")).add("nope");
            case "link-unknown-rule" -> {
                obj(row(v, "schemeRuleLinks", 0)).put("ruleId", "nope");
                obj(row(v, "schemeRuleLinks", 0)).put("value", "nope");
            }
            case "link-value-mismatch" -> obj(row(v, "schemeRuleLinks", 0)).put("value", "nope");
            case "link-source-mismatch" -> obj(row(v, "schemeRuleLinks", 0)).put("source", "elsewhere");
            case "link-status-mismatch" -> obj(row(v, "schemeRuleLinks", 0)).put("status", "assumed");
            case "link-duplicate-id" -> obj(row(v, "schemeRuleLinks", 1)).set("linkId",
                    row(v, "schemeRuleLinks", 0).get("linkId"));
            case "link-overlap" -> copyOf(v, "schemeRuleLinks", "dup.link", "linkId", "dup-link");
            case "mapping-missing" -> {
                ArrayNode kept = MAPPER.createArrayNode();
                for (JsonNode r : v.get("assumptions")) {
                    if (!"eligibility.context.mapping".equals(r.get("key").textValue())) {
                        kept.add(r);
                    }
                }
                v.set("assumptions", kept);
            }
            case "mapping-empty" -> mapping.putArray("value");
            case "mapping-duplicate-scheme" -> ((ArrayNode) mapping.get("value")).add(mapping.get("value").get(0).deepCopy());
            case "mapping-no-grades" -> obj(mapping.get("value").get(0)).putArray("gradeIds");
            case "mapping-missing-matrix" -> obj(mapping.get("value").get(0)).remove("sourceMatrix");
            case "table-missing" -> v.remove("pricePlans");
            case "table-not-array" -> v.putObject("allowances");
            case "future-effective" -> v.put("effectiveFrom", "2027-01-01T00:00:00Z");
            case "version-effectiveTo" -> v.put("effectiveTo", "2026-11-10T00:00:00Z");
            default -> throw new IllegalArgumentException(name);
        }
    }

    /** File contents for a named variant: the main file first, then retained files; null means no file. */
    static List<String> variant(String name) {
        ObjectNode seed = seed();
        switch (name) {
            case "seed":
                return List.of(seed.toString());
            case "change": {
                ObjectNode original = seed();
                original.put("effectiveTo", "2026-11-05T00:00:00Z");
                ObjectNode changed = revise(seed, "alternative-v2", "2026-11-05T00:00:00Z");
                ObjectNode hold = assumption(changed, "hold.cart.durationSeconds");
                hold.put("value", hold.get("value").intValue() + 47);
                return List.of(changed.toString(), original.toString());
            }
            case "price-ambiguous": {
                ObjectNode extra = ((ObjectNode) seed.get("pricePlans").get(0)).deepCopy();
                extra.put("key", "price.parity.config");
                extra.put("priceEntryId", "price.parity.config");
                extra.put("configurationId", "parity-cfg-1");
                extra.remove("matchField");
                extra.remove("matchValue");
                ((ArrayNode) seed.get("pricePlans")).add(extra);
                return List.of(seed.toString());
            }
            case "exclude-overlap": {
                ObjectNode rule = ((ObjectNode) seed.get("eligibilityRules").get(0)).deepCopy();
                ObjectNode link = null;
                for (JsonNode candidate : seed.get("schemeRuleLinks")) {
                    if (candidate.get("ruleId").equals(rule.get("ruleId"))) {
                        link = ((ObjectNode) candidate).deepCopy();
                        break;
                    }
                }
                rule.put("key", "parity-exclude-001");
                rule.put("ruleId", "parity-exclude-001");
                rule.put("effect", "exclude");
                link.put("key", "parity-link-exclude-001");
                link.put("linkId", "parity-link-exclude-001");
                link.put("ruleId", "parity-exclude-001");
                link.put("value", "parity-exclude-001");
                ((ArrayNode) seed.get("eligibilityRules")).add(rule);
                ((ArrayNode) seed.get("schemeRuleLinks")).add(link);
                return List.of(seed.toString());
            }
            case "bad-field":
                assumption(seed, "eligibility.rule.matchField").put("value", "otherField");
                return List.of(seed.toString());
            case "bad-precedence":
                assumption(seed, "eligibility.rule.precedence").put("value", "includeThenExclude");
                return List.of(seed.toString());
            case "no-field": {
                ArrayNode kept = MAPPER.createArrayNode();
                for (JsonNode row : seed.get("assumptions")) {
                    if (!"eligibility.rule.matchField".equals(row.get("key").textValue())) {
                        kept.add(row);
                    }
                }
                seed.set("assumptions", kept);
                return List.of(seed.toString());
            }
            case "expiring-row":
                assumption(seed, "hold.cart.durationSeconds").put("effectiveTo", "2026-11-10T00:00:00Z");
                return List.of(seed.toString());
            case "expiring-rule": {
                JsonNode ruleId = seed.get("eligibilityRules").get(0).get("ruleId");
                ((ObjectNode) seed.get("eligibilityRules").get(0)).put("effectiveTo", "2026-11-10T00:00:00Z");
                for (JsonNode link : seed.get("schemeRuleLinks")) {
                    if (link.get("ruleId").equals(ruleId)) {
                        ((ObjectNode) link).put("effectiveTo", "2026-11-10T00:00:00Z");
                    }
                }
                return List.of(seed.toString());
            }
            case "invalid-row":
                ((ObjectNode) seed.get("allowances").get(0)).put("unit", "bogus");
                return List.of(seed.toString());
            case "malformed":
                return List.of("not json");
            case "duplicate-key":
                return List.of("{\"schemaVersion\":1,\"schemaVersion\":1}");
            case "dup-effectiveFrom":
                return List.of(seed.toString(), revise(seed(), "other-v2", seed.get("effectiveFrom").textValue()).toString());
            case "dup-version-name": {
                ObjectNode other = seed();
                other.put("effectiveFrom", "2027-01-01T00:00:00Z");
                return List.of(seed.toString(), other.toString());
            }
            case "second-bad": {
                ObjectNode other = revise(seed(), "other-v2", "2027-01-01T00:00:00Z");
                obj(row(other, "allowances", 0)).put("unit", "x");
                return List.of(seed.toString(), other.toString());
            }
            case "missing-file":
                return new ArrayList<>(java.util.Collections.singletonList(null));
            default:
                if (name.startsWith("mut/")) {
                    mutate(seed, name.substring(4));
                    return List.of(seed.toString());
                }
                throw new IllegalArgumentException(name);
        }
    }

    /** Writes a variant under dir and returns the source over it (missing-file stays absent on disk). */
    static RetainedFilePolicySource source(String name, Path dir) throws IOException {
        List<String> files = variant(name);
        List<Path> paths = new ArrayList<>();
        for (int i = 0; i < files.size(); i++) {
            Path path = dir.resolve(name.replace('/', '_') + "-" + i + ".json");
            if (files.get(i) != null) {
                Files.writeString(path, files.get(i));
            }
            paths.add(path);
        }
        return new RetainedFilePolicySource(paths.get(0), paths.subList(1, paths.size()));
    }
}
