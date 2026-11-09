// FUCQ-151 offline benchmark: in-process stub fetch only; global fetch is disabled.
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
globalThis.fetch = () => { throw new Error('network disabled in FUCQ-151 benchmark'); };
const W = process.env.VM_ROOT; // repository root
const [moduleUrl, countText, out, label] = process.argv.slice(2); const count = Number(countText);
const { createFleetCollector } = await import(moduleUrl);
const { PolicyService, FilePolicyProvider } = await import(`file://${W}/server/gcsp/policy/index.js`);
const { inputDigest } = await import(`file://${W}/server/gcsp/repository/core.js`);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const original = JSON.parse(await readFile(`${W}/docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/collection-plan.json`));
const definitions = JSON.parse(await readFile(`${W}/docs/gcsp/evidence/fucq59/canonical-source-live-2026-11-06/options.json`)).report.candidates[0].definitions;
const byType = (t) => definitions.filter((r) => r.optionType === t).map((r) => r.code);
const [paints, fabrics, rims] = ['paint', 'fabric', 'rim'].map(byType);
const combos = []; for (const p of paints) for (const f of fabrics) for (const r of rims) combos.push([p, f, r]);
const plan = { ...structuredClone(original), planId: 'fucq151-bench', seed: 'fucq151-bench', source: { ...original.source, version: 'f59-batch-20261107.v1' },
  target: count, candidateCount: count, modelRegistration: { schemaVersion: 'bmw-public-model-registration.v1', modelCode: 'T5MJ', agModelCode: '72HH',
    catalogueRangeKey: 'G61E', rawModelRange: 'G61', aliases: ['5', 'I'], market: 'GB', locale: 'en-GB', steering: 'RL',
    catalogueDate: '2026-11-01', orderDate: '2026-11-01', effectDate: '2027-01-05' },
  limits: { ...original.limits, maxCandidates: count, requestBudgets: { page: 1, settings: 1, discover: 1, options: 1, solve: count },
    sourceAttempts: count + 4, sourceBytes: 16777216, checkpointBytes: 16777216, deadlineMs: 300000, cacheEntries: Math.min(256, count + 8) } };
delete plan.knownSelection;
plan.candidates = combos.slice(0, count).map((codes, i) => ({ candidateId: `candidate-${i}`, request: { includedElements: [...codes, 'S0337', 'S043L'].sort(), mandatoryElements: ['S0337'] } }));
const pins = { projectorSha256: sha('fixture-projector'), qualifierSha256: sha('fixture-binder'), sessionSha256: sha('fixture-session'), policyVersion: plan.policyRead.policyVersion };
const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
const tree = Object.fromEntries(['5', 'I'].map((g) => [g, { modelRanges: { G61E: { models: { T5MJ: structuredClone(model) } } } }]));
const options = Object.fromEntries(definitions.map((row) => [row.code, { option: row.code, optionType: row.optionType }]));
const settings = { APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-tree-fixture' }, settingsLocalisation: { 'x-api-key': 'private-options-fixture' }, settingsRuleSolver: { 'x-api-key': 'private-solver-fixture' } } } };
let calls = 0;
const stubFetch = async (input) => {
  const url = new URL(input); calls += 1; let value;
  if (url.pathname.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
  if (url.pathname.includes('/settings.')) value = settings;
  else if (url.pathname.includes('/vehicle-trees/')) value = tree;
  else if (url.pathname.includes('/options/')) value = options;
  else {
    const codes = url.searchParams.get('included-elements').split(',');
    const elements = Object.fromEntries([...codes, 'S0230', 'SE000001'].sort().map((code) => [code, { code, type: code === 'SE000001' ? 'accessory' : 'option' }]));
    value = { constructible: true, configuration: { modelCode: 'T5MJ', elements }, configurationChanges: {
      addedElements: Object.fromEntries(Object.entries(elements).filter(([code]) => !codes.includes(code))), removedElements: {}, ignoredElements: {} } };
  }
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
};
const keep = process.env.BENCH_STATE; const root = keep ? null : await mkdtemp(join(process.env.TMPDIR, `bench-${label}-${count}-`));
const commits = []; let rssPeakSample = 0;
const input = { plan, mode: 'live', source: structuredClone(plan.source), statePath: keep || join(root, 'session.json'),
  policyService: new PolicyService({ provider: new FilePolicyProvider() }), now: () => Date.parse('2026-11-07T01:00:00.000Z'),
  onPhase: async (name) => { if (name === 'outcome-committed') { commits.push(performance.now()); rssPeakSample = Math.max(rssPeakSample, process.memoryUsage().rss); } },
  batchBinding: { producerPins: pins, snapshotVersion: 'fucq151-bench.v1', existingConfigurationIds: [] },
  http: { kind: 'live', fetch: stubFetch, allocation: { id: 'fucq151-offline-stub', sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: count + 4, bytes: 16777216 } } };
let exists = false; try { await readFile(input.statePath); exists = true; } catch {}
if (keep && exists) {
  const t0 = performance.now(); const collector = await createFleetCollector(input); const result = await collector.run(); const t1 = performance.now();
  const summary = { label, count, validateOnly: true, status: result.status, accepted: result.accepted.length, registrations: collector.catalogueRegistrations.length,
    acceptedDigest: inputDigest(result.accepted), stubCalls: calls, coldValidateMs: Math.round(t1 - t0), peakRssBytes: process.resourceUsage().maxRSS * 1024 };
  await writeFile(out, JSON.stringify(summary) + '\n'); console.log(JSON.stringify(summary)); process.exit(0);
}
try {
  const t0 = performance.now(); const collector = await createFleetCollector(input); const result = await collector.run(); const t1 = performance.now();
  const restarted = await createFleetCollector(input); const again = await restarted.run(); const t2 = performance.now();
  const gaps = commits.slice(1).map((t, i) => t - commits[i]); const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const checkpointBytes = (await readFile(input.statePath)).length;
  const summary = { label, count, status: result.status, reason: result.reason, accepted: result.accepted.length, records: result.records.length,
    httpAttempts: result.counts.httpAttempts, solve: result.counts.operations.solve, stubCalls: calls, registrations: collector.catalogueRegistrations.length,
    acceptedDigest: inputDigest(result.accepted), countsDigest: inputDigest(result.counts), restartSame: inputDigest(again.accepted) === inputDigest(result.accepted),
    runMs: Math.round(t1 - t0), restartValidateMs: Math.round(t2 - t1),
    firstEightGapMs: Math.round(mean(gaps.slice(0, 8)) * 10) / 10, lastEightGapMs: Math.round(mean(gaps.slice(-8)) * 10) / 10,
    checkpointBytes, peakRssBytes: process.resourceUsage().maxRSS * 1024, sampledRssBytes: rssPeakSample };
  await writeFile(out, JSON.stringify(summary) + '\n'); console.log(JSON.stringify(summary));
} finally { if (root) await rm(root, { recursive: true, force: true }); }
