package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyClock;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyResult;
import gcsp.api.policy.PolicyService;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Port of the Node demo stock provider and its confirmed-supply wrapper: synthetic cars on the four reviewed
 * configurations, released in policy windows, with confirmed Production supply released first.
 */
public final class DemoSupplyProvider implements SupplyProvider {

    static final String VERSION = "demo-synthetic-stock-v1";
    static final String LABEL =
            "Synthetic demo stock on reviewed structural configurations; not BMW stock or a published corpus";
    private static final String OBSERVED_AT = "2026-11-05T00:00:00.000Z";
    private static final String UNTIL = "2027-01-01T00:00:00.000Z";
    private static final String SUPPLY_UNTIL = "2027-12-31T00:00:00.000Z";
    private static final String NAMESPACE = "synthetic:" + VERSION;
    private static final String SUPPLY_NAMESPACE = "synthetic:demo-confirmed-supply-v1";
    private static final String LABELS_KEY = "policy.displayLabels.v1";
    private static final Pattern SPACES = Pattern.compile("(?U)\\s+");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private static final Map<String, Model> MODELS = loadModels();

    private record Model(String kind, String model, String derivative, String configurationId, String key,
            String nameKey, JsonNode image, JsonNode facts) {}

    private record WindowPlan(String windowId, Instant availableAt, List<String> cars) {}

    private final PolicyService policy;
    private final ConfirmedSupplyLookup lookup;
    private final RunCueLookup cues;
    private final Map<String, TranchePlanProvider> plans = new HashMap<>();

    /** Windows keyed to the policy template's named times. */
    public DemoSupplyProvider(PolicyService policy, ConfirmedSupplyLookup lookup) {
        this(policy, lookup, RunCueLookup.NONE);
    }

    /** Windows keyed to the run's own dated named times when it has them, else to the policy template's. */
    public DemoSupplyProvider(PolicyService policy, ConfirmedSupplyLookup lookup, RunCueLookup cues) {
        if (policy == null || lookup == null || cues == null) {
            throw new IllegalArgumentException("Supply a policy service, a lookup and a cue lookup.");
        }
        this.policy = policy;
        this.lookup = lookup;
        this.cues = cues;
    }

    @Override
    public String mode() {
        return "demo";
    }

    @Override
    public ProviderResponse pull(PullRequest request) {
        if (request == null || request.runId() == null || request.runId().isEmpty()) return unavailable();
        ProviderResponse confirmed = confirmedSupply(request);
        if (confirmed != null) return confirmed;
        TranchePlanProvider plan;
        try {
            plan = plan(request);
        } catch (RuntimeException e) {
            return unavailable();
        }
        return plan == null ? unavailable() : plan.pull(request);
    }

    private static ProviderResponse unavailable() {
        return new ProviderResponse.Unavailable("stock-source-unavailable", "Stock source is unavailable.");
    }

    // Confirmed supply releases first; a non-tranche answer falls through to the demo windows.
    ProviderResponse confirmedSupply(PullRequest request) {
        List<String> ids = request.queuedSupply().stream().map(PullRequest.QueuedSupply::supplyId).distinct().toList();
        if (ids.isEmpty()) return null;
        Map<String, ConfirmedSupplyLookup.Confirmed> found;
        try {
            found = lookup.find(request.runId(), ids);
        } catch (RuntimeException e) {
            return unavailable();
        }
        ArrayNode windows = F.arrayNode();
        Map<String, String> names = null;
        for (PullRequest.QueuedSupply row : request.queuedSupply()) {
            ConfirmedSupplyLookup.Confirmed held = found.get(row.supplyId());
            Model model = held == null ? null : kindOf(held.model(), held.derivative());
            if (model == null) continue;
            if (names == null) names = carNames(request);
            long first = 9_100_000L + uint32(digest(VERSION, request.runId(), row.supplyId(), "number")) % 800_000L;
            ArrayNode stock = F.arrayNode();
            for (int i = 0; i < held.quantity(); i++) {
                stock.add(exactCar(model, orderUuid(request.runId(), row.supplyId() + ":" + i), String.valueOf(first + i),
                        SUPPLY_UNTIL, SUPPLY_NAMESPACE, names));
            }
            windows.add(window("supply-" + row.supplyId(), Iso.format(row.eligibleFrom()), row.supplyId(), stock));
        }
        if (windows.isEmpty()) return null;
        ProviderResponse out;
        try {
            out = new TranchePlanProvider(planOf(windows)).pull(request);
        } catch (RuntimeException e) {
            return unavailable();
        }
        boolean tranche = out instanceof ProviderResponse.Ok ok && !ok.value().path("tranche").isNull();
        return out instanceof ProviderResponse.Ok && !tranche ? null : out;
    }

