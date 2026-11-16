package gcsp.api.planning;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.persistence.RunContext;
import gcsp.api.policy.PolicyService;
import io.quarkus.arc.DefaultBean;
import jakarta.enterprise.context.ApplicationScoped;

/** Production defaults until the real adapters exist; each is replaced by providing another bean. No synthetic fallback. */
public final class PlanningDefaults {

    private PlanningDefaults() {}

    /** Greg demand projections (FUCQ-475) bind this port later. */
    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredDemand implements PlanningDemand {
        @Override
        public ObjectNode readForecast(PlanningRead read, PolicyService policy) {
            return Outcomes.unavailable("planning-forecast-not-configured");
        }
    }

    /** The PostgreSQL supply adapter binds this port in the next slice. */
    @DefaultBean
    @ApplicationScoped
    public static class UnconfiguredSupply implements PlanningSupply {
        @Override
        public ObjectNode readSupply(PlanningRead read, PolicyService policy) {
            return Outcomes.unavailable("planning-supply-not-configured");
        }
    }

    /** Nothing can have been submitted from this service until FUCQ-478 exists. */
    @DefaultBean
    @ApplicationScoped
    public static class NoSubmissions implements SubmissionHistory {
        @Override
        public JsonNode replan(RunContext context, JsonNode plan) {
            return Outcomes.object().put("status", "no-submission");
        }
    }
}
