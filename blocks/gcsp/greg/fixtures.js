// SYNTHETIC fixtures for the Greg dashboard: fictional counts, no real employee, car or retailer.
// Shapes match readDemand's `value`; counts follow the server rule (below the threshold shows a band).

export const FIXTURE_NAMES = Object.freeze(['populated', 'after-release-decline', 'refresh', 'empty', 'no-stock', 'banded', 'unavailable', 'refused', 'conflict', 'loading']);

const POLICY = 'gcsp-policy-v1';
const THRESHOLD_KEY = 'greg.demand.smallCountThreshold';
const MESSAGES = {
  unavailable: 'The demand figures could not be loaded. Try again in a moment.',
  refused: 'Only the scheme ordering lead can open this dashboard. Switch to that session and try again.',
  conflict: 'The figures changed while they were loading. Refresh to see the latest.',
};

// Builds a projection from plain numbers, so the band rule is applied once, the way the server applies it.
function build(spec) {
  const { threshold, briefVersions } = spec;
  const aggregate = (n, brief = briefVersions) => ({
    count: n < threshold ? { kind: 'band', fewerThan: threshold, label: `fewer than ${threshold}` } : { kind: 'exact', value: n, label: String(n) },
    versions: { brief: n > 0 ? [...brief] : [], policy: [POLICY] },
  });
  const group = (pairs, brief) => pairs.map(([key, n]) => ({ key, ...aggregate(n, brief) })).sort((a, b) => a.key.localeCompare(b.key));
  const o = spec.offers;
  return {
    runId: 'demo-fixture-run',
    asOf: spec.asOf,
    projectionVersion: spec.projectionVersion,
    basis: 'expressed-saved-demand',
    versions: { brief: [...briefVersions], policy: [POLICY], clock: spec.clock },
    privacy: { thresholdKey: THRESHOLD_KEY, threshold, policyVersion: POLICY, status: 'assumed' },
    demand: {
      activeBriefs: aggregate(spec.briefs),
      byModelLine: group(spec.model), byBody: group(spec.body), byFuel: group(spec.fuel),
      essentials: spec.essentials.map(([field, operator, value, unit, state, n]) => ({ field, operator, value, unit, state, ...aggregate(n) })),
      unmet: { total: aggregate(spec.unmet), byGate: group(spec.gates) },
    },
    holds: {
      total: aggregate(spec.holds.total, spec.holds.total ? briefVersions : []), active: aggregate(spec.holds.active),
      byState: group(spec.holds.state), byType: group(spec.holds.type),
    },
    offers: {
      made: aggregate(o.made), accepted: aggregate(o.accepted), declined: aggregate(o.declined), expired: aggregate(o.expired),
      selected: aggregate(o.selected), declinedByReason: group(o.reasons),
    },
    stock: { byModelLine: [...spec.stock].sort((a, b) => a[0].localeCompare(b[0])).map(([key, released, held, allocated]) => ({
      key, released: aggregate(released, []), held: aggregate(held, []), allocated: aggregate(allocated, []) })),
      source: spec.source ?? { status: 'ok' } },
  };
}

const NO_OFFERS = { made: 0, accepted: 0, declined: 0, expired: 0, selected: 0, reasons: [] };
const NO_HOLDS = { total: 0, active: 0, state: [], type: [] };
const BASE = { threshold: 5, briefVersions: [1, 2, 3], clock: '41' };

const POPULATED = {
  ...BASE, asOf: '2026-11-05T09:40:00.000Z', projectionVersion: 'fx-populated-7d1c0a94b2e85f36',
  briefs: 28,
  model: [['G21 Touring', 11], ['G60 Saloon', 6], ['G01 X3', 5], ['U06 Active Tourer', 3], ['G26 i4', 2], ['unspecified', 1]],
  body: [['estate', 12], ['suv', 9], ['saloon', 4], ['unspecified', 3]],
  fuel: [['phev', 10], ['ev', 8], ['petrol', 5], ['diesel', 3], ['unspecified', 2]],
  essentials: [
    ['seats', 'gte', 5, 'count', 'confirmed', 15], ['seats', 'gte', 7, 'count', 'confirmed', 4], ['boot', 'gte', 500, 'L', 'confirmed', 7],
    ['modelLine', 'equals', 'G21 Touring', null, 'confirmed', 11], ['charging', 'equals', 'home', null, 'confirmed', 9],
    ['charging', 'equals', null, null, 'needs-confirmation', 3], ['equipment', 'includes', ['towbar'], 'equipment-key', 'confirmed', 5],
  ],
  unmet: 9,
  gates: [['essential-unmet:seats', 5], ['essential-unmet:modelLine', 3], ['not-available', 4], ['driver-unconfirmed', 6], ['declined-unchanged', 2], ['availability-date-unconfirmed', 5]],
  holds: { total: 24, active: 8, state: [['active', 8], ['allocated', 7], ['expired', 4], ['released', 5]], type: [['buddy-offer', 18], ['unconfirmed', 6]] },
  offers: { made: 30, accepted: 9, declined: 12, expired: 4, selected: 7,
    reasons: [['body', 5], ['timing', 3], ['points', 2], ['seats', 2]] },
  stock: [['G01 X3', 3, 2, 5], ['G21 Touring', 8, 3, 4], ['G60 Saloon', 6, 5, 2], ['U06 Active Tourer', 7, 1, 3], ['unconfirmed', 2, 0, 1]],
};