    private synchronized TranchePlanProvider plan(PullRequest request) {
        TranchePlanProvider cached = plans.get(request.runId());
        if (cached != null) return cached;
        List<WindowPlan> windowPlan = windowsFor(request);
        if (windowPlan == null) return null;
        Map<String, String> names = carNames(request);
        long base = 1_000_000L + uint32(digest(VERSION, request.runId(), "number")) % 8_000_000L;
        int index = 0;
        ArrayNode windows = F.arrayNode();
        for (WindowPlan w : windowPlan) {
            ArrayNode stock = F.arrayNode();
            for (String kind : w.cars()) {
                stock.add(exactCar(MODELS.get(kind), orderUuid(request.runId(), String.valueOf(index)),
                        String.valueOf(base + index), UNTIL, NAMESPACE, names));
                index++;
            }
            windows.add(window(w.windowId(), Iso.format(w.availableAt()), null, stock));
        }
        TranchePlanProvider built = new TranchePlanProvider(planOf(windows));
        plans.put(request.runId(), built);
        return built;
    }

    private static ObjectNode planOf(ArrayNode windows) {
        ObjectNode plan = F.objectNode();
        plan.put("label", LABEL);
        plan.put("version", VERSION);
        plan.set("windows", windows);
        return plan;
    }

    private static ObjectNode window(String id, String availableAt, String supplyId, ArrayNode stock) {
        ObjectNode w = F.objectNode();
        w.put("windowId", id);
        w.put("availableAt", availableAt);
        if (supplyId == null) w.putNull("supplyId"); else w.put("supplyId", supplyId);
        w.set("stock", stock);
        return w;
    }

    // Windows come from policy: supply.release.windows offsets from a clock.scenario.v1 named cue; any fault is null.
    private List<WindowPlan> windowsFor(PullRequest request) {
        PolicyRead read = new PolicyRead(request.runId(), PolicyClock.iso(request.asOf()), request.policyVersion());
        PolicyResult spec = policy.getAssumption("supply.release.windows", read);
        PolicyResult clock = policy.getAssumption("clock.scenario.v1", read);
        if (!spec.ok() || !clock.ok()) return null;
        JsonNode config = spec.value().path("value");
        JsonNode times = clock.value().path("value").path("namedTimes");
        JsonNode cue = config.path("cue");
        Instant at = cue.isTextual() && times.path(cue.asText()).isTextual() ? Iso.parse(times.get(cue.asText()).asText())
                : null;
        // The run's clock is dated to its start day, so its own cue wins over the template's when it has one.
        if (cue.isTextual() && at != null) at = cues.namedTimes(request.runId()).getOrDefault(cue.asText(), at);
        JsonNode list = config.path("windows");
        if (at == null || !list.isArray() || list.isEmpty()) return null;
        Set<String> ids = new HashSet<>();
        List<WindowPlan> out = new ArrayList<>();
        for (JsonNode row : list) {
            JsonNode offset = row.path("offsetMinutes");
            JsonNode cars = row.path("cars");
            if (!row.path("windowId").isTextual() || row.get("windowId").asText().isEmpty()
                    || !ids.add(row.get("windowId").asText()) || !safeInteger(offset) || !cars.isArray() || cars.isEmpty()) {
                return null;
            }
            List<String> kinds = new ArrayList<>();
            for (JsonNode kind : cars) {
                if (!kind.isTextual() || !MODELS.containsKey(kind.asText())) return null;
                kinds.add(kind.asText());
            }
            out.add(new WindowPlan(row.get("windowId").asText(), at.plusSeconds(offset.asLong() * 60), kinds));
        }
        return out;
    }

