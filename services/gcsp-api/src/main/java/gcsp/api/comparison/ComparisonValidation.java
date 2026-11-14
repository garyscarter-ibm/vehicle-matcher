package gcsp.api.comparison;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/** Port of the generator.js validators and JS value predicates; every refusal is a ComparisonInputError. */
final class ComparisonValidation {

    static final List<String> SIGNATURE_KEYS = List.of("stock.configuration.modelCodeField",
            "stock.configuration.codeSeparator", "stock.configuration.includePaintAndUpholstery",
            "stock.configuration.encoding");
    private static final Pattern INSTANT = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
    private static final Pattern CODE = Pattern.compile("[A-Z0-9]{2,16}");
    private static final Pattern DIGEST = Pattern.compile("[a-f0-9]{64}");
    private static final double MAX_SAFE = 9007199254740991.0;

    private ComparisonValidation() {}

    // ---- JS value predicates (a null node is an absent / undefined value) ----

    static JsonNode field(JsonNode node, String name) {
        return node != null && node.isObject() ? node.get(name) : null;
    }

    static boolean object(JsonNode n) {
        return n != null && n.isObject();
    }

    static boolean array(JsonNode n) {
        return n != null && n.isArray();
    }

    static boolean text(JsonNode n) {
        return n != null && n.isTextual() && jsText(n.textValue());
    }

