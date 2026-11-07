import { mountPresenterControls } from '../../../../blocks/gcsp/presenter-controls/controls.js';

const refused = new URLSearchParams(globalThis.location.search).get('state') === 'refused';
const ok = (value) => ({ status: 'ok', value });
const state = { runId: 'synthetic-visual-only', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '1',
  currentScenario: { scenarioId: 'visual', name: 'Synthetic rendering only' }, lastTick: null,
  principals: [{ principalId: 'synthetic', name: 'Synthetic presenter', roles: ['presenter'] }],
  controls: { step: { value: 60, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable', reason: 'No business operation in visual fixture' } } };
const host = document.querySelector('[data-visual-controls]');
const controls = mountPresenterControls(host, { adapter: {
  readControls: async () => ok(structuredClone(state)),
  readContext: async () => ok({ principalId: 'synthetic', name: 'Synthetic presenter', roles: ['presenter'] }),
  readScenarios: async () => ok({ policyVersion: 'visual-only', scenarios: [{ scenarioId: 'visual', name: 'Synthetic rendering only',
    scenarioVersion: 'visual-only', fixtureVersion: 'visual-only', availability: { available: false, missingCapabilities: ['business-operation-intentionally-absent'] } }] }),
  tick: async () => {
    state.now = '2026-11-05T09:01:00.000Z'; state.clockVersion = '2';
    state.lastTick = { tickId: 'synthetic-tick', state: refused ? 'interrupted' : 'pending',
      handlerOrder: [{ handlerId: 'synthetic-release', stage: 'release-pull' }, { handlerId: 'synthetic-outbox', stage: 'outbox-dispatch' }],
      outcomes: [{ handlerId: 'synthetic-release', stage: 'release-pull', outcome: refused
        ? { status: 'forbidden', reason: 'Synthetic source refused release' }
        : { status: 'pending', operationId: 'synthetic-operation', lastKnownState: 'unknown' } }], missingStages: ['manual-expiry'] };
    return refused ? { status: 'unavailable', reason: 'Synthetic tick interrupted after committed advance',
      advance: { now: state.now, clockVersion: state.clockVersion }, tick: state.lastTick,
      handlerOutcome: state.lastTick.outcomes[0].outcome }
      : ok({ advance: { now: state.now, clockVersion: state.clockVersion }, tick: state.lastTick });
  },
} });
controls.root.open = true;
