/** Deterministic local preparation only. Never issues HTTP requests. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildCandidateQueue } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const relative = path => path.slice(root.length); const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => JSON.parse(await readFile(path)); const save = (name, value) => writeFile(join(base, name), JSON.stringify(value, null, 2) + '\n');
const source = join(root, 'docs/gcsp/evidence/fucq59/f70-remaining-options-qualification-2026-11-07');
const original = await read(join(root, 'docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/collection-plan.json'));
const indexRoot = '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f70-typed-axis1024-20261107-once/chunks/chunk32';
const indexPins = {
  canonical: { path: join(indexRoot, 'final-canonical-index.json'), sha256: '93c3905d8eb839a385f8153da9862c6f817bad45dcf555147af720cc7a919099' },
  spent: { path: join(indexRoot, 'final-spent-request-index.json'), sha256: '8216b0c0ee92750e2984ca2a4cb7a252c2e8df84449d43b6e58ff5b074b2ecbb' },
};
const indexes = {};
for (const [name, pin] of Object.entries(indexPins)) {
  const bytes = await readFile(pin.path); if (sha(bytes) !== pin.sha256) throw new Error('prior-index-pin-mismatch');
  indexes[name] = JSON.parse(bytes); pin.digest = inputDigest(indexes[name]); pin.entries = indexes[name].entries.length;
}
if (indexPins.canonical.entries !== 872 || indexPins.spent.entries !== 1582) throw new Error('prior-index-count-mismatch');
indexPins.canonical.admittedSourceEntries = indexes.canonical.entries.filter(row => row.origins.some(origin => origin.kind === 'admitted-source')).length;
if (indexPins.canonical.admittedSourceEntries !== 869) throw new Error('prior-admitted-count-mismatch');
const contextIds = ['1f7a', '1f7c', '1f7d', '1f7f']; const plans = []; const provenance = []; const sourcePins = {};
const sourcePin = async path => { sourcePins[relative(path)] = sha(await readFile(path)); };
for (const id of contextIds) {
  const prior = await read(join(source, id, 'qualification-plan.json')); const optionsPath = join(source, id, 'options.json');
  const options = await read(optionsPath); const definitions = options.report.candidates[0].definitions;
  const plan = { ...structuredClone(original), planId: `f70-model-breadth-${id}-20261107`, seed: 'f70-model-breadth-minimal-20261107',
    source: { ...original.source, version: 'f59-model-batch-20261107.v1' }, models: [prior.modelRegistration.modelCode],
    modelRegistration: prior.modelRegistration, lineRegistration: prior.lineRegistration,
    limits: { ...original.limits, maxCandidates: 1, sourceAttempts: 5, sourceBytes: 4194304, checkpointBytes: 4194304, deadlineMs: 60000,
      requestBudgets: { page: 1, settings: 1, discover: 1, options: 1, solve: 1 } } };
  delete plan.knownSelection; plan.candidates = buildCandidateQueue(plan, { definitions }); validatePublicBmwPlan(plan); plans.push(plan);
  const request = plan.candidates[0].request;
  if (indexes.spent.entries.some(row => row.requestDigest === inputDigest({ modelRegistration: plan.modelRegistration, request }))) throw new Error('spent-request-replay');
  const typed = ['paint', 'fabric', 'rim'].map(type => {
    const matches = definitions.filter(row => request.includedElements.includes(row.code) && row.optionType === type && row.option === row.code && row.issues.length === 0);
    if (matches.length !== 1) throw new Error('candidate-direct-type-mismatch'); return { type, definition: matches[0] };
  });
  provenance.push({ id, model: plan.modelRegistration, line: plan.lineRegistration, candidate: plan.candidates[0], typedInputs: typed,
    lineInput: plan.lineRegistration.optionsQuery.kind === 'trim' ? definitions.find(row => row.code === plan.lineRegistration.optionsQuery.code) : { state: 'absent-own-source-line-option' },
    inputOptions: relative(optionsPath), requestDigest: inputDigest({ modelRegistration: plan.modelRegistration, request }),
    bindingRequestDigest: inputDigest({ modelRegistration: plan.modelRegistration, lineRegistration: plan.lineRegistration, request }),
    constructibility: 'unverified-candidate-only' });
  await mkdir(join(base, id), { recursive: true }); await save(`${id}/collection-plan.json`, plan);
  for (const name of ['qualification-plan.json', 'tree.json', 'options.json', 'line-relationships.json', 'receipt.json']) await sourcePin(join(source, id, name));
}
await sourcePin(join(source, 'series-receipt.json')); await save('candidate-provenance.json', { schemaVersion: 'f70-model-breadth-candidate-provenance.v1', seed: plans[0].seed, sourcePins, contexts: provenance });
const planDigest = inputDigest(plans); const codePins = {};
for (const path of ['scripts/gcsp/bmw-public-registration.mjs', 'scripts/gcsp/public-bmw-source.mjs', 'scripts/gcsp/collection-session.mjs',
  'scripts/gcsp/collect-fleet.mjs', 'scripts/gcsp/configuration-key.mjs', 'scripts/gcsp/bmw-selection-binding.mjs', 'scripts/gcsp/capture-bmw-selection.mjs',
  'scripts/gcsp/bmw-source-qualification.mjs', 'scripts/gcsp/settings-shape-report.mjs', 'server/gcsp/repository/core.js', 'server/gcsp/policy/index.js', 'server/gcsp/policy/file-provider.js', 'server/gcsp/policy/seed-v1.json', 'server/vehicle-evidence/bmw-catalogue-adapter.js', 'server/vehicle-evidence/bmw-catalogue-v2.js', 'server/gcsp/repository/schema.js',
  '_tools/test_resources.py', 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py',
  ...['prepare.mjs', 'run-live.mjs', 'supervise.py', 'prepared-check.test.mjs'].map(name => relative(join(base, name)))]) codePins[path] = sha(await readFile(join(root, path)));
const allocation = { schemaVersion: 'f70-model-breadth-execution-plan.v1', id: `f70-model-breadth-20261107-${planDigest.slice(0, 16)}`,
  codeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), planDigest, contextIds,
  contextPlanDigests: Object.fromEntries(contextIds.map((id, i) => [id, inputDigest(plans[i])])),
  contextUrls: Object.fromEntries(contextIds.map((id, i) => [id, bmwBatchPlanRequestUrls(plans[i], plans[i].candidates[0].request)])),
  publicGetCeiling: 20, solverCeiling: 4, decodedByteCeiling: 16777216, sourceVersion: plans[0].source.version,
  codePins, sourcePins, indexPins, producerPins: { projectorSha256: codePins['scripts/gcsp/capture-bmw-selection.mjs'],
    qualifierSha256: codePins['scripts/gcsp/bmw-selection-binding.mjs'], sessionSha256: codePins['scripts/gcsp/collection-session.mjs'], policyVersion: plans[0].policyRead.policyVersion },
  snapshotVersion: 'f70-model-breadth-pilot-20261107.v2', resources: { hostRamMiB: 512, childRamMiB: 448, scratchMiB: 64, chunkSeconds: 120, seriesSeconds: 300,
    workers: 1, expectedChildRamMiB: 160, expectedScratchMiB: 8, expectedRetainedMiB: 24,
    supervisorOutput: '/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-model-breadth/live',
    largeOutputRoot: '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/_agent-output/vehicle-matcher/f70-model-breadth-20261107', largeOutputThresholdBytes: 268435456 },
  limits: { retries: 0, automaticRedirects: 0, sourceWrites: 0, images: 0, browser: 0, candidatesPerContext: 1 },
  trafficExecuted: false, exactRootGrantRequired: true, acceptance: false, noAutomaticContinuation: true,
  stop: 'First failed, incomplete or duplicate-only context stops the series; no new candidate, retry or replay is allocated.' };
await save('execution-plan.json', allocation); console.log(JSON.stringify({ id: allocation.id, planDigest, publicGetCeiling: 20, sourceTraffic: false }));
