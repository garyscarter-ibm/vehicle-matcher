import { result } from '../repository/index.js';
import { STOCK_FIELDS } from './port.js';
import { createSyntheticStockProvider } from './synthetic-provider.js';

const NAMESPACE = 'synthetic:stock-generator.v1';
const LABEL = 'Synthetic scheme stock generated on the retained FUCQ-61 corpus; not BMW stock';
const unavailable = () => result('unavailable', { reason: 'Stock source is unavailable.', retryable: true });
const value = (row, name) => row.facts.facts?.[name]?.value;
const byOrder = (a, b) => (a.orderNumber < b.orderNumber ? -1 : a.orderNumber > b.orderNumber ? 1 : 0);

function planFor(runId, rows) {
  const cars = rows.filter((row) => row.facts?.sourceNamespace === NAMESPACE && value(row, 'plannedRelease')).sort(byOrder);
  if (!cars.length) return null;
  const groups = new Map();
  for (const row of cars) {
    const start = value(row, 'plannedRelease').windowStart;
    groups.set(start, [...(groups.get(start) ?? []), row]);
  }
  const windows = [...groups.entries()].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([availableAt, members]) => ({
    windowId: value(members[0], 'plannedRelease').releaseId, availableAt, supplyId: null,
    stock: members.map((row) => ({ ...Object.fromEntries(STOCK_FIELDS.filter((key) => row[key] !== undefined && key !== 'availability').map((key) => [key, row[key]])),
      availability: { availableUntil: `${value(row, 'confirmedDeliveryWeek')}T00:00:00.000Z` } })) }));
  const version = `${value(cars[0], 'generatorVersion')}:${value(cars[0], 'policyVersion')}`;
  return createSyntheticStockProvider({ runId, version, label: LABEL, windows });
}

/** Pull-port source over a run's generated stock rows, read once per run on its first pull.
 * contextForRun is trusted composition's scoped read context; without it the source is unavailable. */
export function createGeneratedStockProvider({ repository, contextForRun } = {}) {
  if (typeof repository?.query !== 'function') throw new TypeError('Inject the repository read port.');
  const plans = new Map();
  return Object.freeze({
    async pull(request) {
      if (typeof request?.runId !== 'string' || !request.runId || typeof contextForRun !== 'function') return unavailable();
      try {
        if (!plans.has(request.runId)) {
          const context = await contextForRun(request.runId);
          if (context?.runId !== request.runId) return unavailable();
          const rows = await repository.query(context, 'stock');
          if (rows.status !== 'ok') return unavailable();
          const plan = planFor(request.runId, rows.value);
          if (!plan) return unavailable();
          plans.set(request.runId, plan);
        }
        return await plans.get(request.runId).pull(request);
      } catch { return unavailable(); }
    },
  });
}
