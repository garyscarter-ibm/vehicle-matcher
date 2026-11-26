package gcsp.api.supply;

import static gcsp.api.supply.GeneratedJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

/** Pure stock generation over caller-supplied, pinned configuration and policy evidence. */
public final class GeneratedStockGenerator {
    private static final String VERSION = "stock-generator.v1";
    private static final String NAMESPACE = "synthetic:" + VERSION;
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final Set<String> RESERVED = Set.of("stockIdentityKind", "modelLine", "leadTimeWeeks", "confirmedDeliveryWeek", "plannedRelease",
            "syntheticIdentity", "syntheticVehicleId", "configurationHash", "generatorVersion", "policyVersion");
    private GeneratedStockGenerator() {}

    public static JsonNode generate(JsonNode request) {
        try { return new Engine(request == null ? F.nullNode() : request).generate(); }
        catch (Refusal r) {
            ObjectNode out = obj("status", r.status);
            if (r.code != null) out.put("code", r.code);
            if (r.reason != null) out.put("reason", r.reason);
            return out;
        } catch (RuntimeException e) { return obj("status", "unavailable", "code", "stock-generation-unavailable"); }
    }

    private static final class Binding {
        final JsonNode binding, record, source;
        final String id, model, colour;
        final List<JsonNode> images;
        ObjectNode extra;
        Binding(JsonNode binding, JsonNode source) {
            this.binding = binding; this.source = source; record = source.path("record");
            id = binding.path("configurationId").asText(); model = binding.path("modelLineId").asText(); colour = binding.path("colour").asText();
            images = list(source.path("images")).stream().filter(i -> id.equals(i.path("configurationId").asText())
                    && i.path("asset").asText().matches("assets/gcsp-vehicle-evidence/[a-f0-9]{64}\\.webp")
                    && List.of("representative-model", "representative-configuration").contains(i.path("fidelity").asText())
                    && i.path("fidelity").equals(i.path("role"))).toList();
        }
        String key() { return extra == null || !extra.path("eligibilityModelKey").has("value") ? null : extra.path("eligibilityModelKey").path("value").asText(null); }
    }

    private static final class Model {
        final String id, key;
        final JsonNode observed;
        final LinkedHashMap<String, Double> covered = new LinkedHashMap<>();
        final Map<String, Double> debt = new HashMap<>();
        final Map<String, Integer> colours = new HashMap<>();
        double weight;
        int cars;
        Model(String id, String key, JsonNode observed) { this.id = id; this.key = key; this.observed = observed; }
    }

    private record Car(String id, Binding binding, int lead, int tranche) {}
    private static final class Portion {
        final String key;
        final double fraction;
        final long tie;
        int count;
        Portion(String key, double amount, long tie) { this.key = key; this.count = (int) Math.floor(amount); this.fraction = amount % 1; this.tie = tie; }
    }

    private static final class Engine {
        final JsonNode request, plan, assumptions, guarantee;
        final String runId, seed, policyVersion, stockAccount, clock, observedAt;
        final ArrayNode entropy;
        final Comparator<String> order = localeOrder();
        final List<Model> models = new ArrayList<>();
        final LinkedHashMap<String, Binding> bindings = new LinkedHashMap<>();
        final List<Car> cars = new ArrayList<>();
        final Set<String> qualified = new HashSet<>();
        final ArrayNode provenance = F.arrayNode();
        List<String> dates;
        String requestDigest, manifestDigest;
        int trancheSize, total, needKeys, substitutions;
        double observedTotal, weightTotal;
        ZoneId zone;

        Engine(JsonNode request) {
            this.request = request; plan = request.path("plan"); assumptions = request.path("assumptions");
            guarantee = request.path("guarantee"); runId = request.path("runId").asText(); seed = request.path("seed").asText();
            policyVersion = request.path("policyVersion").asText(); stockAccount = request.path("stockAccount").asText();
            clock = request.path("clockInstant").asText();
            if (!request.isObject() || !List.of("runId", "seed", "policyVersion", "stockAccount").stream().allMatch(k -> text(request.path(k)))
                    || !validPlan(plan) || !validVisibility(request) || !validGuarantee(guarantee)) invalid("invalid-generator-input");
            String normalized;
            try { normalized = ISO.format(Instant.parse(clock)); }
            catch (RuntimeException e) { throw new Refusal("conflict", null, "run-source-version-mismatch"); }
            observedAt = normalized; entropy = arr(VERSION, runId, seed, policyVersion);
        }

