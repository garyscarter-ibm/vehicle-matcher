// Inputs for later journey loaders, never calculated outcomes or a second policy source.
const actors = ['demo-paula', 'demo-alex', 'demo-greg', 'demo-presenter'];
const journey = (scenarioId, name, ownerStory, epics, stories, capabilities, inputs, steps, variants = [], fixtureVersion = `${scenarioId}-inputs-v1`) => ({
  scenarioId, name, ownerStory, kind: 'journey', scenarioVersion: 'gcsp-acceptance-scenarios-v1',
  fixtureVersion, epics, stories, requiredCapabilities: capabilities,
  principalIds: actors, inputs, steps, variants,
});
const brief = (principalId, essentials = { seats: 5, charging: 'not-ready' }) => ({
  principalId, service: 'brief', operation: 'confirm', preferences: { body: { value: 'estate', importance: 80 } },
  essentials, consent: { search: true, hold: true },
});
export const SCENARIO_INPUTS_V1 = [
  journey('main-successful-journey', 'Main successful journey', 'FUCQ-109', ['FUCQ-86', 'FUCQ-87', 'FUCQ-88', 'FUCQ-89'],
    ['FUCQ-91', 'FUCQ-92', 'FUCQ-96', 'FUCQ-100', 'FUCQ-102', 'FUCQ-106', 'FUCQ-107', 'FUCQ-108', 'FUCQ-109'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-offers', 'captured-notifications', 'offer-decisions', 'brief-change', 'order-handoff'],
    { briefs: [brief('demo-paula')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [] },
    [{ operation: 'advance', to: 'release' }, { operation: 'tick', purpose: 'release-and-allocation' }, { operation: 'employee', purpose: 'decline-change-review-and-accept' }, { operation: 'tick', purpose: 'reconciliation-if-pending' }]),
  journey('no-suitable-match', 'No suitable match', 'FUCQ-127', ['FUCQ-87', 'FUCQ-90', 'FUCQ-75'],
    ['FUCQ-95', 'FUCQ-96', 'FUCQ-99', 'FUCQ-127'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-activity', 'greg-demand'],
    { briefs: [brief('demo-paula', { seats: 9, charging: 'not-ready' }), brief('demo-alex')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [] },
    [{ operation: 'advance', to: 'release' }, { operation: 'tick', purpose: 'release-and-allocation' }]),
  journey('decline-then-change', 'Decline then change', 'FUCQ-128', ['FUCQ-86', 'FUCQ-87', 'FUCQ-89', 'FUCQ-75'],
    ['FUCQ-96', 'FUCQ-100', 'FUCQ-106', 'FUCQ-107', 'FUCQ-128'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-offers', 'offer-decisions', 'brief-change'],
    { briefs: [brief('demo-paula')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [],
      prepare: ['release-through-service', 'allocate-through-service'], change: { path: 'preferences.body.value', value: 'saloon' } },
    [{ operation: 'employee', purpose: 'decline-and-confirm-one-change' }, { operation: 'advance', to: 'release' }, { operation: 'tick', purpose: 'recompute-from-changed-brief' }],
    // v2: the reviewed demo stock has no SUV, so the change is to saloon. The waiting variant moved to FUCQ-173.
    ['later-suitable-stock'], 'decline-then-change-inputs-v2'),
  journey('offer-expires', 'Offer expires', 'FUCQ-129', ['FUCQ-87', 'FUCQ-88', 'FUCQ-89', 'FUCQ-75'],
    ['FUCQ-96', 'FUCQ-100', 'FUCQ-102', 'FUCQ-106', 'FUCQ-129'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-offers', 'captured-notifications', 'offer-expiry'],
    { briefs: [{ ...brief('demo-paula'), preferences: { body: { value: 'hatchback', importance: 80 } } }, brief('demo-alex')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [],
      prepare: ['release-through-service', 'allocate-through-service', 'capture-notification-through-service'] },
    [{ operation: 'advance', to: 'active-offer.expiresAt', policyKey: 'hold.buddy.durationSeconds' }, { operation: 'tick', purpose: 'expiry-before-reallocation' }, { operation: 'employee', purpose: 'reopen-old-offer-link' }],
    // v2 (FUCQ-227): Paula prefers the hatch, so Alex (G1-6, eligible only for it) waits and is offered it when hers lapses.
    [], 'offer-expires-inputs-v2'),
  journey('data-unavailable', 'Data unavailable', 'FUCQ-130', ['FUCQ-87', 'FUCQ-90', 'FUCQ-75'],
    ['FUCQ-92', 'FUCQ-95', 'FUCQ-99', 'FUCQ-130'],
    ['brief-confirmation', 'stock-release', 'buddy-activity', 'greg-demand', 'synthetic-stock-fault'],
    { briefs: [brief('demo-paula')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [], syntheticStockFault: 'unavailable' },
    [{ operation: 'advance', to: 'release' }, { operation: 'tick', purpose: 'observe-failed-pull-without-stock-change' }, { operation: 'presenter', purpose: 'clear-synthetic-stock-fault' }, { operation: 'tick', purpose: 'retry-release-through-service' }], ['unavailable', 'stale']),
  // v2 (FUCQ-131): Alex competes for stock, and each resolution is its own entry so the presenter can choose it.
  ...['acknowledged', 'rejected'].map((resolution) => journey(resolution === 'acknowledged' ? 'uncertain-handoff' : 'uncertain-handoff-rejected',
    `Uncertain handoff, ${resolution}`, 'FUCQ-131', ['FUCQ-89', 'FUCQ-110', 'FUCQ-75'],
    ['FUCQ-100', 'FUCQ-106', 'FUCQ-108', 'FUCQ-131'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-offers', 'offer-decisions', 'order-handoff', 'ordering-reconciliation', 'synthetic-order-fault'],
    { briefs: [brief('demo-paula'), brief('demo-alex')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [],
      prepare: ['release-through-service', 'allocate-through-service'], syntheticOrderingFault: `timeout-${resolution}` },
    [{ operation: 'employee', purpose: 'accept-offer' }, { operation: 'tick', purpose: 'reconcile-existing-operation-before-retry' }], [resolution],
    resolution === 'acknowledged' ? 'uncertain-handoff-inputs-v2' : 'uncertain-handoff-rejected-inputs-v1')),
  // FUCQ-173: preferences only rank cars, so the one change is an essential no released car has; Paula waits.
  journey('decline-then-change-waiting', 'Decline then change, no second car yet', 'FUCQ-173', ['FUCQ-86', 'FUCQ-87', 'FUCQ-89', 'FUCQ-75'],
    ['FUCQ-96', 'FUCQ-100', 'FUCQ-106', 'FUCQ-107', 'FUCQ-128', 'FUCQ-173'],
    ['brief-confirmation', 'stock-release', 'buddy-allocation', 'buddy-offers', 'offer-decisions', 'brief-change'],
    { briefs: [brief('demo-paula')], stockTranches: [{ source: 'published-demo-stock', cue: 'release' }], pendingOperations: [],
      prepare: ['release-through-service', 'allocate-through-service'],
      change: { reasonCode: 'equipment', path: 'essentials.equipment', value: ['Tow bar'] } },
    [{ operation: 'employee', purpose: 'decline-and-confirm-one-change' }, { operation: 'tick', purpose: 'recompute-from-changed-brief' }],
    ['waiting-for-suitable-stock']),
];

export const MECHANICS_SCENARIO = {
  scenarioId: 'gcsp-clock-scenario-v1', name: 'Clock/reset mechanics (fictional support fixture)', kind: 'mechanics', ownerStory: 'FUCQ-85',
  epics: ['FUCQ-79', 'FUCQ-75'], stories: ['FUCQ-84', 'FUCQ-85', 'FUCQ-125'], principalIds: actors,
  requiredCapabilities: ['canonical-principals', 'canonical-clock-fixture'],
  inputs: { briefs: [], stockTranches: [{ source: 'canonical-clock-fixture', cue: 'release' }], pendingOperations: [] },
  steps: [{ operation: 'advance', to: 'release' }, { operation: 'tick', purpose: 'inspect-registered-and-missing-handlers' }], variants: [],
};
