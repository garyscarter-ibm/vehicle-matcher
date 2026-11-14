package gcsp.api.clock.bound;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.clock.HandlerOutcome;
import gcsp.api.clock.TickHandler;
import gcsp.api.clock.TickRequest;
import gcsp.api.scenario.ScenarioFaults;
import gcsp.api.supply.ReleaseResult;
import gcsp.api.supply.SupplyRelease;
import gcsp.api.supply.SupplySelection;
import gcsp.api.supply.TickEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/** Releases stock on the release-pull stage; registered only when a pull provider is configured, as in Node. */
@ApplicationScoped
public class StockReleaseHandler implements TickHandler {

    public static final String ID = "stock-release";
    public static final String STAGE = "release-pull";

    @Inject
    SupplyRelease supply;

    @Inject
    SupplySelection selection;

    @Inject
    ScenarioFaults faults;

    @Override
    public String handlerId() {
        return ID;
    }

    @Override
    public String stage() {
        return STAGE;
    }

    @Override
    public boolean enabled() {
        return !"none".equals(selection.provider().mode());
    }

    @Override
    public HandlerOutcome handle(TickRequest request) {
        HandlerOutcome faulted = fault(request);
        if (faulted != null) return faulted;
        TickEvent event = new TickEvent(request.tickId(), request.now(), request.clockVersion());
        return map(supply.release().deliver(request.scope(), event));
    }

    /** The presenter's synthetic stock fault applies only to the synthetic tranche-plan; a real provider is untouched. */
    private HandlerOutcome fault(TickRequest request) {
        if (!SupplySelection.TRANCHE_PLAN.equals(selection.provider().mode())) return null;
        return switch (faults.stockMode(request.scope())) {
            case "unavailable" -> new HandlerOutcome.Failed("unavailable", "synthetic-stock-unavailable", true);
            case "stale" -> new HandlerOutcome.Failed("unavailable", "stock-source-stale", true);
            default -> null;
        };
    }

    /** OK keeps the release outcome; a stale run is reported as stale-run so the tick stops as stale. */
    static HandlerOutcome map(ReleaseResult result) {
        if (result.status() == ReleaseResult.Status.OK) {
            ObjectNode value = result.value() instanceof ObjectNode o ? o.deepCopy()
                    : JsonNodeFactory.instance.objectNode();
            value.put("replayed", result.replayed());
            return new HandlerOutcome.Ok(value);
        }
        if (result.status() == ReleaseResult.Status.CONFLICT && "stale-run".equals(result.code())) {
            return new HandlerOutcome.Failed("stale-run", "stale-run", false);
        }
        String code = result.code() == null ? "release-failed" : result.code();
        return new HandlerOutcome.Failed(result.status().name().toLowerCase(), code, result.retryable());
    }
}
