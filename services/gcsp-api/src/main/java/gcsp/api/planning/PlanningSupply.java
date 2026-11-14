package gcsp.api.planning;

import com.fasterxml.jackson.databind.node.ObjectNode;
import gcsp.api.policy.PolicyService;

/**
 * Port for stock, confirmed supply and Production activity (Node createOrderPlanSupplyProvider). Returns {status, value}
 * where value carries runId, asOf, versions{stock, supply, catalog}, stock, inbound, requests, responses and unboundStock.
 */
public interface PlanningSupply {

    ObjectNode readSupply(PlanningRead read, PolicyService policy);
}
