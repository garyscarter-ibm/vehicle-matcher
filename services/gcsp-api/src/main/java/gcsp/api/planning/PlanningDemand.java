package gcsp.api.planning;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;

/**
 * Port for the expressed-order forecast (Node createExpressedOrderForecastProvider): {status, value} with runId, asOf,
 * policyVersion, version, cohortVersion and forecast. Read-only, under the policy in force for this read.
 */
public interface PlanningDemand {

    ObjectNode readForecast(PlanningRead read, PolicyService policy);
}
