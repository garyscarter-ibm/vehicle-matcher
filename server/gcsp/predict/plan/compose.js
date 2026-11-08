import { createPolicyOrderPlanCatalog } from './catalog.js';
import { createPolicyFutureTermsProvider } from './terms.js';
import { createFutureChoiceEvaluator } from './future-choices.js';
import { createOrderPlanSupplyProvider } from './supply.js';
import { createOrderPlanService } from './service.js';

// Canonical wiring: policy catalogue and future terms, the real evaluator, saved-demand
// forecast and F104 supply. A supply port may be injected until those tables are on this base.
export function createCanonicalOrderPlanService({ repository, policy, identity, clock, supply } = {}) {
  const catalog = createPolicyOrderPlanCatalog({ policy });
  const futureChoices = createFutureChoiceEvaluator({ policy, identity, terms: createPolicyFutureTermsProvider({ policy }) });
  return createOrderPlanService({ repository, policy, identity, clock, catalog, futureChoices,
    supply: supply ?? createOrderPlanSupplyProvider({ repository, identity, clock, catalog }) });
}
