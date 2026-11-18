package gcsp.api.comparison;

import static gcsp.api.comparison.ComparisonValidation.field;
import static gcsp.api.comparison.ComparisonValidation.require;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.evidence.CanonicalJson;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** The seeded comparison inputs, a byte-faithful port of generateComparisonInputs in server/gcsp/comparison/generator.js. */
public record ComparisonInputs(ArrayNode employees, ArrayNode stock, ArrayNode releaseSchedule, ObjectNode manifest) {

    private static final JsonNodeFactory JSON = JsonNodeFactory.instance;
    private static final String VERSION = ComparisonPolicy.GENERATOR_VERSION;
    private static final Set<String> OVERLAY_EXCLUDED = Set.of("comparison.gradeDistribution", "comparison.configurationSet.v1");
    private static final long DAY_MS = 86400000L;

    public static ComparisonInputs generate(String seed, ComparisonPolicy policy, ObjectNode overlay) {
        return generate(seed == null ? null : JSON.textNode(seed), policy, overlay);
    }

    /** The seed is a nonblank string or a safe integer; the overlay may be null (empty) and is never modified. */
    public static ComparisonInputs generate(JsonNode seed, ComparisonPolicy policy, ObjectNode overlay) {
        require(ComparisonValidation.text(seed) || ComparisonValidation.safeInteger(seed), "seed", "invalid-seed");
        require(policy != null && policy.assumptions() != null, "policy", "policy-unavailable");
        ObjectNode overrides = overlay == null ? JSON.objectNode() : overlay.deepCopy();
        for (Iterator<String> it = overrides.fieldNames(); it.hasNext(); ) {
            String key = it.next();
            require((ComparisonPolicy.COMPARISON_KEYS.contains(key) && !OVERLAY_EXCLUDED.contains(key))
                    || key.equals("hold.buddy.durationSeconds"), "overlay", "invalid-overlay");
        }
        Map<String, JsonNode> values = policy.values();
        overrides.fields().forEachRemaining(e -> values.put(e.getKey(), e.getValue()));
        ComparisonValidation.validatePolicy(policy, values);
        return new Generation(seed, policy, values, overrides).run();
    }

    private record Generation(JsonNode seed, ComparisonPolicy policy, Map<String, JsonNode> values, ObjectNode overrides) {

        JsonNode get(String key) {
            return values.get("comparison." + key);
        }

