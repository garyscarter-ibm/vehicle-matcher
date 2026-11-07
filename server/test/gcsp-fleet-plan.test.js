import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qualifyFleetPlan, qualifyPilotPlan, configurationKey } from '../../scripts/gcsp/fleet-plan.mjs';
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
  assert.equal(report.projection.status, 'available'); assert.match(report.coverage.deferredCollection, /after 2026-11-12/);
  assert.equal(report.projection.totalRequests, 12); assert.equal(report.projection.imageRequests, 2);
  assert.equal(report.projection.serialWorstCaseDurationMs, 120000);
  assert.equal(report.errors.some((e) => e.startsWith('permission-unselected')), false);
  assert.deepEqual(shipped.families[0].configurations.map((b) => b.completeSelectedElements.length), [48, 48, 49]);
  assert.ok(shipped.families[0].configurations.every((b) => b.selectedAccessories[0] === 'SE000001'));
  assert.equal(report.presentation.families[0].profileStatus, 'unsupported');
  assert.equal(report.presentation.families[0].sourceKind, 'observed');
});

test('authorised finite pilot qualifies separately from full UK profile and scheme coverage', async () => {
  const before = JSON.stringify(shipped);
  const report = qualifyPilotPlan(shipped);
  assert.equal(report.ready, true, report.errors.join(','));
  assert.equal(report.collectionQualified, false); assert.equal(report.outboundRequests, 0);
  assert.equal(report.profileStatus, 'unqualified'); assert.equal(report.activeShortfall, 197);
  assert.equal(report.requests.total, 12); assert.equal(report.bytes.total, 16 * 1024 * 1024);
  for (const kind of ['evidence', 'images']) {
    const leaf = `docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/${kind}`;
    assert.equal(shipped.destinations[kind].path, leaf);
    assert.equal(report.destinations[kind].path, fileURLToPath(new URL(leaf, root)));
  }
  assert.equal(JSON.stringify(shipped), before);
  const source = await readFile(new URL('docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', root), 'utf8');
  const expected = new Set();
  for (const row of source.split('\n').filter((line) => /^\| (?:\d Series|Z Series|X Models|BMW i|M) \|/.test(line))) {
    const cells = row.split('|').map((cell) => cell.trim());
    if (cells[1] === 'M') for (const model of cells[4].split(',').map((s) => s.trim())) expected.add(`M Power: ${model}`);
    else expected.add(cells[2]);
  }
  assert.deepEqual(new Set(shipped.coverage.schemeModelLines), expected);
  assert.equal((await qualifyFleetPlan(shipped)).qualified, false);
});