        JsonNode generate() {
            ObjectNode digestInput = obj("generatorVersion", VERSION, "runId", runId, "seed", seed, "policyVersion", policyVersion,
                    "plan", plan, "stockAccount", stockAccount, "clockInstant", clock);
            if (request.has("visibility")) digestInput.set("visibility", request.path("visibility"));
            if (hasGuarantee()) digestInput.set("guarantee", descriptor());
            requestDigest = digest(digestInput);
            JsonNode size = policy("supply.release.size"), weekly = policy("supply.weeklyReleaseVolume"), cadence = policy("supply.release.cadence");
            for (String id : names(plan.path("aggregateKeys"))) {
                String key = plan.path("aggregateKeys").path(id).asText(); models.add(new Model(id, key, policy(key)));
            }
            if (!positive(size) || size.asDouble() > 100000 || !exact(weekly, "min", "max") || !positive(weekly.path("min"))
                    || !positive(weekly.path("max")) || weekly.path("max").asInt() < weekly.path("min").asInt() || weekly.path("max").asDouble() > 100000) invalid("unsupported-release-policy");
            trancheSize = size.asInt();
            dates = releaseDates(clock, cadence); zone = ZoneId.of(cadence.path("timeZone").asText());
            total = weekly.path("min").asInt() + (int) ordinal(append(entropy, "weekly-volume"), weekly.path("max").asInt() - weekly.path("min").asInt() + 1);
            models.sort((a, b) -> order.compare(a.id, b.id));
            for (Model model : models) {
                if (!validAggregate(model.observed, model.id, plan)) invalid("unsupported-stock-aggregate");
                observedTotal += model.observed.path("carCount").asDouble();
                String source = model.observed.path("sourceKind").asText();
                String status = assumptions.path(model.key).path("status").asText();
                boolean accepted = switch (plan.path("kind").asText()) {
                    case "synthetic-fixture" -> source.equals("synthetic-fixture") && status.equals("assumed");
                    case "retained-corpus" -> source.equals("assumed-aggregate") && status.equals("assumed") || source.equals("observed-aggregate") && status.equals("observed aggregate");
                    default -> source.equals("observed-aggregate") && status.equals("observed aggregate");
                };
                if (!accepted) invalid("aggregate-provenance-mismatch");
            }
            if (observedTotal == 0) invalid("unsupported-stock-aggregate");
            loadConfigurations();
            if (hasGuarantee() && guarantee.path("minimumCars").asDouble() > trancheSize) invalid("unsupported-release-guarantee");
            JsonNode mix = assumptions.path("supply.release.modelMix").path("value");
            boolean mixed = mix.isObject() && models.stream().allMatch(m -> finite(mix.path(m.id)) && mix.path(m.id).asDouble() >= 0)
                    && models.stream().anyMatch(m -> mix.path(m.id).asDouble() > 0);
            for (Model model : models) {
                model.weight = mixed ? mix.path(model.id).asDouble() : model.observed.path("carCount").asDouble(); weightTotal += model.weight;
                List<String> colours = names(model.observed.path("colourShares")); colours.sort(order);
                for (String colour : colours) if (bindings.values().stream().anyMatch(b -> b.model.equals(model.id) && b.colour.equals(colour))) {
                    model.covered.put(colour, model.observed.path("colourShares").path(colour).asDouble());
                }
            }
            List<Binding> pool = new ArrayList<>();
            if (hasGuarantee()) {
                request.path("qualifyingConfigurationIds").forEach(id -> qualified.add(id.asText()));
                for (Binding b : bindings.values()) { ensureExtra(b); if (qualified.contains(b.id)) pool.add(b); }
                if (list(guarantee.path("distinct")).contains(node("eligibilityModelKey"))) needKeys = Math.min(guarantee.path("minimumCars").asInt(), (int) pool.stream().map(Binding::key).filter(Objects::nonNull).distinct().count());
                if (!witness(pool, guarantee.path("minimumCars").asInt(), needKeys)) invalid("unsupported-release-guarantee");
            }
            draw(pool);
            ObjectNode report = report();
            for (Car car : cars) ensureExtra(car.binding);
            List<ObjectNode> allocation = new ArrayList<>();
            for (Car car : cars) allocation.add(obj("vehicleId", car.id, "configurationId", car.binding.id,
                    "snapshotVersion", car.binding.record.path("snapshotVersion"), "configuration", car.binding.record.path("configuration"), "usage", "stock"));
            ObjectNode inventory = GeneratedStockAllocation.allocate(request.path("inventory"), runId, digest(entropy), plan, allocation);
            Map<String, JsonNode> identities = new HashMap<>(); inventory.path("records").forEach(r -> identities.put(r.path("vehicleId").asText(), r));
            ArrayNode rows = F.arrayNode();
            for (Car car : cars) rows.add(row(car, identities.get(car.id)));
            return obj("status", "ok", "value", obj("rows", rows, "report", report, "inventory", inventory));
        }

