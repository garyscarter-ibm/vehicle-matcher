import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { inputDigest, ok, result } from '../repository/core.js';
import { requireGregOrPresenter } from './http.js';
import { refusalFor } from './requests.js';
import { COMPARISON_RESULTS_RUN, comparisonResultsScope, ensureResultsRun, storeComparisonResult } from './results.js';

export const JOBS_KEY = 'comparison.jobs.v1';
const TABLE = 'comparison_jobs';
const WORKER_URL = new URL('./worker.js', import.meta.url);
const FAILED = 'The comparison could not be completed.';
const EXITED = 'The comparison worker stopped before it finished.';
const RERUNS_OFF = 'Reruns are prepared offline and are not started from this screen.';
const BACKEND_STOPPED = 'The backend stopped before the comparison finished.';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const command = (commandId, input) => ({ commandId, inputDigest: inputDigest(input) });
const unavailable = (reason, extra = {}) => result('unavailable', { reason, retryable: true, ...extra });
const limitsOf = (outcome, context) => {
  const row = outcome?.value?.value;
  const good = outcome?.status === 'ok' && (typeof context.policyVersion !== 'string' || outcome.policyVersion === context.policyVersion)
    && plain(row) && row.schemaVersion === 1 && Number.isFinite(row.timeoutSeconds) && row.timeoutSeconds > 0
    && Number.isSafeInteger(row.workerHeapMb) && row.workerHeapMb > 0
    && Number.isSafeInteger(row.workerYoungGenerationMb) && row.workerYoungGenerationMb > 0;
  return good ? { timeoutSeconds: row.timeoutSeconds, workerHeapMb: row.workerHeapMb, workerYoungGenerationMb: row.workerYoungGenerationMb } : null;
};

const emptyProgress = () => ({ seedsDone: 0, seedsTotal: 0, stepsDone: 0, stepsTotal: 0 });
const view = (row) => ({ jobId: row.jobId, experimentId: row.experimentId, status: row.status, progress: { ...row.progress },
  startedAt: row.startedAt, finishedAt: row.finishedAt, resultId: row.resultId, reason: row.reason, request: structuredClone(row.request) });
// What the worker is given has no change for process-only; what is stored and shown always has the key.
const shown = (request) => ({ experimentId: request.experimentId, change: request.change ?? null });
const startingView = (job) => view({ jobId: job.jobId, experimentId: job.request.experimentId, status: 'starting', progress: job.progress,
  startedAt: job.startedAt, finishedAt: null, resultId: null, reason: null, request: shown(job.request) });

