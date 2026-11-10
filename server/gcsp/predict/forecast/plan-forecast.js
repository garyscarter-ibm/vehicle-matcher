import { inputDigest } from '../../repository/core.js';
import { createExpressedOrderForecastProvider } from '../plan/forecast.js';
import { createPolicyFutureTermsProvider } from '../plan/terms.js';
import { createLearnedDemandForecastProvider, LEARNED_BASIS } from './provider.js';
import { createPredictionInput, FORECAST_CONTRACT_VERSION } from './input.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Smallest set of choices, likeliest first, whose share of the non-wait mass reaches the threshold.
function likeliest(choices, threshold) {
  const ranked = [...choices].sort((a, b) => b.probability - a.probability || compare(a.derivativeId, b.derivativeId));
  const mass = ranked.reduce((sum, c) => sum + c.probability, 0);
  const kept = []; let cumulative = 0;
  for (const c of ranked) {
    if (kept.length && cumulative >= threshold * mass - 1e-12) break;
    kept.push(c.derivativeId); cumulative += c.probability;
  }
  return kept.sort(compare);
}

// The planner's forecast port, backed by the learned model. Gates come from the expressed provider;
// the model only narrows each permitted set, so it cannot relax a gate. Read-only repository access.
export function createLearnedOrderForecastProvider({ repository, identity, clock, catalog, futureChoices, policy, artifactDirectory } = {}) {
  const readOnly = typeof repository?.query === 'function' ? Object.freeze({ query: (...args) => repository.query(...args) }) : undefined;
  const expressedProvider = createExpressedOrderForecastProvider({ repository: readOnly, identity, clock, catalog, futureChoices, predictionContext: true });
  const terms = createPolicyFutureTermsProvider({ policy });
  const demand = createLearnedDemandForecastProvider({ policy, artifactDirectory });
  return Object.freeze({
    async readForecast(context, read) {
      const expressed = await expressedProvider.readForecast(context, read);
      if (expressed.status !== 'ok') return expressed;
      const choices = await catalog.readCatalog(context, read);
      if (choices.status !== 'ok') return choices;
      if (choices.value.version !== expressed.value.provenance.catalogVersion) return { status: 'conflict', code: 'planning-forecast-changed', contractVersion: FORECAST_CONTRACT_VERSION };
      const prepared = await createPredictionInput(context, { expressed: expressed.value, catalog: choices.value, terms, read });
      if (prepared.status !== 'ok') return prepared;
      const forecast = await demand.forecast(context, prepared.value, { runId: read.runId, asOf: read.asOf, policyVersion: read.policyVersion });
      if (forecast.status === 'fallback') return { status: 'unavailable', code: 'learned-forecast-fallback', contractVersion: FORECAST_CONTRACT_VERSION, fallback: forecast };
      if (forecast.status !== 'ok') return forecast;
      const { choiceMassThreshold, waitExclusionThreshold } = forecast.settings;
      const rows = new Map(forecast.employees.map((e) => [e.entitlementId, e]));
      const entitlements = []; const waiting = [];
      for (const e of expressed.value.forecast.entitlements) {
        const modelled = rows.get(e.entitlementId);
        if (!modelled) return { status: 'unavailable', code: 'learned-forecast-incomplete', contractVersion: FORECAST_CONTRACT_VERSION };
        if (modelled.waitProbability > waitExclusionThreshold) { waiting.push({ employeeId: e.employeeId, reason: 'model-expects-wait' }); continue; }
        entitlements.push({ ...structuredClone(e), acceptableDerivativeIds: likeliest(modelled.choices, choiceMassThreshold) });
      }
      const share = `${Math.round(choiceMassThreshold * 100)}%`;
      const { value } = expressed;
      return { status: 'ok', contractVersion: FORECAST_CONTRACT_VERSION, value: { runId: value.runId, asOf: value.asOf, policyVersion: value.policyVersion,
        version: inputDigest({ expressed: value.version, demandForecast: forecast.version }), cohortVersion: value.cohortVersion,
        forecast: { basis: LEARNED_BASIS, horizonEnd: value.forecast.horizonEnd, entitlements,
          limitations: [...new Set([`Learned model: each employee keeps the likeliest permitted vehicles covering ${share} of the modelled choice probability.`,
            'Employees the model expects to wait are left out of the learned plan.', ...forecast.limitations, ...value.forecast.limitations])] },
        provenance: { ...value.provenance, source: 'learned-demand-forecast-over-F99-saved-briefs', expressedVersion: value.version,
          model: forecast.model, data: forecast.data, settings: forecast.settings, modelExpectsWait: waiting.length,
          excluded: [...value.provenance.excluded, ...waiting] },
        demandForecast: forecast } };
    },
  });
}
