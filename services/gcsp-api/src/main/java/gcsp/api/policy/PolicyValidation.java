package gcsp.api.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyVersion.Row;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

/** Port of the Node snapshotVersions rules: any failure is source-invalid. */
final class PolicyValidation {

    private static final List<String> TABLES =
            List.of("schemeRuleLinks", "eligibilityRules", "pricePlans", "allowances", "assumptions");
    private static final Set<String> STATUSES = Set.of("assumed", "verified", "observed aggregate");

    private static final class Invalid extends RuntimeException {
        Invalid() {
            super(null, null, false, false);
        }
    }

    private PolicyValidation() {
    }

    static List<PolicyVersion> snapshot(List<JsonNode> input) throws PolicySourceException {
        try {
            return build(input);
        } catch (RuntimeException e) {
            throw new PolicySourceException(PolicySourceException.INVALID);
        }
    }

    private static void require(boolean condition) {
        if (!condition) {
            throw new Invalid();
        }
    }

    private static boolean text(JsonNode node) {
        return node != null && node.isTextual() && PolicyTime.text(node.textValue());
    }

    private static boolean isObject(JsonNode node) {
        return node != null && node.isObject();
    }

    private static boolean finite(JsonNode node) {
        return node != null && node.isNumber() && Double.isFinite(node.doubleValue());
    }

    private static String str(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value != null && value.isTextual() ? value.textValue() : null;
    }

    private static boolean instant(JsonNode node) {
        return node != null && node.isTextual() && PolicyTime.validInstant(node.textValue());
    }

    private static long millis(JsonNode node) {
        return PolicyTime.parse(node.textValue()).getAsLong();
    }

    private static void dates(JsonNode row) {
        require(instant(row.get("effectiveFrom")));
        if (row.has("effectiveTo")) {
            require(instant(row.get("effectiveTo")) && millis(row.get("effectiveTo")) > millis(row.get("effectiveFrom")));
        }
    }

    private static void unique(List<?> values) {
        require(new HashSet<>(values).size() == values.size());
    }

    private static void nonoverlapping(List<JsonNode> rows, Function<JsonNode, Object> key) {
        Map<Object, List<long[]>> groups = new HashMap<>();
        for (JsonNode row : rows) {
            List<long[]> previous = groups.computeIfAbsent(key.apply(row), k -> new ArrayList<>());
            long start = millis(row.get("effectiveFrom"));
            long end = row.has("effectiveTo") ? millis(row.get("effectiveTo")) : Long.MAX_VALUE;
            for (long[] other : previous) {
                require(start >= other[1] || end <= other[0]);
            }
            previous.add(new long[] {start, end});
        }
    }

    private static List<JsonNode> list(JsonNode array) {
        List<JsonNode> out = new ArrayList<>();
        array.forEach(out::add);
        return out;
    }

    private static List<PolicyVersion> build(List<JsonNode> input) {
        require(input != null && !input.isEmpty());
        List<JsonNode> versions = new ArrayList<>();
        for (JsonNode raw : input) {
            require(raw != null);
            versions.add(raw.deepCopy());
        }
        List<String> names = new ArrayList<>();
        List<Long> froms = new ArrayList<>();
        for (JsonNode seed : versions) {
            require(isObject(seed) && text(seed.get("policyVersion")) && instant(seed.get("effectiveFrom")));
            names.add(seed.get("policyVersion").textValue());
            froms.add(millis(seed.get("effectiveFrom")));
        }
        unique(names);
        unique(froms);
        List<PolicyVersion> out = new ArrayList<>();
        for (JsonNode seed : versions) {
            out.add(validateSeed((ObjectNode) seed));
        }
        return List.copyOf(out);
    }

