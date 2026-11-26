package gcsp.api.supply;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.ClockResult;
import gcsp.api.persistence.RunContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Native run-generated stock source; preparation and release retain their separate authorities. */
public final class GeneratedSupplyProvider implements SupplyProvider {
    static final String NAMESPACE = "synthetic:stock-generator.v1";
    private static final String LABEL = "Synthetic scheme stock generated on the retained FUCQ-61 corpus; not BMW stock";
    private static final JsonNodeFactory F = JsonNodeFactory.instance;
    private final GeneratedStockPreparation preparation;
    private final DemoSupplyProvider demo;
    private final Map<String, Set<String>> expired = new ConcurrentHashMap<>();

    public GeneratedSupplyProvider(GeneratedStockPreparation preparation, DemoSupplyProvider demo) {
        if (preparation == null || demo == null) throw new IllegalArgumentException("Supply generated preparation and confirmed supply.");
        this.preparation = preparation;
        this.demo = demo;
    }
    @Override
    public String mode() { return "generated-stock"; }

    /** Unreleased cars omitted by this instance's pulls, sorted as in the generated provider port. */
    public List<String> expired(String runId) {
        if (runId == null) return List.of();
        return expired.getOrDefault(runId, Set.of()).stream().sorted().toList();
    }

    @Override
    public ProviderResponse pull(PullRequest request) {
        if (request == null || request.runId() == null || request.runId().isBlank()) return unavailable();
        try {
            if (!preparation.active(request.runId())) return new ProviderResponse.StaleRun();
            ProviderResponse confirmed = demo.confirmedSupply(request);
            if (confirmed != null) return confirmed;
            if (preparation.publishedDemo(request.runId())) return demo.pull(request);
            ClockResult ready = preparation.ensure(request);
            if (ready.status() == ClockResult.Status.STALE_RUN) return new ProviderResponse.StaleRun();
            if (!ready.ok()) return unavailable();
            return pullRows(preparation.rows(request.runId()), request,
                    expired.computeIfAbsent(request.runId(), ignored -> ConcurrentHashMap.newKeySet()));
        } catch (java.sql.SQLException | RuntimeException failure) {
            return unavailable();
        }
    }

    /** Explicit Main preparation runs before the scenario becomes tickable. */
    public ClockResult prepare(RunContext run, String policyVersion, Instant clock, JsonNode scenario, JsonNode tranche) {
        return preparation.prepare(run, policyVersion, clock, scenario, tranche);
    }

    /** Node generated-provider.js: keep original window offsets when omitting expired unreleased cars. */
    static ProviderResponse pullRows(JsonNode rows, PullRequest request) {
        return pullRows(rows, request, null);
    }

    private static ProviderResponse pullRows(JsonNode rows, PullRequest request, Set<String> expired) {
        if (rows == null || !rows.isArray() || request == null || request.runId() == null || request.asOf() == null) {
            return unavailable();
        }
        try {
            List<JsonNode> cars = new ArrayList<>();
            for (JsonNode row : rows) {
                if (NAMESPACE.equals(row.path("facts").path("sourceNamespace").asText())
                        && fact(row, "plannedRelease").isObject()) cars.add(row);
            }
            cars.sort(Comparator.comparing(row -> row.path("orderNumber").asText()));
            if (cars.isEmpty()) return unavailable();
            Map<String, List<JsonNode>> groups = new LinkedHashMap<>();
            for (JsonNode car : cars) groups.computeIfAbsent(fact(car, "plannedRelease").path("windowStart").asText(),
                    ignored -> new ArrayList<>()).add(car);
            ObjectNode plan = F.objectNode().put("label", LABEL).put("version",
                    fact(cars.get(0), "generatorVersion").asText() + ":" + fact(cars.get(0), "policyVersion").asText());
            ArrayNode windows = plan.putArray("windows");
            groups.entrySet().stream().sorted(Comparator.comparing(e -> Iso.parse(e.getKey()))).forEach(entry -> {
                ObjectNode window = windows.addObject().put("windowId", fact(entry.getValue().get(0), "plannedRelease")
                        .path("releaseId").asText()).put("availableAt", entry.getKey()).putNull("supplyId");
                ArrayNode stock = window.putArray("stock");
                for (JsonNode row : entry.getValue()) {
                    ObjectNode car = stock.addObject();
                    for (String key : PullValidator.STOCK_FIELDS) {
                        if (!"availability".equals(key) && row.has(key)) car.set(key, row.get(key).deepCopy());
                    }
                    car.putObject("availability").put("availableUntil", fact(row, "confirmedDeliveryWeek").asText()
                            + "T00:00:00.000Z");
                }
            });
            Set<String> known = new HashSet<>();
            request.released().forEach(r -> known.addAll(r.orderUuids()));
            Set<String> ended = new HashSet<>();
            for (JsonNode car : cars) {
                var until = Iso.parse(fact(car, "confirmedDeliveryWeek").asText() + "T00:00:00.000Z");
                String uuid = car.path("orderUuid").asText();
                if (until == null) return unavailable();
                if (!known.contains(uuid) && !until.isAfter(request.asOf())) ended.add(uuid);
            }
            if (expired != null) expired.addAll(ended);
            List<PullRequest.Released> released = new ArrayList<>(request.released());
            released.add(new PullRequest.Released("expired", ended.stream().sorted().toList()));
            ProviderResponse result = new TranchePlanProvider(plan).pull(new PullRequest(request.runId(), request.asOf(),
                    request.tickId(), request.releaseSize(), request.leadTimeDays(), request.policyVersion(), released,
                    request.queuedSupply()));
            if (result instanceof ProviderResponse.Ok ok && !ended.isEmpty()) {
                ObjectNode value = ok.value().deepCopy();
                ArrayNode stock = F.arrayNode();
                value.path("stock").forEach(car -> { if (!ended.contains(car.path("orderUuid").asText())) stock.add(car); });
                value.set("stock", stock);
                return new ProviderResponse.Ok(value);
            }
            return result;
        } catch (RuntimeException e) {
            return unavailable();
        }
    }

    static JsonNode fact(JsonNode row, String key) { return row.path("facts").path("facts").path(key).path("value"); }

    private static ProviderResponse unavailable() {
        return new ProviderResponse.Unavailable("stock-source-unavailable", "Stock source is unavailable.");
    }
}