        ComparisonInputs run() {
            JsonNode needs = get("needs.v1");
            double multiplier = get("pointsAllowanceMultiplier").doubleValue();
            double accuracy = get("briefNoise.v1").get("accuratePreferenceProbability").doubleValue();
            String startsAt = get("startsAt").textValue();
            int cohort = get("cohortSize").intValue();
            TreeMap<String, JsonNode> preferenceChoices = new TreeMap<>(Generation::localeCompare);
            needs.get("preferences").fields().forEachRemaining(e -> preferenceChoices.put(e.getKey(), e.getValue()));
            ArrayNode employees = JSON.arrayNode();
            for (int index = 0; index < cohort; index++) {
                JsonNode grade = choose(get("gradeDistribution"), "employee", index, "grade");
                JsonNode allowance = null;
                for (JsonNode candidate : policy.allowances()) {
                    if (ComparisonValidation.contextKey(candidate).equals(ComparisonValidation.contextKey(grade))) {
                        allowance = candidate;
                        break;
                    }
                }
                ObjectNode essentials = choose(needs.get("essentials"), "employee", index, "essentials").get("value").deepCopy();
                ObjectNode preferences = JSON.objectNode();
                ObjectNode stated = JSON.objectNode();
                for (Map.Entry<String, JsonNode> entry : preferenceChoices.entrySet()) {
                    String key = entry.getKey();
                    JsonNode choices = entry.getValue();
                    JsonNode value = choose(choices, "employee", index, key, "value").get("value");
                    JsonNode importance = choose(get("importanceDistribution"), "employee", index, key, "importance").get("value");
                    ObjectNode preference = JSON.objectNode();
                    preference.set("value", value.deepCopy());
                    preference.set("importance", importance.deepCopy());
                    preferences.set(key, preference);
                    boolean accurate = draw("employee", index, key, "accuracy") < accuracy;
                    ObjectNode brief = JSON.objectNode();
                    brief.set("value", accurate ? value.deepCopy()
                            : altered(choices, value, "employee", index, key, "noise-value"));
                    brief.set("importance", accurate ? importance.deepCopy()
                            : altered(get("importanceDistribution"), importance, "employee", index, key, "noise-importance"));
                    brief.put("valueState", "confirmed").put("importanceState", "confirmed")
                            .put("source", "synthetic-stated-brief");
                    stated.set(key, brief);
                }
                JsonNode group = choose(get("accessGroups"), "employee", index, "access-group");
                boolean buddy = draw("employee", index, "buddy") < get("buddyUptake").doubleValue();
                String employeeId = "fictional-employee-" + digest(array(seed, index)).substring(0, 24);
                String renewalAt = instant(startsAt, between(get("renewalDays"), "employee", index, "renewal"));
                ObjectNode statedEssentials = JSON.objectNode();
                essentials.fields().forEachRemaining(e -> {
                    ObjectNode requirement = ((ObjectNode) e.getValue()).deepCopy();
                    requirement.put("state", "confirmed").put("source", "synthetic-stated-brief");
                    statedEssentials.set(e.getKey(), requirement);
                });
                ObjectNode employee = JSON.objectNode();
                employee.put("employeeId", employeeId).put("fictional", true);
                employee.set("companyId", grade.get("companyId").deepCopy());
                employee.set("schemeId", grade.get("schemeId").deepCopy());
                employee.set("gradeId", grade.get("gradeId").deepCopy());
                employee.set("pointsAllowance", number(allowance.get("monthlyPoints").doubleValue() * multiplier));
                employee.set("pointsUnit", allowance.get("unit").deepCopy());
                employee.put("renewalAt", renewalAt);
                ObjectNode underlying = employee.putObject("underlyingNeeds");
                underlying.set("essentials", essentials);
                underlying.set("preferences", preferences);
                ObjectNode brief = employee.putObject("statedBrief");
                brief.put("schemaVersion", 1).put("briefVersion", 1).put("requiredBy", renewalAt);
                brief.set("essentials", statedEssentials);
                brief.set("preferences", stated);
                employee.set("accessGroup", group.get("id").deepCopy());
                employee.set("accessSeconds", number(between(group.get("accessSeconds"), "employee", index, "access")));
                employee.set("responseSeconds", number(between(group.get("responseSeconds"), "employee", index, "response")));
                employee.put("buddyParticipation", buddy);
                employees.add(employee);
            }
            int count = (int) ComparisonValidation.round(get("cohortSize").doubleValue() * get("carsPerEmployee").doubleValue());
            ArrayNode stock = JSON.arrayNode();
            List<String> orderUuids = new ArrayList<>();
            for (int index = 0; index < count; index++) {
                JsonNode modelLine = choose(get("modelLineMix"), "stock", index, "model").get("modelLine");
                List<JsonNode> matching = new ArrayList<>();
                for (JsonNode row : policy.configurations()) {
                    if (ComparisonValidation.strictEq(row.get("modelLine"), modelLine)) matching.add(row);
                }
                JsonNode selected = matching.get((int) Math.floor(draw("stock", index, "configuration") * matching.size()));
                ObjectNode car = JSON.objectNode();
                String uuid = orderUuid(index);
                orderUuids.add(uuid);
                car.put("orderUuid", uuid);
                car.set("configurationId", selected.get("configurationId").deepCopy());
                car.set("modelLine", modelLine.deepCopy());
                car.set("eligibilityModelKey", modelLine.deepCopy());
                car.set("snapshotVersion", selected.get("snapshotVersion").deepCopy());
                car.set("configuration", selected.get("configuration").deepCopy());
                car.put("identityKind", "synthetic");
                car.set("sourceKind", policy.configurationSource().get("kind").deepCopy());
                stock.add(car);
            }
            require(new HashSet<>(orderUuids).size() == orderUuids.size(), "orderUuid", "identity-collision");
            ArrayNode releases = JSON.arrayNode();
            JsonNode cadence = get("releaseCadence");
            int batch = cadence.get("batchSize").intValue();
            for (int index = 0; index < stock.size(); index += batch) {
                int releaseIndex = releases.size();
                ObjectNode release = JSON.objectNode();
                release.put("releaseId", "fictional-release-" + digest(array(seed, releaseIndex)).substring(0, 24));
                release.put("at", instant(startsAt, cadence.get("firstReleaseDay").doubleValue()
                        + releaseIndex * cadence.get("intervalDays").doubleValue()));
                ArrayNode ids = release.putArray("orderUuids");
                orderUuids.subList(index, Math.min(index + batch, orderUuids.size())).forEach(ids::add);
                releases.add(release);
            }
            ObjectNode manifest = manifest(employees, stock, releases);
            ObjectNode inputs = JSON.objectNode();
            inputs.set("employees", employees);
            inputs.set("stock", stock);
            inputs.set("releaseSchedule", releases);
            manifest.put("inputHash", digest(inputs));
            return new ComparisonInputs(employees, stock, releases, manifest);
        }