// One more release, one more typed decline, a later demo-clock time: the figures a refresh should move.
const AFTER = {
  ...POPULATED, asOf: '2026-11-05T10:25:00.000Z', projectionVersion: 'fx-after-3be96d02c4f1a758', clock: '43',
  unmet: 8,
  gates: [['essential-unmet:seats', 4], ['essential-unmet:modelLine', 3], ['not-available', 4], ['driver-unconfirmed', 6], ['declined-unchanged', 3], ['availability-date-unconfirmed', 5]],
  offers: { ...POPULATED.offers, declined: 13, reasons: [['body', 6], ['timing', 3], ['points', 2], ['seats', 2]] },
  stock: POPULATED.stock.map((row) => (row[0] === 'G21 Touring' ? [row[0], row[1] + 1, row[2], row[3]] : row)),
};

const EMPTY = {
  ...BASE, briefVersions: [], asOf: '2026-11-05T09:00:00.000Z', projectionVersion: 'fx-empty-a5e20c7d9b4f1368', clock: '1',
  briefs: 0, model: [], body: [], fuel: [], essentials: [], unmet: 0, gates: [], holds: NO_HOLDS, offers: NO_OFFERS,
  stock: [['G21 Touring', 6, 0, 0], ['G60 Saloon', 5, 0, 0]],
};

const NO_STOCK = {
  ...BASE, briefVersions: [1], asOf: '2026-11-05T09:15:00.000Z', projectionVersion: 'fx-nostock-c84f21e0b7a93d56', clock: '9',
  briefs: 12, model: [['G21 Touring', 7], ['G60 Saloon', 5]], body: [['estate', 7], ['suv', 5]], fuel: [['phev', 8], ['petrol', 4]],
  essentials: [['seats', 'gte', 5, 'count', 'confirmed', 12]],
  unmet: 12, gates: [['no-released-stock', 12]], holds: NO_HOLDS, offers: NO_OFFERS, stock: [],
};

const BANDED = {
  ...BASE, briefVersions: [1, 2], asOf: '2026-11-05T09:30:00.000Z', projectionVersion: 'fx-banded-19f6d3a8e07c5b24', clock: '17',
  briefs: 3, model: [['G21 Touring', 2], ['G60 Saloon', 1]], body: [['estate', 2], ['suv', 1]], fuel: [['phev', 3]],
  essentials: [['seats', 'gte', 5, 'count', 'confirmed', 3], ['modelLine', 'equals', 'G21 Touring', null, 'needs-confirmation', 1]],
  unmet: 2, gates: [['essential-unmet:seats', 2], ['driver-unconfirmed', 1]],
  holds: { total: 2, active: 1, state: [['active', 1], ['allocated', 1]], type: [['buddy-offer', 2]] },
  offers: { made: 3, accepted: 1, declined: 1, expired: 1, selected: 1, reasons: [['body', 1]] },
  stock: [['G21 Touring', 2, 1, 1], ['unconfirmed', 1, 0, 0]],
};

const PROJECTIONS = {
  populated: () => build(POPULATED), 'after-release-decline': () => build(AFTER), empty: () => build(EMPTY),
  'no-stock': () => build(NO_STOCK), banded: () => build(BANDED),
};

/** A fresh copy of the named projection (the `value` readDemand returns), or null when the name has none. */
export const fixtureProjection = (name) => (Object.hasOwn(PROJECTIONS, name) ? PROJECTIONS[name]() : null);

function never(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

/** Adapter for the named fixture, or null when the name is unknown. Every load returns fresh objects. */
export function fixtureAdapter(name) {
  if (Object.hasOwn(PROJECTIONS, name)) return { loadDemand: async () => ({ status: 'ready', projection: PROJECTIONS[name]() }) };
  if (name === 'refresh') {
    let loads = 0;
    return { loadDemand: async () => ({ status: 'ready', projection: PROJECTIONS[loads++ === 0 ? 'populated' : 'after-release-decline']() }) };
  }
  const state = (status) => ({ loadDemand: async () => ({ status, message: MESSAGES[status] }) });
  if (name === 'unavailable' || name === 'refused' || name === 'conflict') return state(name);
  if (name === 'loading') return { loadDemand: ({ signal } = {}) => never(signal) };
  return null;
}