    /** JS trim().length > 0: any character outside the JS whitespace and line terminator set. */
    static boolean jsText(String s) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            boolean space = (c >= 9 && c <= 13) || c == 0xFEFF || c == 0x2028 || c == 0x2029
                    || Character.getType(c) == Character.SPACE_SEPARATOR;
            if (!space) return true;
        }
        return false;
    }

    static boolean finite(JsonNode n) {
        return n != null && n.isNumber() && Double.isFinite(n.doubleValue());
    }

    static boolean safeInteger(JsonNode n) {
        if (!finite(n)) return false;
        double d = n.doubleValue();
        return d == Math.floor(d) && Math.abs(d) <= MAX_SAFE;
    }

    static boolean integer(JsonNode n) {
        return safeInteger(n) && n.doubleValue() >= 0;
    }

    static boolean anyInteger(JsonNode n) {
        return finite(n) && n.doubleValue() == Math.floor(n.doubleValue());
    }

    static boolean probability(JsonNode n) {
        return finite(n) && n.doubleValue() >= 0 && n.doubleValue() <= 1;
    }

    static boolean only(JsonNode n, String... fields) {
        if (!object(n)) return false;
        List<String> allowed = List.of(fields);
        for (Iterator<String> it = n.fieldNames(); it.hasNext(); ) {
            if (!allowed.contains(it.next())) return false;
        }
        return true;
    }

    static boolean range(JsonNode n) {
        return only(n, "min", "max") && integer(n.get("min")) && integer(n.get("max"))
                && n.get("min").doubleValue() <= n.get("max").doubleValue();
    }

    /** JS ===: numbers by value, scalars by content, containers never equal. */
    static boolean strictEq(JsonNode a, JsonNode b) {
        if (a == null || b == null) return a == null && b == null;
        if (a.isNumber() || b.isNumber()) return a.isNumber() && b.isNumber() && a.doubleValue() == b.doubleValue();
        if (a.isTextual() || b.isTextual()) return a.isTextual() && b.isTextual() && a.textValue().equals(b.textValue());
        if (a.isBoolean() || b.isBoolean()) return a.isBoolean() && b.isBoolean() && a.booleanValue() == b.booleanValue();
        return a.isNull() && b.isNull();
    }

    static boolean eq(JsonNode n, String s) {
        return n != null && n.isTextual() && n.textValue().equals(s);
    }

    static boolean includes(JsonNode list, JsonNode value) {
        if (!array(list)) return false;
        for (JsonNode item : list) {
            if (strictEq(item, value)) return true;
        }
        return false;
    }

    /** Math.round for doubles: ties toward +infinity, no long saturation. */
    static double round(double x) {
        double r = Math.floor(x);
        return x - r >= 0.5 ? r + 1 : r;
    }

    static OptionalLong parseInstant(String value) {
        if (value == null || !INSTANT.matcher(value).matches()) return OptionalLong.empty();
        try {
            LocalDateTime t = LocalDateTime.parse(value.substring(0, 23));
            return OptionalLong.of(t.toInstant(ZoneOffset.UTC).toEpochMilli());
        } catch (RuntimeException e) {
            return OptionalLong.empty();
        }
    }

    static void require(boolean condition, String key) {
        require(condition, key, "invalid-policy");
    }

    static void require(boolean condition, String key, String code) {
        if (!condition) throw new ComparisonInputError(code, key);
    }

    private static void weighted(JsonNode rows, String key, Predicate<JsonNode> validate) {
        boolean ok = array(rows) && rows.size() > 0;
        double total = 0;
        if (ok) {
            for (JsonNode row : rows) {
                JsonNode weight = field(row, "weight");
                if (!(object(row) && finite(weight) && weight.doubleValue() > 0 && validate.test(row))) {
                    ok = false;
                    break;
                }
                total += weight.doubleValue();
            }
        }
        require(ok && Double.isFinite(total), key);
    }

    static List<String> contextKey(JsonNode row) {
        return List.of(String.valueOf(field(row, "companyId")), String.valueOf(field(row, "schemeId")),
                String.valueOf(field(row, "gradeId")));
    }

    // ---- validateValues ----

    static void validateValues(Map<String, JsonNode> values) {
        java.util.function.Function<String, JsonNode> value = key -> values.get("comparison." + key);
        JsonNode registry = values.get("employee.recommendation.v1");
        JsonNode regPreferences = field(registry, "preferences");
        JsonNode regEssentials = field(registry, "essentials");
        JsonNode minimum = values.get("brief.slider.minimum");
        JsonNode maximum = values.get("brief.slider.maximum");
        require(object(regPreferences) && object(regEssentials), "employee.recommendation.v1");
        require(finite(minimum) && minimum.doubleValue() == 0 && finite(maximum) && maximum.doubleValue() == 100,
                "brief.slider", "unsupported-policy");
        Predicate<JsonNode> slider = item -> anyInteger(item) && item.doubleValue() >= 0 && item.doubleValue() <= 100;

        JsonNode maxRows = value.apply("maximumGeneratedRows");
        require(integer(maxRows) && maxRows.doubleValue() > 0, "comparison.maximumGeneratedRows");
        JsonNode cohort = value.apply("cohortSize");
        require(integer(cohort) && cohort.doubleValue() > 0 && cohort.doubleValue() <= maxRows.doubleValue(),
                "comparison.cohortSize");
        JsonNode seeds = value.apply("seeds");
        boolean seedsOk = array(seeds) && seeds.size() > 0;
        if (seedsOk) {
            Set<String> seen = new HashSet<>();
            for (JsonNode seed : seeds) {
                seedsOk &= text(seed) || safeInteger(seed);
                if (seedsOk) seedsOk = seen.add(gcsp.api.evidence.CanonicalJson.canonical(seed));
                if (!seedsOk) break;
            }
        }
        require(seedsOk, "comparison.seeds");
        JsonNode startsAt = value.apply("startsAt");
        OptionalLong start = startsAt != null && startsAt.isTextual() ? parseInstant(startsAt.textValue()) : OptionalLong.empty();
        require(start.isPresent(), "comparison.startsAt");
        JsonNode horizon = value.apply("horizonDays");
        require(integer(horizon) && horizon.doubleValue() > 0
                && (double) start.getAsLong() + horizon.doubleValue() * 86400000 <= 8640000000000000.0,
                "comparison.horizonDays");
        JsonNode renewal = value.apply("renewalDays");
        require(range(renewal) && renewal.get("max").doubleValue() <= horizon.doubleValue(), "comparison.renewalDays");
        weighted(value.apply("gradeDistribution"), "comparison.gradeDistribution",
                row -> only(row, "companyId", "schemeId", "gradeId", "weight") && text(row.get("companyId"))
                        && text(row.get("schemeId")) && text(row.get("gradeId")));
        Set<List<String>> contexts = new HashSet<>();
        for (JsonNode row : value.apply("gradeDistribution")) contexts.add(contextKey(row));
        require(contexts.size() == value.apply("gradeDistribution").size(), "comparison.gradeDistribution");
        JsonNode multiplier = value.apply("pointsAllowanceMultiplier");
        require(finite(multiplier) && multiplier.doubleValue() >= 0, "comparison.pointsAllowanceMultiplier");
        JsonNode needs = value.apply("needs.v1");
        require(only(needs, "essentials", "preferences") && object(needs.get("preferences"))
                && needs.get("preferences").size() > 0, "comparison.needs.v1");
        weighted(needs.get("essentials"), "comparison.needs.v1", row -> only(row, "weight", "value")
                && object(row.get("value")) && essentialsValid(row.get("value"), regEssentials));
        for (Iterator<Map.Entry<String, JsonNode>> it = needs.get("preferences").fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode definition = regPreferences.get(entry.getKey());
            require(object(definition), "comparison.needs.v1");
            boolean sliderType = eq(definition.get("type"), "slider");
            weighted(entry.getValue(), "comparison.needs.v1", row -> only(row, "weight", "value")
                    && (sliderType ? slider.test(row.get("value")) : includes(definition.get("values"), row.get("value"))));
        }
        weighted(value.apply("importanceDistribution"), "comparison.importanceDistribution",
                row -> only(row, "weight", "value") && slider.test(row.get("value")));
        JsonNode noise = value.apply("briefNoise.v1");
        require(only(noise, "accuratePreferenceProbability", "preserveEssentials")
                && probability(noise.get("accuratePreferenceProbability"))
                && noise.get("preserveEssentials") != null && noise.get("preserveEssentials").isBoolean()
                && noise.get("preserveEssentials").booleanValue(), "comparison.briefNoise.v1");
        weighted(value.apply("accessGroups"), "comparison.accessGroups",
                row -> only(row, "id", "weight", "accessSeconds", "responseSeconds") && text(row.get("id"))
                        && range(row.get("accessSeconds")) && range(row.get("responseSeconds")));
        Set<String> groupIds = new HashSet<>();
        for (JsonNode row : value.apply("accessGroups")) groupIds.add(row.get("id").textValue());
        require(groupIds.size() == value.apply("accessGroups").size(), "comparison.accessGroups");
        require(probability(value.apply("buddyUptake")), "comparison.buddyUptake");
        JsonNode cars = value.apply("carsPerEmployee");
        require(finite(cars) && cars.doubleValue() >= 0, "comparison.carsPerEmployee");
        double stockCount = round(cohort.doubleValue() * cars.doubleValue());
        require(Math.abs(stockCount) <= MAX_SAFE && stockCount == Math.floor(stockCount)
                && cohort.doubleValue() + stockCount <= maxRows.doubleValue(), "comparison.carsPerEmployee");
        weighted(value.apply("modelLineMix"), "comparison.modelLineMix",
                row -> only(row, "modelLine", "weight") && text(row.get("modelLine")));
        Set<String> lines = new HashSet<>();
        for (JsonNode row : value.apply("modelLineMix")) lines.add(row.get("modelLine").textValue());
        require(lines.size() == value.apply("modelLineMix").size(), "comparison.modelLineMix");
        JsonNode cadence = value.apply("releaseCadence");
        require(only(cadence, "firstReleaseDay", "intervalDays", "batchSize") && integer(cadence.get("firstReleaseDay"))
                && integer(cadence.get("intervalDays")) && cadence.get("intervalDays").doubleValue() > 0
                && integer(cadence.get("batchSize")) && cadence.get("batchSize").doubleValue() > 0,
                "comparison.releaseCadence");
        double first = cadence.get("firstReleaseDay").doubleValue();
        require(first <= horizon.doubleValue() && (stockCount == 0
                || first + Math.floor((stockCount - 1) / cadence.get("batchSize").doubleValue())
                        * cadence.get("intervalDays").doubleValue() <= horizon.doubleValue()),
                "comparison.releaseCadence");
        boolean signature = true;
        for (String key : SIGNATURE_KEYS) signature &= values.containsKey(key);
        require(signature && eq(values.get(SIGNATURE_KEYS.get(0)), "vgModelCode")
                && eq(values.get(SIGNATURE_KEYS.get(1)), ",")
                && values.get(SIGNATURE_KEYS.get(2)) != null && values.get(SIGNATURE_KEYS.get(2)).isBoolean()
                && values.get(SIGNATURE_KEYS.get(2)).booleanValue()
                && eq(values.get(SIGNATURE_KEYS.get(3)), "base64-padded"), "stock.configuration", "unsupported-policy");
        JsonNode buddy = values.get("hold.buddy.durationSeconds");
        require(integer(buddy) && buddy.doubleValue() > 0, "hold.buddy.durationSeconds");
    }

    private static boolean essentialsValid(JsonNode requirements, JsonNode registryEssentials) {
        for (Iterator<Map.Entry<String, JsonNode>> it = requirements.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> entry = it.next();
            JsonNode definition = registryEssentials.get(entry.getKey());
            JsonNode requirement = entry.getValue();
            if (!object(definition) || !only(requirement, "operator", "value", "unit")
                    || !strictEq(requirement.get("operator"), definition.get("operator"))
                    || !strictEq(requirement.get("unit"), definition.get("unit"))) {
                return false;
            }
            JsonNode v = requirement.get("value");
            String type = definition.get("type") != null && definition.get("type").isTextual()
                    ? definition.get("type").textValue() : "";
            boolean valid = switch (type) {
                case "number" -> finite(v) && v.doubleValue() >= 0 && (!entry.getKey().equals("seats") || anyInteger(v));
                case "boolean" -> v != null && v.isBoolean();
                case "list" -> array(v) && v.size() > 0 && allText(v);
                case "enum" -> includes(definition.get("values"), v);
                default -> text(v);
            };
            if (!valid) return false;
        }
        return true;
    }

    private static boolean allText(JsonNode list) {
        for (JsonNode item : list) {
            if (!text(item)) return false;
        }
        return true;
    }

    // ---- validateConfiguration / validatePolicy ----

    static void validateConfiguration(JsonNode row, Map<String, JsonNode> values) {
        String key = "comparison.configurationSet.v1";
        JsonNode identity = field(row, "canonicalIdentity");
        JsonNode provenance = field(identity, "provenance");
        JsonNode sourceContext = field(row, "sourceContext");
        JsonNode refs = field(sourceContext, "sourceRefs");
        String modelCodeField = values.get(SIGNATURE_KEYS.get(0)).textValue();
        JsonNode modelCode = field(identity, modelCodeField);
        JsonNode codes = field(identity, "factoryOptionCodes");
        boolean ok = object(row) && text(row.get("modelLine")) && text(row.get("snapshotVersion"))
                && object(row.get("configuration")) && object(sourceContext) && array(refs) && allText(refs)
                && refs.size() > 0 && object(identity) && object(provenance)
                && (eq(provenance.get("kind"), "synthetic") || eq(provenance.get("kind"), "observed"))
                && text(provenance.get("source")) && modelCode != null && modelCode.isTextual()
                && CODE.matcher(modelCode.textValue()).matches() && array(codes) && codes.size() > 0;
        List<String> sorted = new ArrayList<>();
        if (ok) {
            for (JsonNode code : codes) {
                ok &= code.isTextual() && CODE.matcher(code.textValue()).matches();
                if (!ok) break;
                sorted.add(code.textValue());
            }
            ok = ok && new HashSet<>(sorted).size() == sorted.size();
        }
        require(ok, key);
        sorted.sort(null);
        String signature = modelCode.textValue() + ":" + String.join(values.get(SIGNATURE_KEYS.get(1)).textValue(), sorted);
        String expected = Base64.getEncoder().encodeToString(signature.getBytes(StandardCharsets.UTF_8));
        require(eq(row.get("configurationId"), expected), key, "configuration-signature");
    }

    static void validatePolicy(ComparisonPolicy policy, Map<String, JsonNode> values) {
        require(jsText(policy.policyVersion()), "policy");
        validateValues(values);
        List<String> keys = new ArrayList<>(ComparisonPolicy.COMPARISON_KEYS);
        keys.addAll(ComparisonPolicy.EXTRA_KEYS);
        for (String key : keys) {
            JsonNode row = policy.assumptions().get(key);
            JsonNode status = field(row, "status");
            require(object(row) && eq(row.get("key"), key) && eq(row.get("policyVersion"), policy.policyVersion())
                    && text(row.get("unit")) && (eq(status, "assumed") || eq(status, "verified"))
                    && text(row.get("basis")) && text(row.get("source")) && text(row.get("sourceDate")),
                    key, "incoherent-policy");
        }
        JsonNode multiplier = values.get("comparison.pointsAllowanceMultiplier");
        for (JsonNode grade : values.get("comparison.gradeDistribution")) {
            JsonNode allowance = null;
            for (JsonNode candidate : policy.allowances()) {
                if (contextKey(candidate).equals(contextKey(grade))) {
                    allowance = candidate;
                    break;
                }
            }
            require(allowance != null && eq(allowance.get("policyVersion"), policy.policyVersion())
                    && finite(allowance.get("monthlyPoints")) && allowance.get("monthlyPoints").doubleValue() >= 0
                    && eq(allowance.get("unit"), "points/month"), "comparison.gradeDistribution", "allowance-unavailable");
            require(Double.isFinite(allowance.get("monthlyPoints").doubleValue() * multiplier.doubleValue()),
                    "comparison.pointsAllowanceMultiplier");
        }
        String setKey = "comparison.configurationSet.v1";
        JsonNode set = values.get(setKey);
        JsonNode source = policy.configurationSource();
        JsonNode kind = field(set, "kind");
        require(object(set) && (eq(kind, "reviewed-fixtures") || eq(kind, "corpus")) && text(set.get("datasetId"))
                && text(set.get("version")) && text(set.get("basis")) && text(set.get("reviewedOn"))
                && array(set.get("configurations")) && set.get("configurations").size() > 0
                && policy.configurations().size() == set.get("configurations").size()
                && strictEq(source.get("kind"), kind) && strictEq(source.get("datasetId"), set.get("datasetId"))
                && strictEq(source.get("version"), set.get("version"))
                && (!eq(kind, "corpus") || (set.get("manifestDigest") != null && set.get("manifestDigest").isTextual()
                        && DIGEST.matcher(set.get("manifestDigest").textValue()).matches())), setKey);
        Set<String> ids = new HashSet<>();
        for (JsonNode row : policy.configurations()) ids.add(String.valueOf(row.get("configurationId")));
        require(ids.size() == policy.configurations().size(), setKey);
        for (JsonNode row : policy.configurations()) {
            validateConfiguration(row, values);
            boolean referenced = false;
            for (JsonNode reference : set.get("configurations")) {
                referenced |= strictEq(reference.get("configurationId"), row.get("configurationId"))
                        && strictEq(reference.get("snapshotVersion"), row.get("snapshotVersion"))
                        && strictEq(reference.get("modelLine"), row.get("modelLine"));
            }
            require(referenced, setKey, "configuration-unavailable");
        }
        for (JsonNode mix : values.get("comparison.modelLineMix")) {
            boolean found = false;
            for (JsonNode row : policy.configurations()) found |= strictEq(row.get("modelLine"), mix.get("modelLine"));
            require(found, "comparison.modelLineMix", "configuration-unavailable");
        }
    }
}