        private ObjectNode manifest(ArrayNode employees, ArrayNode stock, ArrayNode releases) {
            List<JsonNode> rows = new ArrayList<>(policy.assumptions().values());
            rows.sort((a, b) -> localeCompare(a.get("key").textValue(), b.get("key").textValue()));
            ArrayNode assumptions = JSON.arrayNode();
            for (JsonNode source : rows) {
                ObjectNode row = ((ObjectNode) source).deepCopy();
                String key = source.get("key").textValue();
                row.set("value", values.get(key).deepCopy());
                if (overrides.has(key)) {
                    row.put("overlay", true);
                    row.set("baselineValue", source.get("value").deepCopy());
                }
                assumptions.add(row);
            }
            ArrayNode allowances = JSON.arrayNode();
            policy.allowances().forEach(row -> allowances.add(row.deepCopy()));
            ArrayNode configurations = JSON.arrayNode();
            policy.configurations().forEach(row -> configurations.add(row));
            ObjectNode assumptionRows = JSON.objectNode();
            policy.assumptions().forEach(assumptionRows::set);
            ObjectNode policyBody = JSON.objectNode();
            policyBody.set("assumptions", assumptionRows);
            policyBody.set("allowances", allowances);
            ObjectNode manifest = JSON.objectNode();
            manifest.set("seed", seed.deepCopy());
            manifest.set("seeds", get("seeds").deepCopy());
            manifest.put("policyVersion", policy.policyVersion());
            manifest.put("generatorVersion", VERSION);
            manifest.set("overlay", overrides.deepCopy());
            manifest.put("overlayHash", digest(overrides));
            manifest.put("policyHash", digest(policyBody));
            manifest.put("configurationHash", digest(configurations));
            manifest.set("configurationSource", policy.configurationSource().deepCopy());
            manifest.set("startsAt", get("startsAt").deepCopy());
            manifest.set("horizonDays", get("horizonDays").deepCopy());
            manifest.set("assumptions", assumptions);
            manifest.set("allowances", allowances.deepCopy());
            ObjectNode counts = manifest.putObject("counts");
            counts.put("employees", employees.size()).put("stock", stock.size()).put("releases", releases.size());
            ArrayNode limitations = manifest.putArray("limitations");
            limitations.add("Fictional cohort and assumed behaviour; not BMW employee data.");
            limitations.add("Calculated fit is not observed satisfaction. No route or outcome is generated.");
            return manifest;
        }

