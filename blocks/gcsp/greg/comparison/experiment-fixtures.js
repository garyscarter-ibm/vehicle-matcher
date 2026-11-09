// SYNTHETIC fixtures for the experiment panel: fictional cohort and figures. Never selected by the live dashboard.
// Every answer goes through the pure mappings in http-adapter.js; job progress advances one step per readJob call.
import { listOutcomeToState, resultOutcomeToState, startOutcomeToState, jobOutcomeToState } from './http-adapter.js';
import { STORED_NO_CLEAR_DIFFERENCE } from './stored-fixture.js';
import { STORED_HOLD_SWEEP } from './experiment-fixture.js';

const JOB_SCENARIOS = ['job-running', 'job-succeeds', 'job-fails', 'job-interrupted', 'start-invalid', 'start-conflict', 'start-refused'];
export const EXPERIMENT_FIXTURE_NAMES = Object.freeze(['experiments-ready', 'experiments-empty', 'experiments-old-policy', 'experiments-refused', 'experiments-unavailable', ...JOB_SCENARIOS]);

const ACTIVE = 'gcsp-policy-v1';
const SEEDS = 3;
const STARTED_AT = '2026-11-09T12:00:00.000Z';
const FINISHED_AT = '2026-11-09T12:05:00.000Z';
const JOB_ID = 'comparison-job-fixture-0001';
const NEW_RESULT_ID = 'hold-sweep-comparison-fixture-rerun';
const DEFAULT_REQUEST = { experimentId: 'hold-sweep', change: { values: [3600, 10800], basis: 'Does a longer hold help?' } };
const REASONS = {
  failed: 'The comparison used more than its 128 MB memory allowance and was stopped.',
  interrupted: 'The backend stopped before the comparison finished.',
  conflict: 'A comparison is already running. Wait for it to finish.',
  invalid: 'Give no more holds than the policy allows, each within the allowed range, different from the others and from the hold used today.',
};

const processStored = () => ({ ...structuredClone(STORED_NO_CLEAR_DIFFERENCE), resultId: 'process-comparison-fixture-experiments' });
const holdStored = () => structuredClone(STORED_HOLD_SWEEP);
const oldHold = () => ({ ...holdStored(), policyCurrent: false, activePolicyVersion: 'gcsp-policy-v2', resultId: 'hold-sweep-comparison-fixture-old-policy' });

// A new hold-sweep result for the chosen values: arms reuse the fixture's figures in turn, so only labels and ids are new.
function rerunStored({ values, basis }) {
  const stored = holdStored(); const { result } = stored; const first = result.effects;
  result.effects = values.map((v, i) => ({ ...structuredClone(first[i % first.length]), armId: `hold-${v}`, value: v }));
  const [baseArm, ...armTemplates] = result.arms; const [baseManifest, ...manifestTemplates] = result.manifest.arms;
  result.arms = [baseArm, ...values.map((v, i) => ({ ...structuredClone(armTemplates[i % armTemplates.length]), armId: `hold-${v}`, value: v }))];
  result.manifest.arms = [baseManifest, ...values.map((v, i) => ({ ...structuredClone(manifestTemplates[i % manifestTemplates.length]), armId: `hold-${v}`, value: v }))];
  result.manifest.change.values = [...values]; result.manifest.change.basis = basis;
  result.completedAt = FINISHED_AT;
  return { ...stored, resultId: NEW_RESULT_ID, storedAt: FINISHED_AT };
}

const jobBody = (request, status, stepsDone, stepsTotal, extra = {}) => ({
  jobId: JOB_ID, experimentId: request.experimentId, status,
  progress: { seedsDone: stepsTotal ? Math.floor(stepsDone / (stepsTotal / SEEDS)) : 0, seedsTotal: SEEDS, stepsDone, stepsTotal },
  startedAt: STARTED_AT, finishedAt: null, resultId: null, reason: null, request, ...extra,
});
const stepsFor = (request) => {
  const tried = request.change?.values?.length ?? 1;
  return (tried + 1) * SEEDS * 2;
};

