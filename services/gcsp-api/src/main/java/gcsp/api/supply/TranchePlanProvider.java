package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Port of the Node synthetic provider: visibility comes from the request's released list; the plan is run-agnostic. */
public final class TranchePlanProvider implements SupplyProvider {

    private static final ObjectMapper JSON = new ObjectMapper();

    private record Window(String windowId, String availableAtText, Instant availableAt, String supplyId,
            List<JsonNode> stock) {}

    private final String version;
    private final String label;
    private final List<Window> windows = new ArrayList<>();

    /** Plan shape: {label, version, windows: [{windowId, availableAt, supplyId, stock: [car]}]}. */
    public TranchePlanProvider(JsonNode plan) {
        if (plan == null || !plan.isObject() || !PullValidator.text(plan.get("label"))
                || !PullValidator.text(plan.get("version")) || !plan.path("windows").isArray()) {
            throw new IllegalArgumentException("Supply a labelled, versioned synthetic tranche plan with exact cars.");
        }
        this.label = plan.get("label").asText();
        this.version = plan.get("version").asText();
        Set<String> windowIds = new HashSet<>();
        Set<String> uuids = new HashSet<>();
        for (JsonNode w : plan.get("windows")) {
            Instant at = w.path("availableAt").isTextual() ? Iso.parse(w.get("availableAt").asText()) : null;
            if (!w.isObject() || !PullValidator.text(w.get("windowId")) || at == null || !w.has("supplyId")
                    || !(w.get("supplyId").isNull() || PullValidator.text(w.get("supplyId")))
                    || !w.path("stock").isArray() || !windowIds.add(w.get("windowId").asText())) {
                throw new IllegalArgumentException("Each window needs an id, an instant, a supplyId and exact cars.");
            }
            List<JsonNode> stock = new ArrayList<>();
            for (JsonNode car : w.get("stock")) {
                if (!PullValidator.validCar(car) || !uuids.add(car.get("orderUuid").asText())) {
                    throw new IllegalArgumentException("Plan cars must be valid and unique by orderUuid.");
                }
                stock.add(car.deepCopy());
            }
            windows.add(new Window(w.get("windowId").asText(), w.get("availableAt").asText(), at,
                    w.get("supplyId").isNull() ? null : w.get("supplyId").asText(), stock));
        }
    }

    public static TranchePlanProvider fromFile(Path file) throws IOException {
        return new TranchePlanProvider(JSON.readTree(Files.readString(file)));
    }

    @Override
    public String mode() {
        return "tranche-plan";
    }

    @Override
    public ProviderResponse pull(PullRequest request) {
        Set<String> known = new LinkedHashSet<>();
        for (PullRequest.Released r : request.released()) known.addAll(r.orderUuids());
        ObjectNode tranche = null;
        for (Window w : windows) {
            if (w.availableAt().isAfter(request.asOf())) continue;
            if (w.supplyId() != null && request.queuedSupply().stream().noneMatch(
                    q -> q.supplyId().equals(w.supplyId()) && !q.eligibleFrom().isAfter(request.asOf()))) {
                continue;
            }
            List<JsonNode> next = new ArrayList<>();
            for (JsonNode car : w.stock()) {
                if (next.size() < request.releaseSize() && !known.contains(car.get("orderUuid").asText())) next.add(car);
            }
            if (next.isEmpty()) continue;
            int first = w.stock().indexOf(next.get(0));
            tranche = JSON.createObjectNode();
            tranche.put("trancheId", version + ":" + w.windowId() + ":" + first);
            tranche.put("windowId", w.windowId());
            tranche.put("availableAt", w.availableAtText());
            if (w.supplyId() == null) tranche.putNull("supplyId"); else tranche.put("supplyId", w.supplyId());
            ArrayNode ids = tranche.putArray("orderUuids");
            for (JsonNode car : next) {
                ids.add(car.get("orderUuid").asText());
                known.add(car.get("orderUuid").asText());
            }
            break;
        }
        ObjectNode value = JSON.createObjectNode();
        value.put("schemaVersion", PullValidator.VERSION);
        value.put("runId", request.runId());
        value.put("observedAt", Iso.format(request.asOf()));
        ObjectNode source = value.putObject("source");
        source.put("providerId", "synthetic-stock");
        source.put("mode", "synthetic");
        source.put("version", version);
        source.put("label", label);
        if (tranche == null) value.putNull("tranche"); else value.set("tranche", tranche);
        ArrayNode stock = value.putArray("stock");
        for (Window w : windows) {
            for (JsonNode car : w.stock()) if (known.contains(car.get("orderUuid").asText())) stock.add(car.deepCopy());
        }
        return new ProviderResponse.Ok(value);
    }
}