        boolean hasGuarantee() { return !guarantee.isMissingNode() && !guarantee.isNull(); }
        ObjectNode descriptor() { return obj("principalId", guarantee.path("principalId"), "minimumCars", guarantee.path("minimumCars"), "distinct", guarantee.path("distinct")); }

        JsonNode policy(String key) {
            JsonNode row = assumptions.path(key);
            if (!row.isObject()) unavailable("required-stock-policy-unavailable");
            if (!key.equals(row.path("key").asText())) invalid("incoherent-stock-policy");
            ObjectNode p = F.objectNode();
            for (String field : List.of("key", "value", "unit", "status", "basis", "source", "sourceDate", "policyVersion", "effectiveFrom", "effectiveTo")) if (row.has(field)) p.set(field, row.path(field));
            provenance.add(p); return row.path("value");
        }

        void loadConfigurations() {
            List<JsonNode> sorted = list(plan.path("configurations")); sorted.sort((a, b) -> order.compare(a.path("configurationId").asText(), b.path("configurationId").asText()));
            for (JsonNode binding : sorted) {
                String id = binding.path("configurationId").asText(); JsonNode source = request.path("configurations").path(id);
                String status = source.path("status").asText("complete");
                if (!List.of("ok", "complete", "partial").contains(status) || !source.path("record").path("configuration").isObject()) unavailable("configuration-unavailable");
                JsonNode active = source.path("active"), record = source.path("record");
                if (!id.equals(record.path("configurationId").asText()) || !text(record.path("snapshotVersion"))
                        || !plan.path("datasetId").equals(active.path("datasetId")) || !plan.path("corpusVersion").equals(active.path("version"))
                        || !text(active.path("manifestDigest")) || manifestDigest != null && !manifestDigest.equals(active.path("manifestDigest").asText())) invalid("configuration-source-mismatch");
                manifestDigest = active.path("manifestDigest").asText(); bindings.put(id, new Binding(binding, source));
            }
        }

        void ensureExtra(Binding b) {
            if (b.extra != null) return;
            JsonNode extra = b.source.path("extraFacts");
            if (!extra.isObject()) invalid("invalid-stock-facts");
            ObjectNode wrapped = F.objectNode();
            for (String key : names(extra)) {
                if (RESERVED.contains(key) || List.of("vin", "vin7", "vin17").contains(key.toLowerCase(Locale.ROOT))) invalid("invalid-stock-facts");
                JsonNode value = extra.path(key);
                if (key.equals("colour") && !exact(value, "status", "value", "unit", "provenance")) invalid("invalid-stock-facts");
                JsonNode fact = value.isObject() && (value.has("status") || value.has("provenance")) ? value.deepCopy()
                        : exact(value, "value", "unit") ? own(value.path("value"), value.path("unit")) : own(value, null);
                validateFact(key, fact); wrapped.set(key, fact);
            }
            b.extra = wrapped;
        }

