import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { runComparison, validateExperiment } from './experiments.js';
import { createReplayPolicy, defaultCodeRevision, describeFailure } from './job.js';
import { refusedBoundary } from './requests.js';

// Runs one comparison and reports to the parent: invalid, or plan then progress then result, or failed.
async function runWorkerJob(port, { experiment, codeRevision, fixedNow, overlay }) {
  const policy = createReplayPolicy();
  const now = fixedNow === undefined ? () => new Date().toISOString() : () => fixedNow;
  try {
    const request = { ...experiment, ...(overlay && { overlay }) };
    // git runs synchronously, so the revision is read here and never on the main thread.
    const revision = codeRevision ?? defaultCodeRevision(process.env);
    let plan;
    try { plan = await validateExperiment(request, { policy, now }); } catch (error) {
      const boundary = refusedBoundary(error);
      if (boundary === null) throw error;
      port.postMessage({ type: 'invalid', boundary });
      return;
    }
    port.postMessage({ type: 'plan', steps: plan.steps, seeds: [...plan.seeds], arms: plan.arms.map((arm) => arm.armId) });
    const onProgress = ({ completed, total, armId, seed, route }) => port.postMessage({ type: 'progress', completed, total, armId, seed, route });
    const result = await runComparison(request, { policy, codeRevision: revision, now, onProgress });
    port.postMessage({ type: 'result', result });
  } catch (error) {
    port.postMessage({ type: 'failed', reason: describeFailure(error).reason });
  } finally { await Promise.resolve(policy.close()).catch(() => {}); }
}

// Importing this file on the main thread starts nothing; only a worker created for a job runs it.
if (!isMainThread && parentPort) await runWorkerJob(parentPort, workerData);
