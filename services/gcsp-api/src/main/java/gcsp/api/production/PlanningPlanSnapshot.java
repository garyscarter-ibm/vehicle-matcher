package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import gcsp.api.identity.Principal;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.OrderPlanOperations;
import gcsp.api.planning.OrderPlanService;
import gcsp.api.planning.PlanningCatalog;
import gcsp.api.planning.PlanningClock;
import gcsp.api.planning.PlanningDemand;
import gcsp.api.planning.PlanningSupply;
import gcsp.api.policy.PolicyRead;
import gcsp.api.policy.PolicyService;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The real plan port: Greg's current order plan from the planner (the same computation as his order-plan read), with
 * each ordered derivative mapped to its Production model and derivative by the policy catalogue (Node submitPlan).
 * Any planner outcome other than a plan is passed on with the planner's own code; a plan is never made up.
 */
public final class PlanningPlanSnapshot implements PlanSnapshotPort {

    static final String MAPPING_MISSING = "planning-catalog-mapping-missing";
    private static final String NOT_READY = "Greg's order plan cannot be read right now, so nothing can be sent to Production.";

    private final PolicyService policy;
    private final OrderPlanService planner;
    private final OrderPlanOperations drafts;

    public PlanningPlanSnapshot(PolicyService policy, PlanningDemand demand, PlanningSupply supply, PlanningClock clock) {
        this.policy = policy;
        this.planner = new OrderPlanService(policy, demand, supply, clock);
        this.drafts = new OrderPlanOperations(policy, demand, supply, clock, (c, p) -> null);
    }

    @Override
    public String mode() {
        return "planning";
    }

    @Override
    public Reading current(RunContext ctx, Principal principal) {
        return read(ctx, principal, planner.readPlan(principal, principal.policyVersion()), null);
    }

    @Override
    public Reading current(RunContext ctx, Principal principal, JsonNode changes) {
        if (changes == null) return current(ctx, principal);
        OrderPlanOperations.Draft draft = drafts.draftFor(principal, changes);
        if (draft.failure() == null) return read(ctx, principal, draft.plan(), draft.changes());
        JsonNode f = draft.failure();
        if ("invalid".equals(f.path("status").asText())) {
            return new Invalid(f.path("code").asText("invalid-changes"), f.path("reasons").path(0).path("reason").asText(NOT_READY));
        }
        return notPlan(f);
    }

    private Reading read(RunContext ctx, Principal principal, JsonNode plan, JsonNode changes) {
        String status = plan.path("status").asText("");
        if (!"feasible".equals(status) && !"infeasible".equals(status)) {
            return notPlan(plan);
        }
        Instant asOf;
        try {
            asOf = Instant.parse(plan.path("asOf").asText(""));
        } catch (DateTimeParseException e) {
            return new Unavailable("planning-plan-invalid", NOT_READY);
        }
        Map<String, String> versions = new LinkedHashMap<>();
        plan.path("versions").fields().forEachRemaining(e -> versions.put(e.getKey(), e.getValue().asText()));
        boolean feasible = "feasible".equals(status);
        List<Line> lines = new ArrayList<>();
        if (feasible) {
            JsonNode catalog = new PlanningCatalog(policy).readCatalog(ctx.runId(),
                    new PolicyRead(ctx.runId(), plan.path("asOf").asText(), principal.policyVersion()));
            if (!"ok".equals(catalog.path("status").asText())) return notPlan(catalog);
            for (JsonNode q : plan.path("quantities")) {
                if (!q.path("quantity").isNumber() || q.path("quantity").doubleValue() <= 0) continue;
                if (!q.path("quantity").isIntegralNumber() || !q.path("quantity").canConvertToInt()) {
                    return new Unavailable("planning-quantity-invalid", NOT_READY);
                }
                String derivativeId = q.path("derivativeId").asText("");
                JsonNode production = null;
                for (JsonNode d : catalog.path("value").path("derivatives")) {
                    if (derivativeId.equals(d.path("derivativeId").asText())) production = d.path("production");
                }
                if (production == null || production.path("model").asText("").isEmpty()
                        || production.path("derivative").asText("").isEmpty()) {
                    return new Unavailable(MAPPING_MISSING, "Production's names for an ordered model are missing from the policy catalogue.");
                }
                lines.add(new Line(derivativeId, production.get("model").asText(), production.get("derivative").asText(),
                        q.get("quantity").asInt()));
            }
        }
        return new Snapshot(plan.path("planId").asText(), versions, feasible, asOf, lines, changes);
    }

    /** The planner's own code, with its reason when it gave one. */
    private static Unavailable notPlan(JsonNode outcome) {
        String code = outcome.path("code").asText("");
        if (code.isEmpty()) code = "forbidden".equals(outcome.path("status").asText()) ? "role-required" : "planning-source-unavailable";
        String reason = outcome.path("reason").asText("");
        return new Unavailable(code, reason.isEmpty() ? NOT_READY : reason);
    }
}