        void draw(List<Binding> pool) {
            Map<String, Double> modelDebt = new HashMap<>();
            for (int tranche = 0; tranche * trancheSize < total; tranche++) {
                String window = dates.get(tranche % (dates.size() - 1)); ArrayNode trancheEntropy = arr(window, tranche);
                int first = cars.size(), count = Math.min(total, (tranche + 1) * trancheSize) - tranche * trancheSize;
                LinkedHashMap<String, Double> weights = new LinkedHashMap<>();
                for (Model m : models) weights.put(m.id, Math.max(0, count * m.weight / weightTotal + modelDebt.getOrDefault(m.id, 0d)));
                Map<String, Integer> modelCounts = apportion(count, weights, append(entropy, "models", window, tranche));
                for (Model m : models) modelDebt.put(m.id, modelDebt.getOrDefault(m.id, 0d) + count * m.weight / weightTotal - modelCounts.get(m.id));
                for (Model m : models) {
                    int n = modelCounts.get(m.id);
                    if (n > 0 && m.covered.isEmpty()) invalid("unsupported-configuration-coverage");
                    m.cars += n; double coveredTotal = m.covered.values().stream().reduce(0d, Double::sum);
                    LinkedHashMap<String, Double> colourWeights = new LinkedHashMap<>();
                    if (n > 0) for (var entry : m.covered.entrySet()) colourWeights.put(entry.getKey(), Math.max(0, n * entry.getValue() / coveredTotal + m.debt.getOrDefault(entry.getKey(), 0d)));
                    Map<String, Integer> colours = n > 0 ? apportion(n, colourWeights, append(entropy, m.id, window, tranche)) : Map.of();
                    if (n > 0) for (var entry : m.covered.entrySet()) m.debt.put(entry.getKey(), m.debt.getOrDefault(entry.getKey(), 0d) + n * entry.getValue() / coveredTotal - colours.get(entry.getKey()));
                    for (var colour : colours.entrySet()) {
                        List<Binding> candidates = bindings.values().stream().filter(b -> b.model.equals(m.id) && b.colour.equals(colour.getKey())).toList();
                        m.colours.merge(colour.getKey(), colour.getValue(), Integer::sum);
                        for (int i = 0; i < colour.getValue(); i++) {
                            Binding b = candidates.get((int) ordinal(append(entropy, m.id, colour.getKey(), window, tranche, i, "configuration"), candidates.size()));
                            String id = "stock-" + digest(append(arr(requestDigest), VERSION, runId, seed, policyVersion, m.id, colour.getKey(), window, tranche, i));
                            cars.add(new Car(id, b, lead(id, m), tranche));
                        }
                    }
                }
                while (hasGuarantee()) {
                    List<Car> mine = cars.subList(first, cars.size());
                    List<Binding> held = mine.stream().map(Car::binding).filter(b -> qualified.contains(b.id)).toList();
                    if (witness(held, guarantee.path("minimumCars").asInt(), needKeys)) break;
                    Set<String> heldColours = new HashSet<>(), heldKeys = new HashSet<>();
                    held.forEach(b -> { heldColours.add(b.colour); if (b.key() != null) heldKeys.add(b.key()); });
                    Map<String, Integer> counts = new LinkedHashMap<>(); mine.forEach(c -> counts.merge(c.binding.model, 1, Integer::sum));
                    List<String> lines = new ArrayList<>(counts.keySet()); lines.sort((a, b) -> { int cmp = Integer.compare(counts.get(b), counts.get(a)); return cmp != 0 ? cmp : order.compare(a, b); });
                    int index = -1;
                    for (String line : lines) {
                        List<Integer> options = new ArrayList<>();
                        for (int i = first; i < cars.size(); i++) if (cars.get(i).binding.model.equals(line) && !qualified.contains(cars.get(i).binding.id)) options.add(i);
                        if (!options.isEmpty()) { index = options.get((int) ordinal(append(entropy, "guarantee", window, tranche, "replace", substitutions), options.size())); break; }
                    }
                    if (index < 0) invalid("unsupported-release-guarantee");
                    int best = 0; List<Binding> top = new ArrayList<>();
                    for (Binding b : pool) {
                        int score = (heldColours.contains(b.colour) ? 0 : 1) + (heldKeys.size() < needKeys && b.key() != null && !heldKeys.contains(b.key()) ? 1 : 0);
                        if (score > best) { best = score; top.clear(); }
                        if (score == best) top.add(b);
                    }
                    Binding selected = top.get((int) ordinal(append(entropy, "guarantee", window, tranche, "pick", substitutions), top.size()));
                    Car old = cars.get(index); Model from = model(old.binding.model), to = model(selected.model);
                    String id = "stock-" + digest(append(arr(requestDigest), VERSION, runId, seed, policyVersion, "guarantee", window, tranche, index));
                    from.cars--; from.colours.merge(old.binding.colour, -1, Integer::sum); to.cars++; to.colours.merge(selected.colour, 1, Integer::sum);
                    cars.set(index, new Car(id, selected, lead(id, to), tranche)); substitutions++;
                }
            }
        }

        int lead(String id, Model model) { JsonNode lead = model.observed.path("leadTimeWeeks"); return lead.path("min").asInt() + (int) ordinal(append(entropy, id, "lead"), lead.path("max").asInt() - lead.path("min").asInt() + 1); }
        Model model(String id) { return models.stream().filter(m -> m.id.equals(id)).findFirst().orElseThrow(); }