        // ---- seeded draws ----

        private ArrayNode array(JsonNode first, Object... path) {
            ArrayNode out = JSON.arrayNode();
            out.add(first.deepCopy());
            for (Object item : path) {
                if (item instanceof Integer i) out.add(i);
                else out.add((String) item);
            }
            return out;
        }

        private double draw(Object... path) {
            ArrayNode input = JSON.arrayNode().add(VERSION).add(seed.deepCopy());
            for (Object item : path) {
                if (item instanceof Integer i) input.add(i);
                else input.add((String) item);
            }
            return Long.parseLong(digest(input).substring(0, 8), 16) / 4294967296.0;
        }

        private JsonNode choose(JsonNode rows, Object... path) {
            double total = 0;
            for (JsonNode row : rows) total += row.get("weight").doubleValue();
            double target = draw(path) * total;
            double running = 0;
            for (JsonNode row : rows) {
                running += row.get("weight").doubleValue();
                if (target < running) return row;
            }
            return rows.get(rows.size() - 1);
        }

        private double between(JsonNode bounds, Object... path) {
            double min = bounds.get("min").doubleValue();
            return min + Math.floor(draw(path) * (bounds.get("max").doubleValue() - min + 1));
        }

        private JsonNode altered(JsonNode rows, JsonNode current, Object... path) {
            ArrayNode alternatives = JSON.arrayNode();
            String currentText = CanonicalJson.canonical(current);
            for (JsonNode row : rows) {
                if (!CanonicalJson.canonical(row.get("value")).equals(currentText)) alternatives.add(row);
            }
            return alternatives.size() > 0 ? choose(alternatives, path).get("value").deepCopy() : current.deepCopy();
        }

        private String orderUuid(int index) {
            ArrayNode input = JSON.arrayNode().add(VERSION).add(seed.deepCopy()).add("order").add(index);
            byte[] bytes = HexFormat.of().parseHex(digest(input).substring(0, 32));
            bytes[6] = (byte) ((bytes[6] & 0x0f) | 0x40);
            bytes[8] = (byte) ((bytes[8] & 0x3f) | 0x80);
            String hex = HexFormat.of().formatHex(bytes);
            return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-"
                    + hex.substring(16, 20) + "-" + hex.substring(20);
        }

        /** Policy keys are ASCII; ICU orders those case-insensitively with lowercase first (checked on the retained seed). */
        private static int localeCompare(String a, String b) {
            int folded = a.toLowerCase(java.util.Locale.ROOT).compareTo(b.toLowerCase(java.util.Locale.ROOT));
            if (folded != 0) return folded;
            for (int i = 0; i < a.length(); i++) {
                if (a.charAt(i) != b.charAt(i)) return Character.isLowerCase(a.charAt(i)) ? -1 : 1;
            }
            return 0;
        }
    }

    private static String digest(JsonNode value) {
        return CanonicalJson.digest(value);
    }

    private static JsonNode number(double value) {
        return value == Math.rint(value) && Math.abs(value) < 9.007199254740992E15
                ? JSON.numberNode((long) value) : JSON.numberNode(value);
    }

    /** new Date(Date.parse(startsAt) + days * 86400000).toISOString() */
    private static String instant(String startsAt, double days) {
        long base = ComparisonValidation.parseInstant(startsAt).getAsLong();
        ZonedDateTime t = Instant.ofEpochMilli(base + (long) (days * DAY_MS)).atZone(ZoneOffset.UTC);
        int year = t.getYear();
        String y = year >= 0 && year <= 9999 ? String.format("%04d", year) : (year < 0 ? "-" : "+") + String.format("%06d", Math.abs(year));
        return String.format("%s-%02d-%02dT%02d:%02d:%02d.%03dZ", y, t.getMonthValue(), t.getDayOfMonth(), t.getHour(),
                t.getMinute(), t.getSecond(), t.getNano() / 1_000_000);
    }
}