test('pilot refuses changed authority, source, context, seeds, limits and retention before outbound work', () => {
  for (const mutate of [
    (p) => { p.permissions.dataRetention = null; },
    (p) => { p.permissions.imageDisplay.kind = 'synthetic'; },
    (p) => { p.pilot.authorisationSource = 'unverified'; },
    (p) => { p.pilot.source = 'other'; },
    (p) => { p.pilot.bootstrap.pageUrl = 'https://other.invalid/'; },
    (p) => { p.pilot.context.steering = 'LHD'; },
    (p) => { p.pilot.requests.total = 13; },
    (p) => { p.pilot.writeRequests = 1; },
    (p) => { p.pilot.bytes.total++; },
    (p) => { p.pilot.resources.ramBytes++; },
    (p) => { p.retry.maxRetries = 1; },
    (p) => { p.budgets.durationMs = 120001; },
    (p) => { p.cache.hits.solver = 1; },
    (p) => { p.pilot.seeds[0] = ['FOTHER']; },
    (p) => { p.pilot.stopConditions = []; },
    (p) => { p.destinations.images.public = true; },
    (p) => { p.destinations.evidence.path = '/tmp/other'; },
    (p) => { p.destinations.evidence.path = '../docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/evidence'; },
    (p) => { p.destinations.images.path = 'docs/gcsp/evidence/fucq-58/authorised-pilot-2026-11-05/evidence'; },
    (p) => { p.planVersion = 'other'; },
    (p) => { p.retention.discardPrivateIdentifiers = false; },
    (p) => { delete p.pilot; },
  ]) {
    const p = clone(shipped); mutate(p); const result = qualifyPilotPlan(p);
    assert.equal(result.ready, false); assert.equal(result.outboundRequests, 0); assert.ok(result.errors.length);
  }
  const p = clone(shipped); p.pilot.context.modelCode = 'WBA33DB00TC123456';
  assert.equal(JSON.stringify(qualifyPilotPlan(p)).includes('WBA33DB00TC123456'), false);
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
    const fromDisk = mode === 'shipped' || mode === 'pilot';
    const status = await runCli(mode === 'real' ? ['--config', 'never-read', '--real'] : ['--config', fromDisk ? 'server/data/gcsp/vehicle-evidence/fleet-plan.json' : 'in-memory', mode === 'pilot' ? '--pilot-plan' : '--offline'],
      fromDisk ? {} : { loadConfig: async () => plan, qualificationOptions: opts });
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
  const pilot = run('pilot'); assert.equal(pilot.status, 0, pilot.stderr + pilot.stdout);
  assert.equal(JSON.parse(pilot.stdout).ready, true); assert.equal(JSON.parse(pilot.stdout).collectionQualified, false);
  const real = run('real'); assert.equal(real.status, 2); assert.match(real.stdout, /offline-only/);
  const cli = spawnSync(process.execPath, ['scripts/gcsp/fleet-plan.mjs', '--config', 'server/data/gcsp/vehicle-evidence/fleet-plan.json', '--offline'],
    { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(cli.status, 1, cli.stderr); assert.equal(JSON.parse(cli.stdout).coverage.distinctProved, 3);
});


function retainedConfigurationPlan() {
  return {
    schemaVersion: '2', planVersion: 'fleet-configurations.v1', identityScope: 'configuration-corpus',
    execution: 'retained-offline-only', selectionId: 'f60-selected10000-20261107', targetCount: 10000,
    tool: { version: 'fleet-configurations.v1', kind: 'observed', source: 'scripts/gcsp/fleet-plan.mjs',
      observedDate: '2026-11-07', confidence: 'Reviewed retained metadata only; no fresh source re-admission' },
    permissions: clone(shipped.permissions), retention: clone(shipped.retention),
    work: Object.fromEntries(Object.keys(shipped.work).map((key) => [key, 0])),
    budgets: { requests: 0, imageRequests: 0, cacheEntries: 0, cacheBytes: 0, concurrency: 1, timeoutMs: 1000, durationMs: 10000 },
    cache: { policy: 'cold', key: 'full-context+complete-selection+provider-version', ttlMs: 86400000, entryBytes: 1,
      hits: { candidate: 0, solver: 0, otd: 0, image: 0 } },
    retry: { maxRetries: 0, initialBackoffMs: 0, maxBackoffMs: 0, multiplier: 1, retryStatuses: [] },
    destinations: Object.fromEntries(['evidence', 'images'].map((kind) => [kind, {
      path: `docs/gcsp/evidence/fucq-58/configuration-only-qualification-2026-11-07/${kind}`,
      expectedBytes: 0, public: false, retention: 'reusable-non-personal' }])),
    stopConditions: clone(shipped.stopConditions),
  };
}

test('reviewed retained configuration plan qualifies without resolving a VIN profile or re-admitting source rows', async () => {
  const plan = retainedConfigurationPlan(); const before = JSON.stringify(plan); let resolutions = 0;
  const report = await qualifyFleetPlan(plan, { registry: { resolve: () => { resolutions++; throw Error('VIN profile called'); } },
    configurationEvidence: { count: 99999, sourceAcceptance: true }, syntheticContract: true });
  assert.equal(report.contractQualified, true, report.errors.join(',')); assert.equal(resolutions, 0);
  assert.equal(report.qualified, true); assert.equal(report.qualification, 'reviewed-retained-configuration-plan');
  assert.equal(report.sourceAcceptance, false); assert.equal(report.collectionQualified, false);
  assert.equal(report.rawSourceRevalidated, false); assert.equal(report.outboundRequests, 0);
  assert.equal(report.coverage.distinctProved, 10000); assert.equal(report.coverage.shortfall, 0);
  assert.equal(report.coverage.vgModelCodes.length, 43); assert.equal(report.coverage.agModelCodes.length, 26);
  assert.deepEqual(report.coverage.context, { market: 'GB', locale: 'en-GB', orderDate: '2026-11-01',
    effectDate: '2027-01-05', taxDate: '2027-01-05', steeringLiteral: 'RL' });
  assert.equal(report.presentation.physicalSteering, 'unknown'); assert.equal(report.presentation.body, 'unknown');
  assert.equal(report.presentation.technicalFacts, 'unknown'); assert.equal(report.presentation.profileStatus, 'not-applicable-to-configurations');
  assert.equal(report.projection.totalRequests, 0); assert.equal(report.projection.cacheEntries, 0);
  assert.deepEqual(Object.values(report.projection.hits), [0, 0, 0, 0]);
  assert.equal(JSON.stringify(plan), before);
});

test('configuration plan refuses caller authority, unsupported targets, new work and shared safety violations', async () => {
  for (const [mutate, expected] of [
    [(p) => { p.selectionId = 'caller-selected'; }, 'unregistered-configuration-selection'],
    [(p) => { p.targetCount = 10001; }, 'unsupported-configuration-target'],
    [(p) => { p.targetCount = 200; }, 'unsupported-configuration-target'],
    [(p) => { p.evidence = { count: 99999, admission: true }; }, 'unknown-retained-payload'],
    [(p) => { p.work.solverCandidates = 10000; }, 'invalid-work-counts'],
    [(p) => { p.budgets.requests = 1; }, 'retained-only-run-required'],
    [(p) => { p.budgets = null; }, 'missing-numeric-budgets'],
    [(p) => { p.cache.hits.solver = 10000; }, 'retained-only-run-required'],
    [(p) => { p.retry.maxRetries = 1; }, 'retained-only-run-required'],
    [(p) => { p.permissions.sourceAccess = null; }, 'permission-unselected'],
    [(p) => { p.permissions.dataRetention.kind = 'synthetic'; }, 'unproved-configuration-authority'],
    [(p) => { p.retention.fields.push('raw-provider-captures'); }, 'invalid-retention'],
    [(p) => { p.destinations.images.public = true; }, 'invalid-destination:images'],
    [(p) => { p.destinations.evidence.path = '../escape'; }, 'invalid-destination:evidence'],
    [(p) => { p.destinations.evidence.path = 'docs/gcsp/evidence/%2e%2e/%2e%2e/escape'; }, 'invalid-destination:evidence'],
    [(p) => { p.destinations.evidence.path = 'docs/gcsp/evidence/proof#alias'; }, 'invalid-destination:evidence'],
    [(p) => { p.stopConditions = []; }, 'missing-stop-conditions'],
    [(p) => { p.extension = { customerId: 'PRIVATE-MARKER' }; }, 'private-retention'],
    [(p) => { p.execution = 'collect'; }, 'invalid-configuration-version-or-identity'],
  ]) {
    const plan = retainedConfigurationPlan(); mutate(plan); const report = await qualifyFleetPlan(plan);
    assert.equal(report.contractQualified, false, expected); assert.ok(report.errors.some((e) => e.includes(expected)), report.errors.join(','));
    assert.equal(report.outboundRequests, 0); assert.equal(JSON.stringify(report).includes('PRIVATE-MARKER'), false);
  }
});

test('shipped retained CLI is portable, zero-egress and refuses changed projection bytes', async () => {
  assert.deepEqual(await load('server/data/gcsp/vehicle-evidence/fleet-configurations.v1.json'), retainedConfigurationPlan());
  const code = `import fs from 'node:fs/promises'; import { syncBuiltinESMExports } from 'node:module';
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    let calls = 0; const deny = () => { calls++; throw Error('network forbidden'); };
    globalThis.fetch = deny; globalThis.WebSocket = class { constructor() { deny(); } };
    http.request = https.request = http.get = https.get = net.connect = net.createConnection = deny;
    const read = fs.readFile; const mode = process.argv[1];
    if (mode === 'tamper') fs.readFile = (p, ...args) => String(p).endsWith('/fleet-configuration-evidence.v1.json')
      ? Promise.resolve(Buffer.from('{"count":99999,"sourceAcceptance":true}')) : read(p, ...args);
    syncBuiltinESMExports(); const { runCli } = await import('./scripts/gcsp/fleet-plan.mjs');
    const status = await runCli(['--config', 'server/data/gcsp/vehicle-evidence/fleet-configurations.v1.json', '--offline']);
    if (calls) throw Error('outbound calls'); process.exitCode = status;`;
  const run = (mode) => spawnSync(process.execPath, ['--input-type=module', '-e', code, mode],
    { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  const good = run('retained'); assert.equal(good.status, 0, good.stderr + good.stdout);
  const report = JSON.parse(good.stdout);
  assert.equal(report.qualification, 'reviewed-retained-configuration-plan');
  assert.equal(report.coverage.distinctProved, 10000); assert.equal(report.outboundRequests, 0);
  assert.ok(report.evidence.artifacts.every((a) => !a.artifact.startsWith('/') && /^[a-f0-9]{64}$/.test(a.sha256)));
  const changed = run('tamper'); assert.equal(changed.status, 1, changed.stderr + changed.stdout);
  assert.deepEqual(JSON.parse(changed.stdout).errors, ['reviewed-configuration-evidence-unavailable']);
  assert.equal(JSON.parse(changed.stdout).coverage.distinctProved, 0);
});