        Map<String, Integer> apportion(int count, LinkedHashMap<String, Double> weights, JsonNode e) {
            double weight = weights.values().stream().reduce(0d, Double::sum);
            List<Portion> portions = new ArrayList<>();
            weights.forEach((key, value) -> portions.add(new Portion(key, count * value / weight, ordinal(append(e, key), 0x100000000L))));
            int remaining = count - portions.stream().mapToInt(p -> p.count).sum();
            List<Portion> sorted = new ArrayList<>(portions);
            sorted.sort((a, b) -> { int c = Double.compare(b.fraction, a.fraction); if (c == 0) c = Long.compare(a.tie, b.tie); return c != 0 ? c : order.compare(a.key, b.key); });
            for (Portion p : sorted) if (remaining-- > 0) p.count++;
            Map<String, Integer> out = new LinkedHashMap<>(); portions.forEach(p -> out.put(p.key, p.count)); return out;
        }

        ObjectNode report() {
            ArrayNode rows = F.arrayNode();
            for (Model m : models) {
                ObjectNode colours = F.objectNode(), planned = F.objectNode(); double covered = m.covered.values().stream().reduce(0d, Double::sum);
                m.covered.forEach((colour, share) -> { colours.set(colour, node(m.cars > 0 ? m.colours.getOrDefault(colour, 0) / (double) m.cars : 0)); planned.set(colour, node(share / covered)); });
                List<Car> modelCars = cars.stream().filter(c -> c.binding.model.equals(m.id)).toList();
                JsonNode leads = m.cars > 0 ? obj("min", modelCars.stream().mapToInt(Car::lead).min().orElseThrow(), "max", modelCars.stream().mapToInt(Car::lead).max().orElseThrow()) : F.nullNode();
                rows.add(obj("modelLineId", m.id, "sourceKind", m.observed.path("sourceKind"), "cars", m.cars,
                        "observedShare", m.observed.path("carCount").asDouble() / observedTotal, "releaseShare", m.weight / weightTotal, "actualShare", m.cars / (double) total,
                        "colourShares", colours, "plannedColourShares", planned, "coveredColourShare", Math.floor(covered * 10000 + .5) / 10000,
                        "uncoveredColourCount", m.observed.path("colourShares").size() - m.covered.size(), "leadTimeWeeks", leads, "observed", m.observed, "aggregateKey", m.key));
            }
            ObjectNode release = obj("trancheSize", trancheSize, "weeklyVolume", total, "windows", dates.subList(0, dates.size() - 1));
            if (hasGuarantee()) release.set("guarantee", descriptor().put("substituted", substitutions));
            return obj("runId", runId, "seed", seed, "policyVersion", policyVersion, "generatorVersion", VERSION, "totalCars", cars.size(),
                    "configurationSource", obj("kind", plan.path("kind"), "source", plan.path("source"), "datasetId", plan.path("datasetId"), "corpusVersion", plan.path("corpusVersion"), "manifestDigest", manifestDigest),
                    "models", rows, "release", release, "policyProvenance", provenance);
        }

        ObjectNode known(Object value, String source, Object unit) { return obj("status", "known", "value", value, "unit", unit,
                "provenance", obj("sourceRef", source, "observedAt", observedAt, "version", VERSION + ":" + policyVersion, "assurance", "synthetic-scenario")); }
        ObjectNode own(Object value, Object unit) { return known(value, "generator:" + VERSION, unit); }

