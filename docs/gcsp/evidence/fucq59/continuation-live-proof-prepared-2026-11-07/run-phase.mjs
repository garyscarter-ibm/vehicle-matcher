/** Explicit grant only. No default transport/run; retained primary is outside scratch. */
import { readFile, open, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { validateBmwBatchPlan } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';

const base = dirname(fileURLToPath(import.meta.url));
const root = resolve(base, '../../../../..');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const encode = (v) => JSON.stringify(v) + '\n';
const gate = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
async function bytes(path, limit = 16 * 1024 * 1024) {
  const info = await lstat(path); gate(info.isFile() && !info.isSymbolicLink() && info.size <= limit, 'proof-file-refused');
  const value = await readFile(path); gate(value.length <= limit, 'proof-file-refused'); return value;
}
async function save(path, value, append = false) {
  const file = await open(path, append ? 'a' : 'wx', 0o600);
  try { await file.writeFile(encode(value)); await file.sync(); } finally { await file.close(); }
  const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
export async function context(grantPath) {
  const grantBytes = await bytes(grantPath, 65536); const grant = JSON.parse(grantBytes);
  gate(grant.schemaVersion === 'f59-proof-executable-grant.v1' && ['live', 'offline-contract'].includes(grant.mode)
    && grant.authorization === 'root-grant-after-review-and-source-lane-clear' && grant.sourceLaneClear === true,
  'proof-grant-required');
  gate(/^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(grant.runId || '')
    && ['A', 'B'].every((p) => /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(grant.allocations?.[p] || ''))
    && grant.allocations.A !== grant.allocations.B, 'proof-allocation-refused');
  const contractBytes = await bytes(join(base, 'execution-contract.json'), 65536);
  gate(sha(contractBytes) === grant.contractSha256, 'proof-contract-pin'); const contract = JSON.parse(contractBytes);
  for (const [path, expected] of Object.entries(contract.codePins)) gate(sha(await bytes(join(root, path))) === expected, 'proof-code-pin');
  for (const [path, expected] of Object.entries(contract.inputPins)) gate(sha(await bytes(join(grant.inputsRoot, path))) === expected, 'proof-input-pin');
  const planBytes = await bytes(join(base, 'collection-plan.json')); gate(sha(planBytes) === contract.planFileSha256, 'proof-plan-pin');
  const plan = validateBmwBatchPlan(JSON.parse(planBytes)); gate(inputDigest(plan) === contract.planDigest, 'proof-plan-pin');
  gate(plan.candidateCount === 2 && plan.limits.sourceAttempts === 5 && plan.limits.sourceBytes === 2097152
    && plan.limits.deadlineMs === 45000 && plan.limits.maxAttempts === 1 && plan.limits.concurrency === 1, 'proof-bounds');
  const preparation = JSON.parse(await bytes(join(base, 'preparation.json')));
  const index = JSON.parse(await bytes(join(grant.inputsRoot, preparation.priorIndex.path)));
  const spent = JSON.parse(await bytes(join(grant.inputsRoot, preparation.priorIndex.requestIndexPath)));
  const reservation = JSON.parse(await bytes(join(grant.inputsRoot, preparation.reservation.path)));
  for (const candidate of plan.candidates) {
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request });
    gate(reservation.candidates.some((row) => row.candidateId === candidate.candidateId && row.requestDigest === digest
      && inputDigest(row.request) === inputDigest(candidate.request)) && !spent.entries.some((row) => row.requestDigest === digest), 'proof-spent-request');
  }
  gate(grant.mode !== 'live' || new Date().toISOString().slice(0, 10) === plan.qualificationDate, 'proof-source-day');
  return { grant, grantSha256: sha(grantBytes), contract, plan, preparation, index };
}
export async function runPhase(grantPath, phase, forceHold = false) {
  gate(['A', 'B'].includes(phase), 'proof-phase-refused');
  const c = await context(grantPath); const { grant, plan, preparation, index } = c;
  gate(!forceHold || grant.mode === 'offline-contract' && phase === 'A', 'proof-force-live-refused');
  const retained = await realpath(grant.retainedRoot); const directory = await realpath(join(retained, `phase-${phase.toLowerCase()}`));
  gate(dirname(directory) === retained && !(await lstat(grant.retainedRoot)).isSymbolicLink(), 'proof-retained-path');
  const statePath = join(directory, 'collector-checkpoint.json');
  const predecessorPath = join(retained, 'phase-a/collector-checkpoint.json');
  const binding = JSON.parse(await bytes(join(retained, 'execution-binding.json'), 65536));
  gate(binding.grantSha256 === c.grantSha256 && binding.contractSha256 === grant.contractSha256, 'proof-grant-binding');
  let predecessorBytes;
  if (phase === 'B') {
    predecessorBytes = await bytes(predecessorPath, plan.limits.checkpointBytes);
    const prior = JSON.parse(await bytes(join(retained, 'phase-a/supervisor-receipt.json'), 65536));
    gate(prior.proofReady === true && prior.checkpointSha256 === sha(predecessorBytes), 'proof-predecessor-refused');
    const selected = JSON.parse(await bytes(join(retained, 'successor-selected.json'), 65536));
    gate(selected.allocationId === grant.allocations.B && selected.predecessorSha256 === sha(predecessorBytes)
      && selected.statePath === statePath && selected.grantSha256 === c.grantSha256, 'proof-successor-refused');
  }
  let actualAttempts = 0; let failure = null; let interrupted = false; let result; let replayCalls = null;
  const nativeFetch = globalThis.fetch;
  const transport = grant.mode === 'live' ? nativeFetch : (await import('./tests/fixture-transport.mjs')).fixtureTransport(plan, root);
  if (grant.mode === 'offline-contract') globalThis.fetch = () => { throw Object.assign(new Error('proof-network-forbidden'), { code: 'proof-network-forbidden' }); };
  const now = grant.mode === 'live' ? Date.now : () => Date.parse(plan.qualificationDate + 'T12:00:00.000Z');
  const limits = { ...plan.limits, requestBudgets: { ...plan.limits.requestBudgets, solve: 1 } };
  const input = { plan, source: plan.source, mode: 'live', statePath, now,
    policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    batchBinding: { producerPins: preparation.batchBinding.producerPins, snapshotVersion: preparation.batchBinding.snapshotVersion, existingConfigurationIds: index.entries.map((row) => row.configurationId) },
    ...(phase === 'B' ? { continuation: { checkpointPath: predecessorPath, checkpointSha256: sha(predecessorBytes), limits } } : {}),
    http: { kind: 'live', allocation: { id: grant.allocations[phase], sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: 5, bytes: 2097152 },
      fetch: async (url, options) => {
        actualAttempts += 1; gate(actualAttempts <= 5, 'proof-attempt-ceiling');
        await save(join(directory, 'source-events.jsonl'), { phase: 'started', attempt: actualAttempts, method: options.method, url }, true);
        const response = await transport(url, options);
        await save(join(directory, 'source-events.jsonl'), { phase: 'headers', attempt: actualAttempts, status: response.status }, true);
        return response;
      } },
    onPhase: async (name, detail) => {
      if (phase !== 'A' || name !== 'outcome-committed' || detail.cursor !== 1) return;
      const current = await bytes(statePath, plan.limits.checkpointBytes);
      await save(join(directory, 'ready.json'), { pid: process.pid, cursor: 1, checkpointSha256: sha(current) });
      if (forceHold) await new Promise(() => { setInterval(() => {}, 1000); });
      throw Object.assign(new Error('proof-interruption'), { code: 'proof-interruption' });
    } };
  // Construction checks an inherited refusal before this new once marker.
  const collector = await createFleetCollector(input);
  await save(join(directory, 'execution-once.json'), { schemaVersion: 'f59-proof-once.v1', allocation: input.http.allocation,
    grantSha256: c.grantSha256, state: 'reserved-and-consumed', phase, statePath });
  try { result = await collector.run(); }
  catch (error) { interrupted = phase === 'A' && error.code === 'proof-interruption'; failure = interrupted ? null
    : /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'proof-runner-stopped'; }
  let state; let raw;
  try {
    raw = await bytes(statePath, plan.limits.checkpointBytes);
    state = await collector.session.withCheckpoint(async ({ state }) => structuredClone(state));
    gate(inputDigest(state) === JSON.parse(raw).contentDigest, 'proof-checkpoint-integrity');
    if (phase === 'B' && !failure && state.cursor === 2 && !state.halted) {
      const before = actualAttempts; await (await createFleetCollector(input)).run(); replayCalls = actualAttempts - before;
      gate(replayCalls === 0 && sha(await bytes(predecessorPath)) === sha(predecessorBytes), 'proof-replay-or-predecessor-changed');
    }
  } catch (error) { failure ||= /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'proof-checkpoint-invalid'; }
  const complete = state?.sourceCaptures.length === (phase === 'A' ? 1 : 2) && state.rejected.length === 0
    && state.accepted.length + state.duplicates.length === (phase === 'A' ? 1 : 2);
  const ready = phase === 'A' ? complete && interrupted && state?.cursor === 1 && state.halted === null && state.counts.httpAttempts === 5
    : complete && state?.cursor === 2 && state.halted === null && result?.counts.httpAttempts === 10 && replayCalls === 0;
  const receipt = { schemaVersion: 'f59-proof-phase.v1', phase, classification: grant.mode === 'live' ? 'actual-live' : 'scripted-contract-only',
    proofReady: Boolean(ready && !failure), failure, interrupted, grantSha256: c.grantSha256, planDigest: inputDigest(plan),
    actualAttempts, actualSourceRequests: grant.mode === 'live' ? actualAttempts : 0, checkpointSha256: raw ? sha(raw) : null,
    counts: state?.counts || null, cumulativeCounts: result?.counts || state?.counts || null, cursor: state?.cursor ?? null,
    accepted: state?.accepted.length ?? null, duplicates: state?.duplicates.length ?? null, rejected: state?.rejected.length ?? null,
    replayCalls, predecessorSha256: predecessorBytes ? sha(predecessorBytes) : null, acceptance: false };
  await save(join(directory, 'phase-receipt.json'), receipt);
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await runPhase(process.argv[2], process.argv[3], process.argv[4] === '--force-hold');
    console.log(encode(receipt).trim()); process.exitCode = receipt.proofReady ? receipt.phase === 'A' ? 75 : 0 : 1;
  } catch (error) { console.log(encode({ status: 'refused', code: /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'proof-preflight-refused' }).trim()); process.exitCode = 1; }
}
