package gcsp.api.production;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.planning.SubmissionHistory;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Optional;

/**
 * What Greg's order-plan read shows after a Production submission: the replan state from the stored submissions and
 * responses (Node replanFor). Without a database nothing can have been submitted. A failed read never breaks the plan.
 */
@ApplicationScoped
public class ProductionSubmissionHistory implements SubmissionHistory {

    static final String UNAVAILABLE = "production-history-unavailable";

    @Inject
    ProductionServiceHolder holder;

    @Override
    public JsonNode replan(RunContext context, JsonNode plan) {
        ObjectNode none = JsonNodeFactory.instance.objectNode().put("status", "no-submission");
        try {
            Optional<ProductionService> service = holder.service();
            if (service.isEmpty() || plan == null) return none;
            ProductionResult r = service.get().replanFor(context, plan.path("planId").asText(""));
            if (r instanceof ProductionResult.Ok ok && ok.value() != null) return ok.value();
        } catch (RuntimeException e) {
            // falls through to the unavailable value below
        }
        return JsonNodeFactory.instance.objectNode().put("status", "unavailable").put("code", UNAVAILABLE);
    }
}