        ObjectNode row(Car car, JsonNode identity) {
            Binding b = car.binding; Model m = model(b.model); int windowIndex = car.tranche % (dates.size() - 1);
            String title = plan.path("titles").path(b.model).asText(b.model), displayName = plan.path("displayNames").path(b.model).asText(title);
            String name = carName(b.key() == null ? title : b.key(), displayName);
            String display = name + " in " + b.colour; ObjectNode shown = obj("name", display);
            if (!b.images.isEmpty()) {
                shown.put("photo", "/" + b.images.getFirst().path("asset").asText()); ArrayNode images = F.arrayNode();
                for (JsonNode image : b.images) {
                    String alt = image.path("label").asText().isEmpty() ? display : display + ", " + image.path("label").asText().toLowerCase(Locale.ROOT);
                    ObjectNode entry = obj("src", "/" + image.path("asset").asText(), "alt", alt, "fidelity", image.path("fidelity"),
                            "sourceRef", "display-image:" + image.path("imageId").asText() + ", observed " + image.path("observedDate").asText());
                    if (!image.path("viewpoint").asText().isEmpty()) { entry.set("viewpoint", image.path("viewpoint")); if (image.has("label")) entry.set("label", image.path("label")); }
                    images.add(entry);
                }
                shown.set("images", images);
            }
            JsonNode configuration = b.record.path("configuration");
            for (String field : List.of("model", "derivative")) if (text(configuration.path(field))) shown.set(field, configuration.path(field));
            ObjectNode facts = b.extra.deepCopy(); String aggregate = "policy:" + m.key;
            facts.set("stockIdentityKind", own("synthetic", null)); facts.set("modelLine", known(title, aggregate, null));
            if (!facts.has("colour")) facts.set("colour", known(b.colour, aggregate, null));
            facts.set("leadTimeWeeks", known(car.lead, aggregate, "weeks"));
            LocalDate week = Instant.parse(dates.getLast()).atZone(zone).toLocalDate().plusWeeks(car.lead).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            facts.set("confirmedDeliveryWeek", known(week.toString(), aggregate, null));
            facts.set("plannedRelease", known(obj("releaseId", runId + ":stock:" + car.tranche, "windowStart", dates.get(windowIndex),
                    "windowEnd", dates.get(windowIndex + 1), "policyVersion", policyVersion), "policy:supply.release.cadence", null));
            facts.set("syntheticVehicleId", own(identity.path("vehicleId"), null)); facts.set("configurationHash", own(identity.path("configurationHash"), null));
            ObjectNode synthetic = F.objectNode();
            for (String key : List.of("vehicleId", "identityKind", "generatorVersion", "originatingDatasetId", "configurationHash", "snapshotVersion")) synthetic.set(key, identity.path(key));
            facts.set("syntheticIdentity", own(synthetic, null)); facts.set("generatorVersion", own(VERSION, null)); facts.set("policyVersion", own(policyVersion, null));
            ObjectNode snapshot = obj("contractVersion", "vehicle-snapshot-v1", "candidateKey", "synthetic%3Astock-generator.v1:exact-stock:" + identity.path("orderUuid").asText(),
                    "sourceNamespace", NAMESPACE, "identityKind", "exact-stock", "sourceKeys", obj("stockId", identity.path("orderUuid")),
                    "snapshotVersion", VERSION + ":" + policyVersion, "observedAt", observedAt, "display", shown, "facts", facts);
            ObjectNode row = obj("runId", runId, "orderUuid", identity.path("orderUuid"), "orderNumber", identity.path("orderNumber"), "wholesalerOrderId", identity.path("wholesalerOrderId"),
                    "configurationId", identity.path("configurationId"), "corpusVersion", plan.path("corpusVersion"), "revision", 1, "account", stockAccount,
                    "state", "unreleased", "status", "unreleased", "available", false, "facts", snapshot,
                    "version", 1, "createdAt", clock, "updatedAt", clock);
            if (request.has("visibility")) row.set("visibility", request.path("visibility").deepCopy());
            return row;
        }

        String carName(String key, String fallback) {
            String[] parts = key.split("\\|", -1); String engine = tidy(String.join("|", Arrays.copyOfRange(parts, 1, parts.length)));
            JsonNode models = assumptions.path("policy.displayLabels.v1").path("value").path("models"); String template = models.path(parts[0]).asText("");
            String base = !template.isBlank() && (!engine.isEmpty() || !template.startsWith("{engine}")) ? tidy(template.replace("{engine}", engine)) : tidy(fallback);
            return base.startsWith("BMW ") ? base : "BMW " + base;
        }
    }