    private static boolean safeInteger(JsonNode n) {
        if (!n.isNumber()) return false;
        double d = n.asDouble();
        return d == Math.rint(d) && Math.abs(d) <= 9_007_199_254_740_991.0;
    }

    // The display name follows the one policy rule; unavailable policy leaves only the plain model line name.
    private Map<String, String> carNames(PullRequest request) {
        JsonNode models = F.objectNode();
        try {
            PolicyResult row = policy.getAssumption(LABELS_KEY, new PolicyRead(request.runId(),
                    PolicyClock.iso(request.asOf()), request.policyVersion()));
            if (row.ok() && LABELS_KEY.equals(row.value().path("key").asText(null))
                    && row.value().path("value").path("models").isObject()) {
                models = row.value().get("value").get("models");
            }
        } catch (RuntimeException e) {
            // names fall back to the plain model-line name
        }
        Map<String, String> names = new LinkedHashMap<>();
        for (Model m : MODELS.values()) {
            names.put(m.kind(), carName(models, m.nameKey() != null ? m.nameKey() : m.key(),
                    m.model() + " " + m.derivative()));
        }
        return names;
    }

    static String carName(JsonNode models, String modelKey, String fallback) {
        String[] parts = modelKey.split("\\|", -1);
        String line = parts[0];
        String engine = tidy(String.join("|", java.util.Arrays.copyOfRange(parts, 1, parts.length)));
        JsonNode t = models.path(line);
        String template = t.isTextual() && !t.asText().isBlank() ? t.asText() : null;
        String base = null;
        if (template != null && (!engine.isEmpty() || !template.startsWith("{engine}"))) {
            base = tidy(template.replace("{engine}", engine));
        } else if (fallback != null && !fallback.isBlank()) {
            base = tidy(fallback);
        }
        if (base == null || base.isEmpty()) return null;
        return base.startsWith("BMW ") ? base : "BMW " + base;
    }

    private static String tidy(String v) {
        return SPACES.matcher(v).replaceAll(" ").strip();
    }

    private static ObjectNode exactCar(Model m, String uuid, String orderNumber, String until, String namespace,
            Map<String, String> names) {
        ObjectNode car = F.objectNode();
        car.put("orderUuid", uuid);
        car.put("orderNumber", orderNumber);
        car.put("configurationId", m.configurationId());
        car.put("corpusVersion", VERSION);
        car.put("revision", 1);
        ObjectNode visibility = car.putObject("visibility");
        visibility.putArray("companyIds").add("demo-bmw-fs-uk").add("demo-bmw-rr-production");
        visibility.putArray("schemeIds").add("choices-fs-uk").add("choices-rr-production");
        visibility.putNull("employeeIds");
        car.putObject("availability").put("availableUntil", until);
        car.set("facts", snapshot(m, uuid, namespace, names.get(m.kind())));
        return car;
    }

