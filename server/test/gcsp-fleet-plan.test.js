import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { qualifyFleetPlan, configurationKey } from '../../scripts/gcsp/fleet-plan.mjs';
import { createVinProfileRegistry } from '../gcsp/vehicle-evidence/vin-profiles.js';

const root = new URL('../../', import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const shipped = await load('server/data/gcsp/vehicle-evidence/fleet-plan.json');
const registryData = await load('server/data/gcsp/vehicle-evidence/vin-profiles.v1.json');
const clone = structuredClone;
const EV = { kind: 'synthetic', source: 'synthetic-contract-fixture', observedDate: '2026-11-05', confidence: 'Synthetic test only; no external corroboration' };
function fixture() {
  const ev = clone(EV);
  const plan = clone(shipped); const data = clone(registryData); const catalogues = []; const builds = [];
  plan.tool.kind = 'synthetic'; plan.families = []; plan.coverage.schemeModelLines = []; plan.coverage.schemeSource = { ...ev, kind: 'eligibility-only', provenanceKind: 'synthetic' };
  for (const [i, profile] of data.profiles.filter((p) => p.status === 'enabled').entries()) {
    profile.binding.agModelCode = `AG${i}X`;
    const context = { ...profile.binding, plant: profile.format.allowedPlants[0].code, modelCode: `TEST${i}`,
      modelRange: `RANGE${i}`, locale: 'en-US', catalogueDate: '2026-11-05', orderDate: '2026-11-05', effectDate: '2026-11-05' };
    const family = { familyId: `synthetic-${i}`, context, schemeModelLine: context.model, catalogueVersion: `synthetic-${i}`,
      wmi: profile.format.wmi, profileId: profile.profileId, profileVersion: '1',
      profileEvidence: { ...ev, source: data.sources[0].source, observedDate: profile.evidence.observedDate, confidence: profile.evidence.confidence },
      optionFamilies: { paint: ['PTEST'], fabric: ['FTEST'], rim: ['RTEST'] }, plannedCount: 40,
      configurations: [], evidence: ev, unknownFields: ['verified fitted equipment'] };
    plan.coverage.schemeModelLines.push(context.model);
    catalogues.push({ id: family.catalogueVersion, context, model: context.model, derivative: context.derivative,
      body: context.body, powertrain: context.powertrain, optionFamilies: clone(family.optionFamilies), evidence: ev });
    for (let j = 0; j < 40; j++) {
      const codes = ['FTEST', 'PTEST', 'RTEST', `S${String(j).padStart(4, '0')}`].sort();
      const id = `synthetic-${i}-${j}`;
      family.configurations.push({ configurationId: Buffer.from(context.modelCode + ':' + codes.join(','), 'utf8').toString('base64'), evidenceId: id,
        seedOptions: ['FTEST', 'PTEST'], selectionComplete: true, completeSelectedElements: codes, selectedAccessories: [], evidence: ev });
      builds.push({ id, context, constructible: true, resolvedModelCode: context.modelCode,
        requestedOptionsPreserved: true, completeSelectedElements: codes, seedOptions: ['FTEST', 'PTEST'], selectedAccessories: [], evidence: ev });
    }
    plan.families.push(family);
  }
  for (const k of Object.keys(plan.permissions)) plan.permissions[k] = { ...ev, status: 'approved', basis: 'Synthetic in-memory test permission only' };
  plan.work = { candidateRequests: 5, solverCandidates: 200, otdConfigurations: 200, imageConfigurations: 200, viewsPerConfiguration: 2, imageBytesPerView: 100 };
  plan.budgets = { requests: 4000, imageRequests: 2000, cacheEntries: 2000, cacheBytes: 2000000, concurrency: 2, timeoutMs: 10, durationMs: 100000 };
  plan.cache = { policy: 'cold', key: 'full-context+complete-selection+provider-version', ttlMs: 1000, entryBytes: 100,
    hits: { candidate: 0, solver: 0, otd: 0, image: 0 } };
  plan.retry = { maxRetries: 1, initialBackoffMs: 5, maxBackoffMs: 10, multiplier: 2, retryStatuses: [429, 503] };
  plan.destinations = Object.fromEntries(['evidence', 'images'].map((k) => [k, { path: `/tmp/synthetic-${k}`, expectedBytes: 200000, public: false, retention: 'reusable-non-personal' }]));
  const options = { syntheticContract: true, registry: createVinProfileRegistry({ loadRegistry: async () => data }), catalogues, builds };
  return { plan, options, data };
}

const rejects = async (mutate, expected) => {
  const f = fixture(); mutate(f.plan, f.options, f.data);
  const report = await qualifyFleetPlan(f.plan, f.options);
  assert.equal(report.contractQualified, false);
  assert.ok(report.errors.some((e) => e.includes(expected)), `${expected}: ${report.errors}`);
  return report;
};

test('five-WMI multi-build synthetic contract passes without claiming externally qualified coverage', async () => {
  const { plan, options } = fixture(); const report = await qualifyFleetPlan(plan, options);
  assert.deepEqual(report.errors, []);
  assert.equal(report.contractQualified, true); assert.equal(report.qualified, false); assert.equal(report.contractOnly, true);
  assert.equal(report.coverage.distinctProved, 0); assert.equal(report.coverage.synthetic, 200);
  assert.deepEqual(Object.values(report.coverage.byWmi), [40, 40, 40, 40, 40]);
  assert.equal(report.presentation.status, 'synthetic-contract-only'); assert.equal(report.sourceKind, 'synthetic');
  assert.equal(report.presentation.verifiedFitted, 'unknown');
});

test('target configuration ID matches the independent HLD Base64 example and excludes accessories', async () => {
  const options = ['P0300', 'FKSFU', 'S0337', 'S0488', 'S03AC'];
  const expected = 'VDVNSjpGS1NGVSxQMDMwMCxTMDMzNyxTMDNBQyxTMDQ4OA==';
  assert.equal(configurationKey('T5MJ', options), expected);
  assert.equal(configurationKey('T5MJ', [...options, 'SE000001'], ['SE000001']), expected);
  assert.equal(Buffer.from(expected, 'base64').toString('utf8'), 'T5MJ:FKSFU,P0300,S0337,S03AC,S0488');
  await rejects((p) => {
    const family = p.families[0]; const b = clone(family.configurations[0]);
    b.completeSelectedElements.push('SE000001'); b.completeSelectedElements.sort(); b.selectedAccessories = ['SE000001'];
    family.configurations.push(b); family.plannedCount++;
  }, 'duplicate-resolved-build');
});

test('observed builds cannot qualify synthetic permissions or catalogue provenance operationally', async () => {
  const f = fixture(); f.options.syntheticContract = false;
  for (const family of f.plan.families) {
    family.evidence = { ...family.evidence, kind: 'observed' };
    for (const b of family.configurations) b.evidence = { ...b.evidence, kind: 'observed' };
  }
  for (const b of f.options.builds) b.evidence = { ...b.evidence, kind: 'observed' };
  const result = await qualifyFleetPlan(f.plan, f.options);
  assert.equal(result.coverage.distinctProved, 200); assert.equal(result.qualified, false);
  assert.equal(result.contractQualified, false); assert.equal(result.sourceKind, 'mixed');
  assert.ok(result.errors.includes('unqualified-operational-provenance'));
});

test('shipped evidence proves three real complete selections, never GB profile qualification or capacity', async () => {
  const report = await qualifyFleetPlan(shipped);
  assert.equal(report.qualified, false); assert.equal(report.contractQualified, false);
  assert.equal(report.coverage.distinctProved, 3); assert.equal(report.coverage.profileQualified, 0);
  assert.equal(report.coverage.activeShortfall, 197); assert.equal(report.coverage.legacyShortfall, 9997);
  assert.equal(report.projection.status, 'unavailable'); assert.match(report.coverage.deferredCollection, /after 2026-11-12/);
  assert.deepEqual(shipped.families[0].configurations.map((b) => b.completeSelectedElements.length), [48, 48, 49]);
  assert.ok(shipped.families[0].configurations.every((b) => b.selectedAccessories[0] === 'SE000001'));
  assert.equal(report.presentation.families[0].profileStatus, 'unsupported');
  assert.equal(report.presentation.families[0].sourceKind, 'observed');
});

test('rejects US-to-GB, candidate profiles, unsupported year/plant/era and model substitutions', async () => {
  for (const patch of [{ market: 'GB', steering: 'RHD' }, { modelYear: 2027 }, { plant: 'X' },
    { productionEra: 'different era' }, { derivative: 'different derivative' }, { agModelCode: 'other' }]) {
    await rejects((p) => Object.assign(p.families[0].context, patch), 'incompatible-or-unqualified-profile');
  }
  await rejects((p) => { p.families[0].profileId = 'UK-OBS-001'; }, 'incompatible-or-unqualified-profile');
  await rejects((p, o) => { o.builds[0].resolvedModelCode = 'SUBSTITUTED'; }, 'unproved-complete-build');
  await rejects((p) => { p.families[0].catalogueVersion = 'not-current-eligibility-matrix'; }, 'unsupported-catalogue-context');
});

test('identity uses resolved complete build, rejects order, date, evidence and metadata aliases', async () => {
  const f = fixture(); const first = f.plan.families[0].configurations[0];
  assert.equal(configurationKey('A', ['PTEST', 'FTEST']), configurationKey('A', ['FTEST', 'PTEST']));
  await rejects((p) => { p.families[0].configurations[1] = clone(p.families[0].configurations[0]); }, 'duplicate-resolved-build');
  await rejects((p, o) => { const family = clone(p.families[0]); family.familyId = 'date-alias';
    family.context.orderDate = '2026-11-06'; family.catalogueVersion = 'date-alias'; p.families.push(family);
    o.catalogues.push({ ...clone(o.catalogues[0]), id: 'date-alias', context: family.context }); }, 'duplicate-resolved-build');
  await rejects((p) => { p.families[0].configurations[0].completeSelectedElements.reverse(); }, 'incomplete-selection');
  await rejects((p) => { p.families[0].configurations[0].configurationId = 'metadata-alias'; }, 'substituted-identity');
  await rejects((p) => { const b = p.families[0].configurations[0]; b.completeSelectedElements = ['FTEST', 'PTEST']; b.configurationId = configurationKey(p.families[0].context.modelCode, b.completeSelectedElements); }, 'missing-selected-family');
  await rejects((p) => { p.families[0].plannedCount = 10000; }, 'unresolved-count');
  assert.equal(first.completeSelectedElements.length, 4);
});

test('missing provenance, required option family, scheme model and permissions refuse safely', async () => {
  await rejects((p) => { p.families[0].evidence = null; }, 'missing-context-evidence');
  await rejects((p, o) => { o.builds = []; }, 'unproved-complete-build');
  await rejects((p) => { p.families[0].optionFamilies.rim = []; }, 'missing-option-families');
  await rejects((p) => { p.coverage.schemeModelLines.push('uncovered model'); }, 'active-demo-route-shortfall');
  await rejects((p) => { p.permissions.sourceAccess = null; }, 'permission-unselected');
  await rejects((p) => { p.families[0].profileEvidence = null; }, 'incompatible-or-unqualified-profile');
  await rejects((p) => { p.families[0].optionFamilies.rim = ['S0000']; }, 'unproved-option-family-classification');
});

test('deterministic worst-case arithmetic includes manifests, image downloads, retries, cache and backoff', async () => {
  const f = fixture(); let report = await qualifyFleetPlan(f.plan, f.options);
  assert.equal(report.projection.totalRequests, 2010); assert.equal(report.projection.imageRequests, 1200);
  assert.equal(report.projection.cacheEntries, 1005); assert.equal(report.projection.cacheBytes, 100500);
  assert.equal(report.projection.serialWorstCaseDurationMs, 25125);
  f.plan.cache.policy = 'verified-hits'; f.plan.cache.hits = { candidate: 1, solver: 100, otd: 50, image: 200 };
  report = await qualifyFleetPlan(f.plan, f.options);
  assert.equal(report.contractQualified, false); assert.ok(report.errors.includes('unproved-cache-hits'));
  assert.equal(report.projection.totalRequests, 2010); assert.equal(report.projection.imageRequests, 1200);
  assert.equal(report.projection.serialWorstCaseDurationMs, 25125);
  assert.deepEqual(Object.values(report.projection.hits), [0, 0, 0, 0]);
  await rejects((p) => { p.cache.policy = 'verified-hits'; p.cache.hits = { candidate: 5, solver: 200, otd: 200, image: 600 }; p.budgets.requests = 0; }, 'budget-exceeded');
  for (const key of ['requests', 'imageRequests', 'cacheEntries', 'cacheBytes', 'durationMs'])
    await rejects((p) => { p.budgets[key] = key === 'durationMs' ? 1 : 0; }, 'budget-exceeded');
  await rejects((p) => { p.budgets.concurrency = null; }, 'missing-numeric-budgets');
  await rejects((p) => { p.cache.hits.image = 601; }, 'invalid-cache-hit-counts');
  await rejects((p) => { p.cache.hits.solver = 1; }, 'invalid-cache-hit-counts');
  await rejects((p) => { p.retry.maxRetries = -1; }, 'invalid-retry-backoff');
  await rejects((p) => { p.retry.initialBackoffMs = 11; }, 'invalid-retry-backoff');
  await rejects((p) => { p.work.viewsPerConfiguration = Number.MAX_SAFE_INTEGER; }, 'invalid-cache-hit-counts');
  await rejects((p) => { p.stopConditions = []; }, 'missing-stop-conditions');
  await rejects((p) => { p.destinations.images.expectedBytes = 1; }, 'insufficient-image-destination');
  await rejects((p) => { p.destinations.evidence.expectedBytes = 1; }, 'insufficient-evidence-destination');
});

test('rejects private data anywhere, unsupported retention, public or oversized local destinations', async () => {
  for (const key of ['customerId', 'userId', 'vin', 'registrationPlate', 'serialNumber', 'privateId', 'orderUuid', 'capture'])
    await rejects((p) => { p.extension = { [key]: 'private' }; }, 'private-retention');
  for (const value of ['WBA33DB00TC123456', 'AB12 CDE', 'https://example.invalid/vehicle/private', 'https://example.invalid/image?vin=private', 'https://example.invalid/image?customerId=private', 'https://example.invalid/image?userId=private'])
    await rejects((p) => { p.extension = { arbitrary: value }; }, 'private-retention');
  await rejects((p) => { p.retention.fields.push('raw-provider-captures'); }, 'invalid-retention');
  await rejects((p) => { p.destinations.images.public = true; }, 'invalid-destination:images');
  await rejects((p) => { p.destinations.images.expectedBytes = 256 * 1024 * 1024; }, 'invalid-destination:images');
  const f = fixture(); f.plan.destinations.images.expectedBytes = 256 * 1024 * 1024;
  f.plan.destinations.images.path = '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/images';
  assert.equal((await qualifyFleetPlan(f.plan, f.options)).contractQualified, true);
});

test('unknown retained payloads refuse and private metadata never enters reports or CLI output', async () => {
  await rejects((p) => { p.extension = { note: 'opaque private value' }; }, 'unknown-retained-payload');
  await rejects((p) => { p.families[0].context.extension = { opaque: 'value' }; }, 'unknown-retained-payload');
  const marker = 'WBA33DB00TC123456';
  for (const mutate of [
    (p) => { p.families[0].familyId = marker; },
    (p) => { p.families[0].evidence.source = marker; },
    (p) => { p.families[0].unknownFields = [marker]; },
    (p) => { p.customerId = 'PRIVATE-CUSTOMER-MARKER'; },
  ]) {
    const f = fixture(); mutate(f.plan);
    const result = await qualifyFleetPlan(f.plan, f.options);
    const serialized = JSON.stringify(result);
    assert.equal(result.contractQualified, false); assert.equal(result.presentation.families.length, 0);
    assert.equal(serialized.includes(marker), false); assert.equal(serialized.includes('PRIVATE-CUSTOMER-MARKER'), false);
  }
});

test('malformed or empty input never throws or exposes supplied private errors', async () => {
  for (const p of [null, [], {}, { ...clone(shipped), families: [] }, { ...clone(shipped), families: [null] }]) {
    const result = await qualifyFleetPlan(p); assert.equal(result.qualified, false); assert.ok(result.errors.length);
  }
  for (const malformedModelCode of [42, true, [], {}]) {
    const f = fixture(); f.plan.families[0].context.modelCode = malformedModelCode;
    const result = await qualifyFleetPlan(f.plan, f.options);
    assert.equal(result.qualified, false); assert.ok(result.errors.length);
  }
  const f = fixture(); f.options.registry = { resolve: async () => { throw Error('PRIVATE-ERROR'); } };
  assert.equal(JSON.stringify(await qualifyFleetPlan(f.plan, f.options)).includes('PRIVATE-ERROR'), false);
});

test('CLI subprocess proves synthetic contract success, shipped refusal and zero network access', () => {
  const f = fixture();
  const code = `import { runCli } from './scripts/gcsp/fleet-plan.mjs';
    import { createVinProfileRegistry } from './server/gcsp/vehicle-evidence/vin-profiles.js';
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    let calls = 0; const deny = () => { calls++; throw Error('network forbidden'); };
    globalThis.fetch = deny; globalThis.WebSocket = class { constructor() { deny(); } };
    http.request = https.request = http.get = https.get = net.connect = net.createConnection = deny;
    let raw = ''; for await (const part of process.stdin) raw += part;
    const { plan, data, catalogues, builds, mode } = JSON.parse(raw);
    if (mode === 'private') plan.families[0].familyId = 'WBA33DB00TC123456';
    const opts = { syntheticContract: true, registry: createVinProfileRegistry({ loadRegistry: async () => data }), catalogues, builds };
    const status = await runCli(mode === 'real' ? ['--config', 'never-read', '--real'] : ['--config', mode === 'shipped' ? 'server/data/gcsp/vehicle-evidence/fleet-plan.json' : 'in-memory', '--offline'],
      mode === 'shipped' ? {} : { loadConfig: async () => plan, qualificationOptions: opts });
    if (calls) throw Error('outbound calls'); process.exitCode = status;`;
  const run = (mode) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root,
    input: JSON.stringify({ plan: f.plan, data: f.data, catalogues: f.options.catalogues, builds: f.options.builds, mode }),
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const good = run('synthetic'); assert.equal(good.status, 0, good.stderr + good.stdout);
  assert.equal(JSON.parse(good.stdout).presentation.status, 'synthetic-contract-only');
  const privateCli = run('private'); assert.equal(privateCli.status, 1);
  assert.equal(privateCli.stdout.includes('WBA33DB00TC123456'), false);
  assert.equal(JSON.parse(privateCli.stdout).presentation.families.length, 0);
  const instrumentedShipped = run('shipped'); assert.equal(instrumentedShipped.status, 1, instrumentedShipped.stderr);
  assert.equal(JSON.parse(instrumentedShipped.stdout).coverage.distinctProved, 3);
  const real = run('real'); assert.equal(real.status, 2); assert.match(real.stdout, /offline-only/);
  const cli = spawnSync(process.execPath, ['scripts/gcsp/fleet-plan.mjs', '--config', 'server/data/gcsp/vehicle-evidence/fleet-plan.json', '--offline'],
    { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(cli.status, 1, cli.stderr); assert.equal(JSON.parse(cli.stdout).coverage.distinctProved, 3);
});
