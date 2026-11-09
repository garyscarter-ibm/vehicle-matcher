import { createPolicyOrderPlanCatalog } from './catalog.js';
import { createPolicyFutureTermsProvider } from './terms.js';
import { createFutureChoiceEvaluator } from './future-choices.js';
import { createOrderPlanSupplyProvider } from './supply.js';
import { createOrderPlanService } from './service.js';
import { createLearnedOrderForecastProvider } from '../forecast/plan-forecast.js';

// Canonical wiring: policy catalogue and future terms, the real evaluator, saved-demand
// forecast and F104 supply. A supply port may be injected until those tables are on this base.
export function createCanonicalOrderPlanService({ repository, policy, identity, clock, supply } = {}) {
  const catalog = createPolicyOrderPlanCatalog({ policy });
  const futureChoices = createFutureChoiceEvaluator({ policy, identity, terms: createPolicyFutureTermsProvider({ policy }) });
  return createOrderPlanService({ repository, policy, identity, clock, catalog, futureChoices,
    supply: supply ?? createOrderPlanSupplyProvider({ repository, identity, clock, catalog }) });
}

// The same planner run on the learned forecast. readLearnedPlan also returns the forecast value the plan used.
export function createLearnedOrderPlanService({ repository, policy, identity, clock, supply, artifactDirectory } = {}) {
  const catalog = createPolicyOrderPlanCatalog({ policy });
  const futureChoices = createFutureChoiceEvaluator({ policy, identity, terms: createPolicyFutureTermsProvider({ policy }) });
  const learned = createLearnedOrderForecastProvider({ repository, identity, clock, catalog, futureChoices, policy, artifactDirectory });
  const resolvedSupply = supply ?? createOrderPlanSupplyProvider({ repository, identity, clock, catalog });
  const build = (seen) => createOrderPlanService({ repository, policy, identity, clock, catalog, futureChoices, supply: resolvedSupply,
    forecast: { async readForecast(context, read) { const out = await learned.readForecast(context, read); if (out.status === 'ok') seen.value = out.value; return out; } } });
  return Object.freeze({
    readPlan: (context, request) => build({}).readPlan(context, request),
    async readLearnedPlan(context) {
      const seen = {}; const plan = await build(seen).readPlan(context);
      return { plan, forecast: seen.value?.version === plan?.versions?.forecast ? seen.value : undefined };
    },
  });
}