    private static String tidy(String s) { return s.replaceAll("\\s+", " ").trim(); }
    private static boolean finite(JsonNode n) { return n.isNumber() && Double.isFinite(n.asDouble()); }
    private static boolean day(JsonNode n) { try { return n.isTextual() && n.asText().matches("\\d{4}-\\d{2}-\\d{2}") && LocalDate.parse(n.asText()).toString().equals(n.asText()); } catch (RuntimeException e) { return false; } }
    private static boolean range(JsonNode n) { return exact(n, "min", "max") && integer(n.path("min")) && n.path("min").asDouble() >= 0 && integer(n.path("max")) && n.path("max").asDouble() >= n.path("min").asDouble() && n.path("max").asDouble() <= 520; }
    private static boolean shares(JsonNode n) {
        double sum = 0;
        if (!n.isObject() || n.isEmpty()) return false;
        for (String key : names(n)) { JsonNode v = n.path(key); if (!text(node(key)) || !finite(v) || v.asDouble() < 0 || v.asDouble() > 1) return false; sum += v.asDouble(); }
        return Math.abs(sum - 1) <= .000001;
    }
    private static boolean ids(JsonNode n) { return n.isArray() && list(n).stream().allMatch(GeneratedJson::text) && new HashSet<>(list(n)).size() == n.size(); }
    private static boolean validVisibility(JsonNode request) { JsonNode v = request.path("visibility"); return !request.has("visibility") || v.isObject() && ids(v.path("companyIds")) && ids(v.path("schemeIds")) && (v.path("employeeIds").isNull() || ids(v.path("employeeIds"))); }
    private static boolean validGuarantee(JsonNode g) { return g.isMissingNode() || g.isNull() || g.isObject() && text(g.path("principalId")) && positive(g.path("minimumCars")) && g.path("distinct").isArray() && list(g.path("distinct")).contains(node("colour")) && list(g.path("distinct")).stream().allMatch(v -> List.of("colour", "eligibilityModelKey").contains(v.asText())); }
    private static boolean validPlan(JsonNode p) {
        if (!p.isObject() || !List.of("synthetic-fixture", "accepted-f77", "retained-corpus").contains(p.path("kind").asText())
                || !List.of("source", "datasetId", "corpusVersion").stream().allMatch(k -> text(p.path(k)))) return false;
        for (String field : List.of("titles", "displayNames")) if (p.has(field) && (!p.path(field).isObject() || list(p.path(field)).stream().anyMatch(v -> !text(v)))) return false;
        JsonNode configurations = p.path("configurations"), keys = p.path("aggregateKeys");
        if (!configurations.isArray() || configurations.isEmpty() || configurations.size() > 10000 || !keys.isObject() || keys.isEmpty()) return false;
        for (String key : names(keys)) if (!text(node(key)) || !text(keys.path(key))) return false;
        Set<String> unique = new HashSet<>();
        for (JsonNode c : configurations) if (!c.isObject() || !c.path("configurationId").isTextual() || c.path("configurationId").asText().isEmpty()
                || c.path("configurationId").asText().length() > 4096 || !unique.add(c.path("configurationId").asText()) || !text(c.path("modelLineId"))
                || !text(c.path("colour")) || !keys.has(c.path("modelLineId").asText())) return false;
        return true;
    }
    private static boolean validAggregate(JsonNode v, String id, JsonNode plan) {
        boolean assumed = "retained-corpus".equals(plan.path("kind").asText()) && "assumed-aggregate".equals(v.path("sourceKind").asText());
        boolean sampled = assumed ? !v.has("sampleDate") && !v.has("requestCount") : day(v.path("sampleDate")) && positive(v.path("requestCount")) && v.path("requestCount").asDouble() <= 400;
        JsonNode spread = v.path("deliveryDateSpread"), price = v.path("priceBand");
        return allowed(v, "modelLineId", "carCount", "colourShares", "upholsteryShares", "leadTimeWeeks", "deliveryDateSpread", "priceBand", "sampleDate", "requestCount", "sourceKind")
                && id.equals(v.path("modelLineId").asText()) && integer(v.path("carCount")) && v.path("carCount").asDouble() >= 0
                && shares(v.path("colourShares")) && shares(v.path("upholsteryShares")) && range(v.path("leadTimeWeeks"))
                && exact(spread, "min", "max") && day(spread.path("min")) && day(spread.path("max")) && spread.path("min").asText().compareTo(spread.path("max").asText()) <= 0
                && sampled && exact(price, "min", "max", "currency") && "GBP".equals(price.path("currency").asText())
                && finite(price.path("min")) && price.path("min").asDouble() >= 0 && finite(price.path("max")) && price.path("max").asDouble() >= price.path("min").asDouble();
    }