// One comparison at a time in a worker thread, with its state in comparison_jobs (Greg or presenter only).
// Creating the service spawns and schedules nothing. Starting is off unless `reruns` (GCSP_COMPARISON_RERUNS=1) is on.
export function createComparisonJobService({ repository, policy, clock, identity, instanceId = randomUUID(),
  createWorker = (url, options) => new Worker(url, options), codeRevision, fixedNow, overlay,
  reruns = process.env.GCSP_COMPARISON_RERUNS === '1' } = {}) {
  const wallClock = () => fixedNow ?? new Date().toISOString();
  let active = null;
  let sequence = 0;

  // One writer per job: patches made while a write is in flight merge into the next write, so versions never race.
  const queue = (job, patch) => {
    job.pending = { ...job.pending, ...patch };
    job.flush ??= (async () => {
      try {
        while (job.pending) {
          const next = job.pending; job.pending = null;
          const saved = await repository.transaction(job.scope, command(`comparison-job-write:${job.jobId}:${sequence += 1}`, next), async (tx) => {
            const written = await tx.compareAndSwap({ table: TABLE, key: { runId: COMPARISON_RESULTS_RUN, jobId: job.jobId } }, job.version, next);
            return written.status === 'ok' ? ok({ version: written.value.version }) : written;
          });
          if (saved.status === 'ok') job.version = saved.value.version;
        }
      } catch { /* the row stays as last written; a later restart marks it interrupted */ } finally { job.flush = null; }
    })();
    return job.flush;
  };

  const settle = (job) => { job.settled = true; clearTimeout(job.timer); };
  const stop = (job) => { job.worker?.terminate().catch(() => {}); };

  // Ends a job that has a row. The slot is free at once; the terminal write follows.
  function end(job, patch) {
    settle(job); stop(job);
    job.ended = true;
    job.ending = (async () => {
      await queue(job, { ...patch, finishedAt: wallClock(), progress: { ...job.progress } });
      if (active === job) active = null;
    })();
    return job.ending;
  }
  const fail = (job, reason) => end(job, { status: 'failed', reason });

  // A job that ended before its plan has no row, so start() answers and the slot is freed.
  function abandon(job, outcome) {
    settle(job); stop(job);
    job.ended = true;
    if (active === job) active = null;
    job.answer(outcome);
  }

  async function onPlan(job, message) {
    if (!Array.isArray(message.seeds) || !Array.isArray(message.arms) || !Number.isSafeInteger(message.steps)) {
      return abandon(job, unavailable(FAILED));
    }
    job.phase = 'recording';
    job.seeds = message.seeds.length; job.stepsPerSeed = message.arms.length * 2;
    job.progress = { seedsDone: 0, seedsTotal: message.seeds.length, stepsDone: 0, stepsTotal: message.steps };
    const row = { runId: COMPARISON_RESULTS_RUN, jobId: job.jobId, experimentId: job.request.experimentId, status: 'running',
      request: shown(job.request), progress: { ...job.progress }, startedAt: job.startedAt, finishedAt: null, resultId: null, reason: null,
      requestedBy: job.context.principalId, instanceId };
    let saved;
    try {
      const run = await ensureResultsRun(repository, job.scope, job.startedAt);
      if (run.status === 'ok') saved = await repository.transaction(job.scope, command(`comparison-job-start:${job.jobId}`, row), (tx) => tx.insert(TABLE, row));
      else saved = run;
    } catch { saved = null; }
    if (job.settled) {
      // Stopped while the row was being written: close the row so nothing stays running.
      if (saved?.status === 'ok') {
        job.version = saved.value.version;
        await queue(job, { ...(job.closed ? { status: 'interrupted', reason: BACKEND_STOPPED } : { status: 'failed', reason: FAILED }), finishedAt: wallClock() });
      }
      return;
    }
    if (saved?.status !== 'ok') return abandon(job, unavailable('The comparison job could not be recorded.'));
    job.version = saved.value.version; job.phase = 'running';
    job.answer(result('pending', { value: view(row) }));
    // Messages that arrived while the row was being written.
    for (const later of job.backlog.splice(0)) handle(job)(later);
    if (job.exited && !job.settled) stopped(job, EXITED);
  }

  function onProgress(job, message) {
    if (job.phase !== 'running' || !Number.isSafeInteger(message.completed)) return;
    const done = (job.perSeed.get(message.seed) ?? 0) + 1;
    job.perSeed.set(message.seed, done);
    const seedsDone = [...job.perSeed.values()].filter((count) => count >= job.stepsPerSeed).length;
    job.progress = { seedsDone, seedsTotal: job.seeds, stepsDone: message.completed, stepsTotal: job.progress.stepsTotal };
    queue(job, { progress: { ...job.progress } });
  }

  async function onResult(job, message) {
    settle(job);
    let stored;
    try { stored = await storeComparisonResult(repository, job.context, message.result); } catch { stored = null; }
    if (stored?.status !== 'ok') return end(job, { status: 'failed', reason: 'The comparison finished but its result could not be stored.' });
    return end(job, { status: 'succeeded', resultId: stored.value.resultId });
  }

  const reasonOf = (message) => (typeof message.reason === 'string' && message.reason ? message.reason : FAILED);
  const handle = (job) => (message) => {
    if (job.settled || !plain(message)) return;
    if (job.phase === 'recording') { job.backlog.push(message); return; }
    if (message.type === 'invalid' && job.phase === 'starting') {
      return abandon(job, refusalFor(typeof message.boundary === 'string' ? message.boundary : 'overlay', job.request.experimentId, job.request.change));
    }
    if (message.type === 'plan' && job.phase === 'starting') return onPlan(job, message);
    if (job.phase === 'starting') return abandon(job, unavailable(message.type === 'failed' ? reasonOf(message) : FAILED));
    if (message.type === 'progress') return onProgress(job, message);
    if (message.type === 'result') { job.ending = onResult(job, message); return job.ending; }
    if (message.type === 'failed') return fail(job, reasonOf(message));
  };
  const stopped = (job, reason) => (job.phase === 'running' ? fail(job, reason) : abandon(job, unavailable(reason)));

  function spawn(job, limits) {
    const worker = createWorker(WORKER_URL, { resourceLimits: { maxOldGenerationSizeMb: limits.workerHeapMb, maxYoungGenerationSizeMb: limits.workerYoungGenerationMb },
      workerData: { experiment: job.request, codeRevision, fixedNow, overlay } });
    job.worker = worker;
    // The timer is unref'd and cleared on every end, so it never keeps the backend alive.
    job.timer = setTimeout(() => {
      if (job.settled) return;
      stopped(job, `The comparison was stopped at its limit of ${limits.timeoutSeconds} seconds.`);
    }, Math.min(limits.timeoutSeconds * 1000, 2 ** 31 - 1));
    job.timer.unref();
    worker.on('message', handle(job));
    worker.on('error', (error) => {
      if (job.settled) return;
      stopped(job, error?.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? `The comparison used more than its ${limits.workerHeapMb} MB memory allowance and was stopped.` : FAILED);
    });
    // An exit during the row write waits for it, so the worker's last messages are handled first.
    worker.on('exit', () => {
      if (job.phase === 'recording') job.exited = true;
      else if (!job.settled) stopped(job, EXITED);
    });
  }

  // Rows another backend instance left running can never finish, so they are marked interrupted.
  async function interruptStale(context) {
    let rows;
    try { rows = await repository.query(comparisonResultsScope(context), TABLE); } catch { return; }
    for (const row of rows.status === 'ok' ? rows.value : []) {
      if (row.status !== 'running' || row.instanceId === instanceId) continue;
      const patch = { status: 'interrupted', finishedAt: wallClock(), reason: 'The backend restarted before the comparison finished.' };
      await repository.transaction(comparisonResultsScope(context), command(`comparison-job-interrupt:${row.jobId}`, patch), async (tx) => {
        const written = await tx.compareAndSwap({ table: TABLE, key: { runId: COMPARISON_RESULTS_RUN, jobId: row.jobId } }, row.version, patch);
        return written.status === 'ok' ? ok({ version: written.value.version }) : written;
      }).catch(() => {});
    }
  }

  const running = (job) => result('conflict', { code: 'job-running', jobId: job.jobId,
    reason: 'A comparison is already running. Wait for it to finish.' });
  const busy = () => (active && !active.ended ? active : null);

  return {
    get reruns() { return reruns === true; },

    async start(context, experiment) {
      const allowed = await requireGregOrPresenter(identity, context);
      if (allowed.status !== 'ok') return allowed;
      if (reruns !== true) return result('forbidden', { code: 'comparison-reruns-off', reason: RERUNS_OFF });
      if (busy()) return running(busy());
      if (!plain(experiment) || typeof experiment.experimentId !== 'string') return refusalFor('experimentId');
      let request;
      try { request = { experimentId: experiment.experimentId, ...(experiment.change !== undefined && { change: structuredClone(experiment.change) }) }; }
      catch { return refusalFor('change'); }
      let limits;
      try {
        const time = await clock.now(context);
        if (time.status !== 'ok') return time;
        const read = await policy.getAssumption(JOBS_KEY, { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion });
        limits = limitsOf(read, context);
        await interruptStale(context);
      } catch { return unavailable('The comparison could not be started.'); }
      if (!limits) return unavailable(`The comparison job limits (${JOBS_KEY}) are not available.`, { key: JOBS_KEY });
      // No await between this check and the claim, so two starts can never both run.
      if (busy()) return running(busy());
      const job = { jobId: `comparison-job-${randomUUID()}`, context, scope: comparisonResultsScope(context), request,
        startedAt: wallClock(), phase: 'starting', settled: false, ended: false, perSeed: new Map(), progress: emptyProgress(), version: null,
        pending: null, flush: null, ending: null, backlog: [] };
      active = job;
      return new Promise((resolve) => {
        job.answer = resolve;
        try { spawn(job, limits); } catch { abandon(job, unavailable('The comparison worker could not be started.')); }
      });
    },

    async read(context, { jobId } = {}) {
      const allowed = await requireGregOrPresenter(identity, context);
      if (allowed.status !== 'ok') return allowed;
      let rows;
      try {
        await interruptStale(context);
        rows = await repository.query(comparisonResultsScope(context), TABLE);
      } catch { return unavailable('The comparison job could not be read.'); }
      if (rows.status !== 'ok') return rows;
      const known = rows.value.map((row, index) => ({ row, index }));
      const live = active && !known.some(({ row }) => row.jobId === active.jobId) && (jobId === undefined || active.jobId === jobId) ? active : null;
      if (live) return ok(startingView(live));
      const pick = (jobId === undefined ? known : known.filter(({ row }) => row.jobId === jobId))
        .sort((a, b) => (a.row.startedAt < b.row.startedAt ? 1 : a.row.startedAt > b.row.startedAt ? -1 : b.index - a.index))[0];
      return pick ? ok(view(pick.row)) : result('not-found', { resourceType: TABLE });
    },

    // Stops an active worker and marks its job interrupted (the backend stopped).
    async close() {
      const job = active;
      if (!job) return;
      job.closed = true;
      if (!job.settled) {
        if (job.phase === 'running') await end(job, { status: 'interrupted', reason: BACKEND_STOPPED });
        else abandon(job, unavailable('The backend stopped before the comparison started.'));
      }
      await job.ending;
      await job.flush;
    },
  };
}
