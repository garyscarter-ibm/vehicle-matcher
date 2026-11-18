// Writes the demo stock parity golden (FUCQ-462 s4) from the Node demo provider. Offline only.
// Run: node tools/supply-baseline/generate.mjs src/test/resources/supply/demo-parity.json (no node_modules; pg is stubbed).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../node-baseline/pg-stub.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const m = (p) => import(root + p);
const { createPolicyService } = await m('server/gcsp/policy/index.js');
const { createDemoStockProvider, withConfirmedSupply } = await m('server/gcsp/stock/demo-provider.js');
const out = process.argv[2];
const policy = createPolicyService();
const RUN = 'run-1'; const VERSION = 'gcsp-policy-v1';
const CUE = Date.parse('2026-11-05T09:30:00.000Z');
const at = (minutes) => new Date(CUE + minutes * 60000).toISOString();
const request = (minutes, released = [], queuedSupply = []) => ({ runId: RUN, asOf: at(minutes), tickId: `tick-${minutes}`,
  releaseSize: 100, leadTimeDays: 2, policyVersion: VERSION, released, queuedSupply });
const queued = (supplyId, eligibleMinutes) => ({ supplyId, confirmedAt: at(eligibleMinutes - 5), eligibleFrom: at(eligibleMinutes),
  sourceVersion: 'demo-synthetic-production-v1', policyVersion: VERSION });
const released = (value) => ({ trancheId: value.tranche.trancheId, orderUuids: value.tranche.orderUuids });
const demo = createDemoStockProvider({ policy });
const upstream = { lookup: (runId, supplyId) => (supplyId === 'sup-confirmed-1' ? { kind: 'touring', quantity: 2 } : null) };
const wrapped = withConfirmedSupply(createDemoStockProvider({ policy }), upstream, { policy });
const cases = [];
async function run(name, provider, req, held = null) {
  const outcome = await provider.pull(structuredClone(req));
  if (outcome.status !== 'ok') throw new Error(`${name}: ${outcome.status}`);
  cases.push({ name, request: req, confirmedSupply: held, expected: outcome.value });
  return outcome.value;
}
const a = await run('release cue', demo, request(0));
const b = await run('window 2 after window 1 released', demo, request(150, [released(a)]));
const bTranche = released(b);
await run('window 3 after windows 1 and 2 released', demo, request(1410, [released(a), bTranche]));
await run('nothing new before the next window', demo, request(60, [released(a)]));
const held = { 'sup-confirmed-1': { model: '3 Series Touring', derivative: '320i', quantity: 2 } };
const c = await run('confirmed supply releases first', wrapped, request(30, [], [queued('sup-confirmed-1', 10), queued('sup-unknown', 10)]), held);
await run('confirmed supply not yet eligible falls through to demo', wrapped, request(0, [], [queued('sup-confirmed-1', 60)]), held);
await run('released confirmed supply falls through to demo', wrapped, request(30, [released(c)], [queued('sup-confirmed-1', 10)]), held);
writeFileSync(out, JSON.stringify({ schemaVersion: 1, generator: 'services/gcsp-api/tools/supply-baseline/generate.mjs', policyVersion: VERSION, cases }, null, 1) + '\n');
console.log('cases', cases.length);
