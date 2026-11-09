// FUCQ-151 offline replay of the retained source32 checkpoint copy; any fetch throws.
import { readFile } from 'node:fs/promises';
const W = process.env.VM_ROOT; const E = `${W}/docs/gcsp/evidence/fucq61/source-batch32-2026-11-07`;
const [moduleUrl, statePath, out] = process.argv.slice(2);
let calls = 0; const refuse = () => { calls += 1; throw new Error('network disabled in FUCQ-151 replay'); }; globalThis.fetch = refuse;
const { createFleetCollector } = await import(moduleUrl);
const { PolicyService, FilePolicyProvider } = await import(`file://${W}/server/gcsp/policy/index.js`);
const { inputDigest } = await import(`file://${W}/server/gcsp/repository/core.js`);
const plan = JSON.parse(await readFile(`${E}/collection-plan.json`)); const allocation = JSON.parse(await readFile(`${E}/execution-plan.json`));
const index = JSON.parse(await readFile(`${E}/prior-canonical-index.json`));
const t0 = performance.now(); let summary;
try {
  const collector = await createFleetCollector({ plan, source: plan.source, mode: 'live', statePath, policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    batchBinding: { producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion, existingConfigurationIds: index.entries.map((row) => row.configurationId) },
    http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: allocation.planDigest, attempts: 36, bytes: 8388608 }, fetch: refuse } });
  const result = await collector.run();
  summary = { status: result.status, reason: result.reason, accepted: result.accepted.length, records: result.records.length, duplicates: result.duplicates.length,
    rejected: result.rejected.length, httpAttempts: result.counts.httpAttempts, registrations: collector.catalogueRegistrations.length, acceptedDigest: inputDigest(result.accepted) };
} catch (error) { summary = { error: error.code || error.message }; }
Object.assign(summary, { fetchCalls: calls, validateMs: Math.round(performance.now() - t0), peakRssBytes: process.resourceUsage().maxRSS * 1024 });
console.log(JSON.stringify(summary)); await (await import('node:fs/promises')).writeFile(out, JSON.stringify(summary) + '\n');