    private static PolicyVersion validateSeed(ObjectNode seed) {
        JsonNode schema = seed.get("schemaVersion");
        require(finite(schema) && schema.doubleValue() == 1 && text(seed.get("source")));
        dates(seed);
        String version = seed.get("policyVersion").textValue();
        Map<String, List<JsonNode>> rows = new LinkedHashMap<>();
        for (String table : TABLES) {
            JsonNode array = seed.get(table);
            require(array != null && array.isArray());
            List<JsonNode> list = list(array);
            List<String> keys = new ArrayList<>();
            for (JsonNode row : list) {
                require(isObject(row) && text(row.get("key")));
                keys.add(row.get("key").textValue());
            }
            unique(keys);
            for (JsonNode row : list) {
                require(row.has("value") && text(row.get("unit")) && STATUSES.contains(str(row, "status"))
                        && text(row.get("basis")) && text(row.get("source"))
                        && PolicyTime.validDay(str(row, "sourceDate"))
                        && version.equals(str(row, "policyVersion")));
                dates(row);
            }
            rows.put(table, list);
        }
        JsonNode mapping = null;
        for (JsonNode row : rows.get("assumptions")) {
            if ("eligibility.context.mapping".equals(row.get("key").textValue())) {
                mapping = row.get("value");
                break;
            }
        }
        require(mapping != null && mapping.isArray() && mapping.size() > 0);
        Map<String, JsonNode> schemes = new HashMap<>();
        List<String> schemeIds = new ArrayList<>();
        for (JsonNode row : mapping) {
            require(isObject(row) && text(row.get("schemeId")) && text(row.get("companyId"))
                    && text(row.get("sourceMatrix")) && row.get("gradeIds") != null && row.get("gradeIds").isArray()
                    && row.get("gradeIds").size() > 0);
            schemeIds.add(row.get("schemeId").textValue());
            schemes.putIfAbsent(row.get("schemeId").textValue(), row);
            gradeSet(row.get("gradeIds"));
        }
        unique(schemeIds);
        List<JsonNode> rules = rows.get("eligibilityRules");
        List<JsonNode> links = rows.get("schemeRuleLinks");
        List<JsonNode> prices = rows.get("pricePlans");
        List<JsonNode> allowances = rows.get("allowances");
        unique(rules.stream().map(r -> r.get("ruleId")).toList());
        unique(links.stream().map(r -> r.get("linkId")).toList());
        unique(prices.stream().map(r -> js(r.get("pricePlanId")) + "|" + js(r.get("priceEntryId"))).toList());
        unique(allowances.stream().map(r -> r.get("allowanceId")).toList());
        Map<String, JsonNode> ruleById = new HashMap<>();
        for (JsonNode rule : rules) {
            require(text(rule.get("ruleId")) && Set.of("include", "exclude").contains(str(rule, "effect"))
                    && text(rule.get("matchField")) && "equals".equals(str(rule, "operator"))
                    && text(rule.get("value")) && rule.get("gradeIds") != null && rule.get("gradeIds").isArray()
                    && rule.get("gradeIds").size() > 0);
            gradeSet(rule.get("gradeIds"));
            ruleById.put(rule.get("ruleId").textValue(), rule);
        }
        Set<String> linked = new HashSet<>();
        for (JsonNode link : links) {
            JsonNode rule = ruleById.get(str(link, "ruleId"));
            JsonNode scheme = schemes.get(str(link, "schemeId"));
            require(text(link.get("linkId")) && rule != null && scheme != null
                    && Objects.equals(str(link, "value"), str(link, "ruleId")));
            Set<String> schemeGrades = gradeSet(scheme.get("gradeIds"));
            require(schemeGrades.containsAll(gradeSet(rule.get("gradeIds")))
                    && Objects.equals(str(link, "source"), str(rule, "source"))
                    && Objects.equals(str(link, "sourceDate"), str(rule, "sourceDate"))
                    && Objects.equals(str(link, "status"), str(rule, "status")));
            linked.add(str(link, "ruleId"));
        }
        require(rules.stream().allMatch(rule -> linked.contains(rule.get("ruleId").textValue())));
        nonoverlapping(links, row -> List.of(str(row, "schemeId"), str(row, "ruleId")));
        for (JsonNode price : prices) {
            boolean byConfiguration = text(price.get("configurationId")) && !price.has("matchField")
                    && !price.has("matchValue");
            boolean byFact = !price.has("configurationId") && text(price.get("matchField"))
                    && text(price.get("matchValue"));
            require(text(price.get("pricePlanId")) && text(price.get("priceEntryId"))
                    && schemes.containsKey(str(price, "schemeId")) && (byConfiguration || byFact)
                    && finite(price.get("monthlyPoints")) && price.get("monthlyPoints").doubleValue() >= 0
                    && finite(price.get("value"))
                    && price.get("value").doubleValue() == price.get("monthlyPoints").doubleValue()
                    && "points/month".equals(str(price, "unit")));
        }
        for (JsonNode allowance : allowances) {
            JsonNode scheme = schemes.get(str(allowance, "schemeId"));
            require(text(allowance.get("allowanceId")) && scheme != null
                    && Objects.equals(scheme.get("companyId").textValue(), str(allowance, "companyId"))
                    && str(allowance, "gradeId") != null
                    && gradeSet(scheme.get("gradeIds")).contains(str(allowance, "gradeId"))
                    && finite(allowance.get("monthlyPoints")) && allowance.get("monthlyPoints").doubleValue() >= 0
                    && finite(allowance.get("value"))
                    && allowance.get("value").doubleValue() == allowance.get("monthlyPoints").doubleValue()
                    && "points/month".equals(str(allowance, "unit")));
        }
        nonoverlapping(prices, row -> Arrays.asList(str(row, "schemeId"), str(row, "configurationId"),
                str(row, "matchField"), str(row, "matchValue")));
        nonoverlapping(allowances, row -> str(row, "companyId") + "|" + str(row, "schemeId") + "|"
                + str(row, "gradeId"));
        Map<String, List<Row>> tables = new HashMap<>();
        for (String table : TABLES) {
            List<Row> out = new ArrayList<>();
            for (JsonNode row : rows.get(table)) {
                long to = row.has("effectiveTo") ? millis(row.get("effectiveTo")) : Long.MAX_VALUE;
                out.add(new Row((ObjectNode) row, millis(row.get("effectiveFrom")), to));
            }
            tables.put(table, List.copyOf(out));
        }
        long to = seed.has("effectiveTo") ? millis(seed.get("effectiveTo")) : Long.MAX_VALUE;
        return new PolicyVersion(version, millis(seed.get("effectiveFrom")), to, seed, tables);
    }

    /** Non-empty text grade ids, each unique; anything else is invalid. */
    private static Set<String> gradeSet(JsonNode grades) {
        Set<String> out = new HashSet<>();
        for (JsonNode grade : grades) {
            require(text(grade));
            require(out.add(grade.textValue()));
        }
        return out;
    }

    /** JavaScript template-literal coercion, so joined keys collide exactly as they do in Node. */
    private static String js(JsonNode node) {
        if (node == null) {
            return "undefined";
        }
        return node.isTextual() ? node.textValue() : node.isNull() ? "null" : node.toString();
    }
}