// Frames after the first one: each readJob call moves to the next, then stays on the last.
function framesFor(name, request) {
  const total = stepsFor(request); const third = total / SEEDS;
  const run = (n) => jobBody(request, 'running', n * third, total);
  if (name === 'job-running' || name === 'start-conflict') return [run(1), run(2)];
  if (name === 'job-succeeds') return [run(1), run(2), jobBody(request, 'succeeded', total, total, { finishedAt: FINISHED_AT, resultId: NEW_RESULT_ID })];
  if (name === 'job-fails') return [run(1), jobBody(request, 'failed', third, total, { finishedAt: FINISHED_AT, reason: REASONS.failed })];
  if (name === 'job-interrupted') return [run(1), jobBody(request, 'interrupted', third, total, { finishedAt: FINISHED_AT, reason: REASONS.interrupted })];
  return [];
}

const FORBIDDEN = { status: 'forbidden', reason: 'This person cannot perform that action.' };

/** { loadAll, loadResult, start, readJob } for the named scenario, or null when the name is unknown. State lives in the returned adapter. */
export function experimentFixtureAdapter(name) {
  if (!EXPERIMENT_FIXTURE_NAMES.includes(name)) return null;
  if (name === 'experiments-refused' || name === 'experiments-unavailable') {
    const [code, body] = name === 'experiments-refused' ? [403, { status: 'forbidden' }] : [503, { status: 'unavailable', retryable: true }];
    return {
      loadAll: async () => listOutcomeToState(code, body), loadResult: async () => resultOutcomeToState(code, body),
      start: async () => startOutcomeToState(code, body), readJob: async () => jobOutcomeToState(code, body),
    };
  }
  let request = null; let frames = []; let index = -1; let started = false;
  const begin = (next) => { request = next; frames = framesFor(name, next); index = -1; started = true; };
  if (name === 'job-running') begin(DEFAULT_REQUEST);
  const current = () => (index < 0 ? jobBody(request, 'running', 0, stepsFor(request)) : frames[Math.min(index, frames.length - 1)]);
  const done = () => started && current().status === 'succeeded';
  const listing = () => {
    const hold = name === 'experiments-empty' ? null : name === 'experiments-old-policy' ? oldHold() : done() && request.change?.values ? rerunStored(request.change) : holdStored();
    const proc = name === 'experiments-empty' ? null : processStored();
    return { activePolicyVersion: name === 'experiments-old-policy' ? 'gcsp-policy-v2' : ACTIVE, experiments: [
      { experimentId: 'process-only', latest: proc }, { experimentId: 'order-mix', latest: null }, { experimentId: 'points', latest: null }, { experimentId: 'hold-sweep', latest: hold }] };
  };
  return {
    loadAll: async () => listOutcomeToState(200, { status: 'ok', value: listing() }),
    loadResult: async (experimentId) => {
      const latest = listing().experiments.find((e) => e.experimentId === experimentId)?.latest ?? null;
      return latest ? resultOutcomeToState(200, { status: 'ok', value: latest }) : resultOutcomeToState(404, { status: 'not-found', resourceType: 'comparison_results' });
    },
    start: async ({ experimentId, change } = {}) => {
      if (name === 'start-refused') return startOutcomeToState(403, FORBIDDEN);
      if (name === 'start-invalid') return startOutcomeToState(400, { status: 'invalid', code: 'invalid-experiment', reasons: [{ field: 'change.values', key: 'hold.buddy.durationSeconds', reason: REASONS.invalid }] });
      // The 409 names a job someone else started just now, so readJob can then watch it.
      if (name === 'start-conflict' && !started) begin(DEFAULT_REQUEST);
      if (name === 'start-conflict' || name === 'job-running') return startOutcomeToState(409, { status: 'conflict', code: 'job-running', jobId: JOB_ID, reason: REASONS.conflict });
      begin({ experimentId: experimentId ?? DEFAULT_REQUEST.experimentId, change: change ?? DEFAULT_REQUEST.change });
      return startOutcomeToState(202, { status: 'pending', value: current() });
    },
    readJob: async ({ jobId } = {}) => {
      if (!started || (jobId && jobId !== JOB_ID)) return jobOutcomeToState(404, { status: 'not-found', resourceType: 'comparison_jobs' });
      index = Math.min(index + 1, frames.length - 1);
      return jobOutcomeToState(200, { status: 'ok', value: current() });
    },
  };
}