    // The VehicleSnapshot v1 Node's createVehicleSnapshot returns for an exact-stock car.
    private static ObjectNode snapshot(Model m, String uuid, String namespace, String name) {
        ObjectNode s = F.objectNode();
        s.put("contractVersion", "vehicle-snapshot-v1");
        s.put("candidateKey", enc(namespace) + ":exact-stock:" + enc(uuid));
        s.put("sourceNamespace", namespace);
        s.put("identityKind", "exact-stock");
        s.putObject("sourceKeys").put("stockId", uuid);
        s.put("snapshotVersion", VERSION);
        s.put("observedAt", OBSERVED_AT);
        ObjectNode display = s.putObject("display");
        display.put("name", name);
        JsonNode image = m.image();
        if (image != null) {
            display.put("photo", "/" + image.get("asset").asText());
            ObjectNode shown = display.putArray("images").addObject();
            shown.put("src", "/" + image.get("asset").asText());
            boolean label = image.hasNonNull("label") && !image.get("label").asText().isEmpty();
            shown.put("alt", label ? name + ", " + image.get("label").asText().toLowerCase(java.util.Locale.ROOT) : name);
            shown.put("fidelity", image.get("fidelity").asText());
            shown.put("sourceRef", "display-image:" + image.get("imageId").asText() + ", observed "
                    + image.get("observedDate").asText());
            if (image.hasNonNull("viewpoint")) {
                shown.put("viewpoint", image.get("viewpoint").asText());
                shown.put("label", image.path("label").asText());
            }
        }
        display.put("model", m.model());
        display.put("derivative", m.derivative());
        ObjectNode facts = s.putObject("facts");
        facts.set("eligibilityModelKey", fact(F.textNode(m.key()), null));
        Iterator<Map.Entry<String, JsonNode>> it = m.facts().fields();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode unit = e.getValue().get("unit");
            facts.set(e.getKey(), fact(e.getValue().get("value"), unit == null || unit.isNull() ? null : unit.asText()));
        }
        return s;
    }

    private static ObjectNode fact(JsonNode value, String unit) {
        ObjectNode f = F.objectNode();
        f.put("status", "known");
        f.set("value", value);
        if (unit == null) f.putNull("unit"); else f.put("unit", unit);
        ObjectNode p = f.putObject("provenance");
        p.put("sourceRef", "fixture:" + VERSION);
        p.put("observedAt", OBSERVED_AT);
        p.put("version", VERSION);
        p.put("assurance", "synthetic-scenario");
        return f;
    }

    private static Model kindOf(String model, String derivative) {
        for (Model m : MODELS.values()) {
            if (m.model().equals(model) && m.derivative().equals(derivative)) return m;
        }
        return null;
    }

    private static String enc(String text) {
        return URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20").replace("%7E", "~")
                .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")");
    }

    private static byte[] digest(String... parts) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(String.join("|", parts).getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static long uint32(byte[] d) {
        return ((d[0] & 0xffL) << 24) | ((d[1] & 0xffL) << 16) | ((d[2] & 0xffL) << 8) | (d[3] & 0xffL);
    }

    private static String orderUuid(String runId, String index) {
        byte[] b = java.util.Arrays.copyOf(digest(VERSION, runId, "order", index), 16);
        b[6] = (byte) ((b[6] & 0x0f) | 0x40);
        b[8] = (byte) ((b[8] & 0x3f) | 0x80);
        StringBuilder hex = new StringBuilder();
        for (byte x : b) hex.append(String.format("%02x", x));
        return hex.substring(0, 8) + "-" + hex.substring(8, 12) + "-" + hex.substring(12, 16) + "-"
                + hex.substring(16, 20) + "-" + hex.substring(20);
    }

    private static Map<String, Model> loadModels() {
        try (InputStream in = DemoSupplyProvider.class.getResourceAsStream("/gcsp/supply/demo-stock-v1.json")) {
            if (in == null) throw new IllegalStateException("gcsp/supply/demo-stock-v1.json is not packaged");
            Map<String, Model> out = new LinkedHashMap<>();
            Iterator<Map.Entry<String, JsonNode>> it = JSON.readTree(in).get("models").fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                JsonNode m = e.getValue();
                out.put(e.getKey(), new Model(e.getKey(), m.get("model").asText(), m.get("derivative").asText(),
                        m.get("configurationId").asText(), m.get("key").asText(),
                        m.hasNonNull("nameKey") ? m.get("nameKey").asText() : null, m.get("image"), m.get("facts")));
            }
            return out;
        } catch (IOException e) {
            throw new IllegalStateException("gcsp/supply/demo-stock-v1.json cannot be read", e);
        }
    }
}