    private static List<String> releaseDates(String clock, JsonNode cadence) {
        if (!exact(cadence, "timeZone", "slots") || !text(cadence.path("timeZone")) || !cadence.path("slots").isArray()
                || cadence.path("slots").isEmpty() || cadence.path("slots").size() > 7) throw new IllegalArgumentException("cadence");
        Map<Integer, LocalTime> slots = new HashMap<>();
        for (JsonNode slot : cadence.path("slots")) {
            int weekday = slot.path("weekday").asInt(-1);
            if (!exact(slot, "weekday", "time") || !integer(slot.path("weekday")) || weekday < 0 || weekday > 6 || slots.containsKey(weekday)
                    || !slot.path("time").asText().matches("(?:[01]\\d|2[0-3]):[0-5]\\d")) throw new IllegalArgumentException("cadence");
            slots.put(weekday, LocalTime.parse(slot.path("time").asText()));
        }
        ZoneId zone = ZoneId.of(cadence.path("timeZone").asText()); Instant asOf = Instant.parse(clock);
        LocalDate start = asOf.atZone(zone).toLocalDate(); List<String> dates = new ArrayList<>();
        for (int offset = 0; offset < 15 && dates.size() < slots.size() + 1; offset++) {
            LocalDate date = start.plusDays(offset); LocalTime time = slots.get(date.getDayOfWeek().getValue() % 7);
            if (time == null) continue;
            LocalDateTime target = LocalDateTime.of(date, time); Instant candidate = target.toInstant(ZoneOffset.UTC);
            boolean resolved = false;
            for (int i = 0; i < 3; i++) {
                long delta = Duration.between(candidate.atZone(zone).toLocalDateTime(), target).toMillis();
                if (delta == 0) { resolved = true; break; }
                candidate = candidate.plusMillis(delta);
            }
            if (!resolved) throw new IllegalArgumentException("local-time");
            if (!candidate.isBefore(asOf)) dates.add(ISO.format(candidate));
        }
        if (dates.size() != slots.size() + 1) throw new IllegalArgumentException("cadence");
        return dates;
    }

    private static boolean witness(List<Binding> bindings, int size, int keys) {
        Map<String, List<String>> byColour = new LinkedHashMap<>();
        for (Binding b : bindings) { List<String> values = byColour.computeIfAbsent(b.colour, k -> new ArrayList<>()); if (b.key() != null) values.add(b.key()); }
        if (byColour.size() < size) return false;
        Map<String, String> owner = new HashMap<>(); int matched = 0;
        for (String colour : byColour.keySet()) if (matched < keys && place(colour, new HashSet<>(), byColour, owner)) matched++;
        return matched >= keys;
    }
    private static boolean place(String colour, Set<String> seen, Map<String, List<String>> byColour, Map<String, String> owner) {
        for (String key : byColour.getOrDefault(colour, List.of())) {
            if (!seen.add(key)) continue;
            if (!owner.containsKey(key) || place(owner.get(key), seen, byColour, owner)) { owner.put(key, colour); return true; }
        }
        return false;
    }

    private static void validateFact(String name, JsonNode fact) {
        JsonNode p = fact.path("provenance"), value = fact.path("value"), unit = fact.path("unit");
        boolean unknown = "unknown".equals(fact.path("status").asText());
        if (!allowed(fact, "status", "value", "unit", "provenance") || !List.of("known", "unknown").contains(fact.path("status").asText())
                || !fact.has("value") || !allowed(p, "sourceRef", "observedAt", "version", "assurance") || !nonblank(p.path("sourceRef")) || !nonblank(p.path("version"))
                || unknown != value.isNull() || unknown != "unknown".equals(p.path("assurance").asText())
                || !List.of("unknown", "confirmed-listing", "confirmed-build", "model-reference", "derived", "synthetic-scenario").contains(p.path("assurance").asText())
                || !unit.isNull() && !nonblank(unit) || value.isNumber() && unit.isNull()) invalid("invalid-stock-facts");
        try { Instant.parse(p.path("observedAt").asText()); } catch (RuntimeException e) { invalid("invalid-stock-facts"); }
        Map<String, String> units = Map.ofEntries(Map.entry("seats", "count"), Map.entry("doors", "count"), Map.entry("boot", "L"), Map.entry("zeroTo62", "s"),
                Map.entry("mileage", "mi"), Map.entry("evRange", "mi"), Map.entry("mpg", "mpg-imperial"), Map.entry("cc", "cm3"), Map.entry("year", "year"), Map.entry("sizeClass", "ordinal-1-5"));
        if (units.containsKey(name) && (!units.get(name).equals(unit.asText()) || !unknown && (!finite(value) || value.asDouble() < 0))) invalid("invalid-stock-facts");
        if (!unknown && List.of("seats", "doors", "year", "sizeClass").contains(name) && !integer(value)) invalid("invalid-stock-facts");
        if (!unknown && name.equals("sizeClass") && (value.asDouble() < 1 || value.asDouble() > 5)) invalid("invalid-stock-facts");
        if (!unknown && List.of("frontIsofix", "rearIsofix").contains(name) && !value.isBoolean()) invalid("invalid-stock-facts");
    }

    private static boolean nonblank(JsonNode n) { return n.isTextual() && !n.asText().isBlank(); }
}
