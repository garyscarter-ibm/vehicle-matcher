/** FUCQ-77 demo enrichment: injected HTTP fixtures only, so no test can reach BMW. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDemoPlan } from '../../scripts/gcsp/demo-plan.mjs';
import { ALLOWED_HOSTS, buildRegistrations, buildRowPlan, composeEnrichment, createGuardedFetch, loadRegistrations, openLedger,
  parseEnrichmentArgs, runLiveObservation } from '../../scripts/gcsp/demo-enrichment.mjs';
import { enrichmentPrivacyFiles, privacyScan } from '../../scripts/gcsp/demo-selection.mjs';
import { countOtdFacts, scoreEnrichment, verifyStagedDemoFleet } from '../../scripts/gcsp/demo-verifier.mjs';
import { validateBmwEnrichmentObservationRegistration, bmwEnrichmentObservationRequestUrls } from '../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../gcsp/repository/core.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

const loaded = await loadRegistrations();
const SECRET = 'ephemeral-fucq77-fixture-key';
const sha = (text) => createHash('sha256').update(text).digest('hex');

// A fixture BMW: answers the four registered requests per row, with per-test overrides by operation.
function fixtureBmw(registrations, overrides = {}) {
  const routes = new Map(); const calls = [];
  for (const item of registrations) {
    const urls = bmwEnrichmentObservationRequestUrls(item.registration);
    routes.set(urls.page, { id: item.configurationId, operation: 'page' }); routes.set(urls.technical, { id: item.configurationId, operation: 'technical', item });
    routes.set(urls['image-manifest'], { id: item.configurationId, operation: 'image-manifest', item });
  }
  const technical = (item) => ({ businessKey: '120618215', status: 1, preConfigurationOptions: [item.registration.factoryOptionCodes[0]],
    values: { N_SITZE: { referenceName: 'N_SITZE', targetValue: 5 }, E_0_100KMH: { referenceName: 'E_0_100KMH', targetValue: 6.1 },
      A_GEPR_V211: { referenceName: 'A_GEPR_V211', targetValue: '0000' }, A_LAENGE: { referenceName: 'A_LAENGE', targetValue: 4361 },
      E_ABGAS: { referenceName: 'E_ABGAS', listValues: ['x'] } } });
  const view = (pov) => ({ viewImage: 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?opaque=do-not-retain', distinctionParameters: { POV: pov } });
  const image = () => ({ 'stage-fullscreen-views-legacy-newnames': {
    thumbnails: { metaData: { width: 170, height: 100 }, namedImages: [{ name: 'g', images: [view('HEROFRONT')] }] },
    desktop: { metaData: { width: 2560, height: 1646 }, namedImages: [{ name: 'g', images: [view('FRONTRIGHT'), view('HEROFRONT'), view('HEROFRONT')] }] } } });
  const fetch = async (url, options) => {
    const route = routes.get(url) ?? { operation: url.includes('/settings.') ? 'settings' : 'unknown' };
    calls.push({ url, operation: route.operation, id: route.id, headers: options.headers });
    const custom = overrides[route.operation]?.(route, calls.filter((c) => c.operation === route.operation).length);
    if (custom) return custom;
    if (route.operation === 'page') return new Response('<html>settings.fixture.json</html>', { headers: { 'content-type': 'text/html' } });
    if (route.operation === 'settings') return Response.json({ APP: { backend: { settingsOtd: { 'x-api-key': SECRET },
      settingsCosy: { baseUrl: 'https://prod.cosy.bmw.cloud', 'x-api-key': SECRET } } } });
    if (route.operation === 'technical') return Response.json(technical(route.item));
    if (route.operation === 'image-manifest') return Response.json(image());
    throw new Error('Unallocated fixture request');
  };
  return { fetch, calls };
}

async function harness(t, { rows = 3, pick, clock = Date.parse('2026-11-08T10:00:00Z'), overrides } = {}) {
  const out = await mkdtemp(join(tmpdir(), 'fucq77-enrich-')); t.after(() => rm(out, { recursive: true, force: true }));
  const registrations = pick ?? loaded.registrations.slice(0, rows); const bmw = fixtureBmw(loaded.registrations, overrides);
  const state = { now: clock, sleeps: [] };
  const run = (extra = {}) => runLiveObservation({ registrations, manifestDigest: loaded.manifestDigest, out, cap: 400, fetch: bmw.fetch,
    now: () => state.now, sleep: async (ms) => { state.sleeps.push(ms); state.now += ms; }, ...extra });
  const ledger = async () => JSON.parse(await readFile(join(out, 'ledger.json'), 'utf8'));
  return { out, registrations, bmw, state, run, ledger };
}

test('239 of the 240 published rows register exactly and the unregistrable row is listed with its reason', () => {
  assert.equal(loaded.rows.length, 240);
  assert.equal(loaded.registrations.length, 239);
  assert.deepEqual(loaded.unregistered.map((item) => [item.vgModelCode, item.reason]), [['T5MJ', 'no-source-binding']]);
  const ids = loaded.registrations.map((item) => item.configurationId);
  assert.deepEqual(ids, [...ids].sort(), 'registrations are sorted');
  for (const { configurationId, registration, accepted } of loaded.registrations) {
    validateBmwEnrichmentObservationRegistration(registration);
    assert.equal(registration.configurationId, configurationId);
    assert.deepEqual(registration.accessories, []);
    assert.equal(Buffer.from(configurationId, 'base64').toString(), `${registration.model.modelCode}:${registration.factoryOptionCodes.join(',')}`);
    assert.deepEqual(registration.factoryOptionCodes, [...registration.factoryOptionCodes].sort());
    assert.ok(registration.factoryOptionCodes.includes(registration.paintCode) && registration.factoryOptionCodes.includes(registration.upholsteryCode));
    assert.equal(registration.sourceAcceptedSha256, sha(`${JSON.stringify(accepted)}\n`));
    assert.equal(registration.bindingDigest, inputDigest(accepted.catalogue.sourceBinding));
  }
  // Accessory-bearing accepted rows are flagged before any live run rather than dropped silently.
  const flagged = loaded.registrations.filter((item) => item.dealerAccessories > 0);
  assert.ok(flagged.length > 0);
  for (const item of loaded.registrations) assert.equal(item.dealerAccessories, item.accepted.catalogue.sourceBinding.selection.accessories.length);
});

test('a registration equals the one the prior single-row live run used for the same configuration', async () => {
  const prior = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/observation-plan.json', import.meta.url), 'utf8')).registration;
  const mine = loaded.registrations.find((item) => item.configurationId === prior.configurationId);
  assert.equal(inputDigest(mine.registration), inputDigest(prior));
});

test('rows lacking a source binding, an accepted line, a matching line or a typed appearance are listed, never guessed', () => {
  const [first, second, third, fourth] = loaded.rows.filter((row) => row.catalogue.sourceBinding);
  const accepted = { found: new Map(), conflicts: new Set() };
  const line = (row) => loaded.registrations.find((item) => item.configurationId === row.configurationId).accepted;
  const add = (row, text = JSON.stringify(line(row))) => accepted.found.set(row.configurationId, { line: text, file: 'fixture.jsonl' });
  add(first); add(third); add(fourth);
  accepted.conflicts.add(third.configurationId);
  const changed = structuredClone(fourth); changed.catalogue.sourceBinding.confirmedContext.effectDate.state = 'unknown';
  const result = buildRegistrations({ rows: [first, second, third, changed, loaded.rows.find((row) => !row.catalogue.sourceBinding)], accepted });
  assert.deepEqual(result.registrations.map((item) => item.configurationId), [first.configurationId]);
  assert.deepEqual(Object.fromEntries(result.unregistered.map((item) => [item.configurationId === changed.configurationId ? 'changed' : item.configurationId, item.reason])),
    { [second.configurationId]: 'no-accepted-source-line', [third.configurationId]: 'accepted-source-line-conflict', changed: 'accepted-line-mismatch',
      [loaded.unregistered[0].configurationId]: 'no-source-binding' });
  const untyped = structuredClone(first); untyped.catalogue.sourceBinding.evidence.forEach((item) => { item.locators = item.locators.filter((l) => !l.name.startsWith('paint-')); });
  const stale = new Map([[first.configurationId, { line: JSON.stringify(structuredClone(line(first))), file: 'x' }]]);
  assert.equal(buildRegistrations({ rows: [untyped], accepted: { found: stale, conflicts: new Set() } }).unregistered[0].reason, 'accepted-line-mismatch');
});

test('the live driver observes rows one at a time, counts every request per host and operation and keeps no credential on disk', async (t) => {
  const h = await harness(t); const summary = await h.run();
  assert.equal(summary.observed, 3); assert.equal(summary.haltedBy, null); assert.equal(summary.used, 12);
  assert.deepEqual(h.state.sleeps, [1000, 1000], 'one second between rows');
  const ledger = await h.ledger();
  assert.deepEqual(ledger.requests.perHost, { 'configure.bmw.co.uk': 6, 'prod.ucp.bmw.cloud': 3, 'prod.cosy.bmw.cloud': 3 });
  assert.deepEqual(ledger.requests.perOperation, { page: 3, settings: 3, technical: 3, 'image-manifest': 3 });
  assert.deepEqual(h.bmw.calls.map((call) => call.operation), Array(3).fill(['page', 'settings', 'technical', 'image-manifest']).flat());
  assert.ok(h.bmw.calls.every((call) => ALLOWED_HOSTS.includes(new URL(call.url).hostname)));
  assert.ok(Object.values(ledger.rows).every((row) => row.status === 'observed' && row.qualificationDate === '2026-11-08' && row.attempts === 4));
  for (const name of await readdir(h.out, { recursive: true })) {
    const path = join(h.out, name); const text = await readFile(path, 'utf8').catch(() => '');
    assert.equal(text.includes(SECRET), false, name); assert.equal(text.includes('cosySec'), false, name); assert.equal(text.includes('do-not-retain'), false, name);
  }
});

test('the whole run stops on HTTP 401, 403 or 429 and records the reason; a restart needs an explicit flag', async (t) => {
  for (const [status, operation] of [[401, 'technical'], [403, 'page'], [429, 'image-manifest'], [429, 'settings']]) {
    const h = await harness(t, { overrides: { [operation]: () => new Response('no', { status, headers: { 'content-type': 'application/json' } }) } });
    const summary = await h.run();
    assert.equal(summary.haltedBy, `http-${status}`, `${status} on ${operation}`);
    assert.equal(summary.rowsStarted, 1);
    const ledger = await h.ledger();
    assert.equal(ledger.stop.reason, `http-${status}`);
    const before = h.bmw.calls.length;
    const again = await h.run();
    assert.equal(again.refusedToStart, true); assert.equal(h.bmw.calls.length, before, 'a stopped ledger makes no request');
  }
});

test('a CAPTCHA or challenge response stops the whole run', async (t) => {
  const html = () => new Response('<html>challenge-platform</html>', { headers: { 'content-type': 'text/html' } });
  for (const [operation, response] of [['page', html], ['technical', html], ['image-manifest', html],
    ['technical', () => new Response('{}', { headers: { 'content-type': 'application/json', 'cf-mitigated': 'challenge' } })]]) {
    const h = await harness(t, { overrides: { [operation]: response } });
    const summary = await h.run();
    assert.equal(summary.haltedBy, 'challenge-suspected', operation);
    assert.equal(summary.rowsStarted, 1);
  }
});

test('three consecutive row failures stop the run; a success resets the count', async (t) => {
  const fail = () => new Response('oops', { status: 500, headers: { 'content-type': 'application/json' } });
  const three = await harness(t, { rows: 5, overrides: { technical: fail } });
  const stopped = await three.run();
  assert.equal(stopped.haltedBy, 'consecutive-failures'); assert.equal(stopped.rowsStarted, 3); assert.equal(stopped.incomplete, 3);
  const mixed = await harness(t, { rows: 5, overrides: { technical: (route, n) => (n === 1 || n === 2 || n === 4 || n === 5 ? fail() : null) } });
  const summary = await mixed.run();
  assert.equal(summary.haltedBy, null); assert.equal(summary.observed, 1); assert.equal(summary.incomplete, 4);
  assert.equal((await mixed.ledger()).consecutiveFailures, 2);
});

test('the request cap is cumulative and a row that would exceed it is never started', async (t) => {
  const h = await harness(t, { rows: 4 });
  const first = await h.run({ cap: 9 });
  assert.equal(first.haltedBy, 'cap'); assert.equal(first.rowsStarted, 2); assert.equal(first.used, 8); assert.equal(h.bmw.calls.length, 8);
  const refused = await h.run({ cap: 11 });
  assert.equal(refused.haltedBy, 'cap'); assert.equal(refused.rowsStarted, 0); assert.equal(h.bmw.calls.length, 8, 'the ledger carries the earlier total');
  const more = await h.run({ cap: 16 });
  assert.equal(more.observed, 2); assert.equal(more.used, 16);
});

test('resume skips observed rows, marks an interrupted row incomplete without a request and continues', async (t) => {
  const h = await harness(t, { rows: 4 });
  const first = await h.run({ limit: 1 });
  assert.equal(first.haltedBy, 'limit'); assert.equal(first.observed, 1);
  const crashed = await h.ledger(); const second = h.registrations[1].configurationId;
  crashed.rows[second] = { status: 'started', dir: 'x', qualificationDate: '2026-11-08', attempts: 2 };
  await writeFile(join(h.out, 'ledger.json'), JSON.stringify(crashed));
  const calls = h.bmw.calls.length; const resumed = await h.run();
  assert.equal(resumed.observed, 2); assert.equal(h.bmw.calls.length, calls + 8, 'only the two remaining rows made requests');
  assert.ok(h.bmw.calls.slice(calls).every((call) => call.id !== h.registrations[0].configurationId && call.id !== second));
  const ledger = await h.ledger();
  assert.deepEqual([ledger.rows[second].status, ledger.rows[second].reason], ['incomplete', 'interrupted']);
  assert.equal(ledger.runs.length, 2);
});

test('only the three registered hosts can be contacted and a refused host costs no attempt', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'fucq77-host-')); t.after(() => rm(out, { recursive: true, force: true }));
  const ledger = await openLedger(out, { manifestDigest: loaded.manifestDigest }); const context = { fatal: null, events: [], attempts: 0 };
  let reached = 0; const guarded = createGuardedFetch({ baseFetch: async () => { reached++; return new Response('{}'); }, ledger,
    registration: loaded.registrations[0].registration, context });
  for (const url of ['https://example.com/x', 'http://prod.ucp.bmw.cloud/x', 'https://prod.ucp.bmw.cloud:8443/x', 'https://evil.prod.ucp.bmw.cloud/x', 'not a url']) {
    await assert.rejects(guarded(url, {}), { code: 'host-refused' }, url);
  }
  assert.equal(reached, 0); assert.equal(ledger.used(), 0); assert.equal(context.fatal.reason, 'host-refused');
});

test('a row that would straddle UTC midnight waits until the next day so its plan date matches', async (t) => {
  const h = await harness(t, { rows: 1, clock: Date.parse('2026-11-08T23:59:30Z') });
  const summary = await h.run();
  assert.equal(summary.observed, 1);
  assert.equal(Object.values((await h.ledger()).rows)[0].qualificationDate, '2026-11-09');
  assert.equal(buildRowPlan(h.registrations[0].registration, '2026-11-09').qualificationDate, '2026-11-09');
});

test('the composer qualifies facts, keeps unknowns explicit and references an exterior render without any asset URL', async (t) => {
  const h = await harness(t); await h.run();
  const sidecarDir = await mkdtemp(join(tmpdir(), 'fucq77-sidecar-')); t.after(() => rm(sidecarDir, { recursive: true, force: true }));
  const { manifest, entries } = await composeEnrichment({ loaded, out: h.out, sidecarDir });
  assert.equal(entries.length, 240); assert.deepEqual(entries.map((e) => e.configurationId), [...entries.map((e) => e.configurationId)].sort());
  assert.equal(manifest.schemaVersion, 'demo-enrichment.v1'); assert.equal(manifest.demoManifestDigest, loaded.manifestDigest);
  assert.equal(manifest.counts.rows, 240); assert.equal(manifest.counts.observed, 3); assert.equal(manifest.counts.notObserved, 237);
  assert.equal(manifest.counts.rowsWithExteriorReference, 3);
  assert.deepEqual(manifest.counts.facts.seats, { known: 3, unknown: 237 });
  assert.deepEqual(manifest.requests.perHost, { 'configure.bmw.co.uk': 6, 'prod.ucp.bmw.cloud': 3, 'prod.cosy.bmw.cloud': 3 });
  const observed = entries.find((e) => e.observation === 'observed');
  assert.deepEqual([observed.facts.seats.state, observed.facts.seats.value, observed.facts.seats.unit], ['known', 5, 'COUNT']);
  assert.deepEqual(observed.facts.seats.provenance, { kind: 'observed', source: 'BMW UK OTD', observedDate: '2026-11-08' });
  assert.deepEqual([observed.facts.acceleration.value, observed.facts.acceleration.definition, observed.facts.acceleration.unit], [6.1, '0–100 KM/H', 'SECONDS']);
  assert.deepEqual([observed.facts.luggageNormal.state, observed.facts.luggageNormal.reason, observed.facts.luggageNormal.value], ['unknown', 'placeholder-value', null]);
  assert.equal(observed.facts.luggageExpanded.reason, 'missing-value');
  for (const name of ['rangeOrEconomy', 'co2']) assert.deepEqual([observed.facts[name].state, observed.facts[name].reason], ['unknown', 'unmapped-meaning']);
  assert.ok(observed.unmappedOtdCodes.includes('A_LAENGE') && observed.unmappedOtdCodes.includes('E_ABGAS') && !observed.unmappedOtdCodes.includes('N_SITZE'));
  const [reference] = observed.imageReferences;
  assert.deepEqual([reference.source, reference.viewpoint, reference.device, reference.fidelity, reference.pointer, reference.dimensions],
    ['BMW COSY', 'HEROFRONT', 'desktop', 'representative-configuration',
      '/stage-fullscreen-views-legacy-newnames/desktop/namedImages/0/images/1', { width: 2560, height: 1646 }]);
  assert.equal(reference.selection.candidates, 2); assert.ok(Object.values(reference.fidelityDetail).every((v) => v === 'unknown'));
  assert.equal(reference.manifestRequest.registrationDigest, observed.evidence.registrationDigest);
  const jsonl = await readFile(join(sidecarDir, 'enrichment.jsonl'), 'utf8');
  assert.equal(manifest.checksums['enrichment.jsonl'], sha(jsonl));
  for (const forbidden of ['http', 'cosySec', 'do-not-retain', SECRET, '.webp']) assert.equal(jsonl.includes(forbidden), false, forbidden);
  const missing = entries.find((e) => e.observation === 'not-observed' && !e.reason.startsWith('not-registrable'));
  assert.deepEqual(Object.values(missing.facts).map((f) => [f.state, f.reason]), Array(6).fill(['unknown', 'not-observed']));
  assert.deepEqual([missing.imageReferences, missing.unmappedOtdCodes, missing.reason], [[], [], 'not-run']);
  assert.equal(entries.find((e) => e.configurationId === loaded.unregistered[0].configurationId).reason, 'not-registrable:no-source-binding');
  await composeEnrichment({ loaded, out: h.out, sidecarDir });
  assert.equal(await readFile(join(sidecarDir, 'enrichment.jsonl'), 'utf8'), jsonl, 'composition is deterministic');
});

test('a tampered checkpoint or a missing desktop HEROFRONT view never yields a fact or a reference', async (t) => {
  const h = await harness(t, { rows: 2, overrides: { 'image-manifest': (route) => (route.id === loaded.registrations[1].configurationId
    ? Response.json({ 'stage-fullscreen-views-legacy-newnames': { desktop: { metaData: { width: 1, height: 1 }, namedImages: [{ name: 'g',
      images: [{ viewImage: 'x', distinctionParameters: { POV: 'REAR' } }] }] } } }) : null) } });
  await h.run(); const ledger = await h.ledger();
  const tamper = join(h.out, 'rows', ledger.rows[h.registrations[0].configurationId].dir, 'observer-checkpoint.json');
  const envelope = JSON.parse(await readFile(tamper, 'utf8')); envelope.contentDigest = '0'.repeat(64); await writeFile(tamper, JSON.stringify(envelope));
  const sidecarDir = await mkdtemp(join(tmpdir(), 'fucq77-sidecar-')); t.after(() => rm(sidecarDir, { recursive: true, force: true }));
  const { entries } = await composeEnrichment({ loaded, out: h.out, sidecarDir });
  const byId = new Map(entries.map((e) => [e.configurationId, e]));
  const rejected = byId.get(h.registrations[0].configurationId);
  assert.deepEqual([rejected.observation, rejected.reason, rejected.facts.seats.state, rejected.facts.seats.reason], ['rejected', 'checkpoint-not-observed', 'unknown', 'qualification-rejected']);
  const noView = byId.get(h.registrations[1].configurationId);
  assert.deepEqual([noView.observation, noView.facts.seats.state, noView.imageReferences, noView.imageReferenceReason], ['observed', 'known', [], 'no-desktop-herofront-view']);
});

test('a row whose accepted selection carries a dealer accessory is rejected for facts but keeps its own exterior reference', async (t) => {
  const withAccessory = loaded.registrations.filter((item) => item.accepted.catalogue.sourceBinding.selection.accessories.length > 0);
  const clean = loaded.registrations.find((item) => item.accepted.catalogue.sourceBinding.selection.accessories.length === 0);
  assert.equal(withAccessory.length, 99);
  const h = await harness(t, { pick: [withAccessory[0], clean, withAccessory[1]].sort((a, b) => (a.configurationId < b.configurationId ? -1 : 1)) });
  assert.equal((await h.run()).observed, 3);
  const sidecarDir = await mkdtemp(join(tmpdir(), 'fucq77-sidecar-')); t.after(() => rm(sidecarDir, { recursive: true, force: true }));
  const { manifest, entries } = await composeEnrichment({ loaded, out: h.out, sidecarDir });
  const byId = new Map(entries.map((e) => [e.configurationId, e]));
  for (const item of [withAccessory[0], withAccessory[1]]) {
    const entry = byId.get(item.configurationId);
    assert.deepEqual([entry.observation, entry.reason, entry.imageReferences.length, entry.imageReferenceReason], ['rejected', 'dealer-accessory-selected', 1, null]);
    assert.ok(Object.values(entry.facts).every((f) => f.state === 'unknown' && f.reason === 'qualification-rejected'));
    assert.equal(entry.imageReferences[0].manifestRequest.registrationDigest, inputDigest(item.registration));
    assert.equal(entry.imageReferences[0].manifestRequest.retainedSha256, entry.evidence.imageManifest.retainedSha256);
  }
  assert.equal(byId.get(clean.configurationId).observation, 'observed');
  assert.deepEqual([manifest.counts.observed, manifest.counts.rejected, manifest.counts.rowsWithExteriorReference], [1, 2, 3]);
  const evidence = { manifest, jsonl: await readFile(join(sidecarDir, 'enrichment.jsonl'), 'utf8') };
  assert.equal(scoreEnrichment(evidence, loaded.rows, loaded.manifestDigest).summary.valid, true);
});

test('composed output validates against the staged demo store and closes the gate only with every row observed and rendered', async (t) => {
  const guard = offlineEgressGuard(t);
  const h = await harness(t); await h.run();
  const sidecarDir = await mkdtemp(join(tmpdir(), 'fucq77-sidecar-')); t.after(() => rm(sidecarDir, { recursive: true, force: true }));
  await composeEnrichment({ loaded, out: h.out, sidecarDir });
  const evidence = { manifest: JSON.parse(await readFile(join(sidecarDir, 'manifest.json'), 'utf8')), jsonl: await readFile(join(sidecarDir, 'enrichment.jsonl'), 'utf8') };
  const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
  const plan = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
  const verify = (enrichmentEvidence) => verifyStagedDemoFleet({ plan, matrixText, directory: plan.publication.stagedDirectory, enrichmentEvidence,
    policyService: createPolicyService(), approvedImages: APPROVED_CORPUS_IMAGES, policyRead: { runId: 'enrich-test', asOf: `${plan.qualificationDate}T12:00:00.000Z` } });
  const partial = await verify(evidence);
  assert.equal(partial.status, 'verified-offline'); assert.equal(partial.enrichment.valid, true);
  assert.deepEqual([partial.enrichment.gate.closed, partial.enrichment.gate.observedRows, partial.enrichment.gate.stagedRows], [false, 3, 240]);
  assert.ok(partial.openGates.some((gate) => gate.gate === 'facts-and-images' && gate.detail.includes('facts satisfied 4 of 240')));
  // Record-known seats (two supplement rows) stay known; the sidecar adds the observed rows on top.
  const baseline = countOtdFacts(loaded.rows, loaded.manifest);
  assert.ok(partial.facts.seats.known >= Math.max(3, baseline.seats.known)); assert.ok(partial.facts.acceleration.known >= 3);
  assert.equal(partial.facts.co2.known, 0); assert.equal(partial.images.sidecarReferenceRows, 3);

  // Every row observed (the unregistrable T5MJ row covered by its own record facts and image) closes the gate; a rejected row or a missing render reopens it.
  const complete = completeEvidence(partial, evidence, plan);
  const closed = await verify(complete);
  assert.equal(closed.enrichment.gate.closed, true); assert.equal(closed.openGates.some((gate) => gate.gate === 'facts-and-images'), false);
  assert.equal(closed.status, 'verified-offline'); assert.equal(closed.acceptanceComplete, false);
  assert.equal(closed.facts.co2.unknown, 240); assert.equal(closed.facts.seats.known, 240); assert.equal(closed.images.configurationsWithoutImage, 0);
  const lines = complete.jsonl.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const reopened = (mutate) => { const copy = structuredClone(lines); mutate(copy); return withEntries(complete, copy); };
  const rejectedEntry = (rows) => { const row = rows.find((r) => r.observation === 'observed');
    Object.assign(row, { observation: 'rejected', reason: 'dealer-accessory-selected', observedDate: null, unmappedOtdCodes: [] });
    for (const fact of Object.values(row.facts)) Object.assign(fact, { state: 'unknown', value: null, reason: 'qualification-rejected', provenance: { kind: 'unknown', source: null, observedDate: null } }); };
  const rejected = await verify(reopened(rejectedEntry));
  assert.equal(rejected.enrichment.valid, true, 'a rejected entry may keep its image reference');
  assert.deepEqual([rejected.enrichment.gate.closed, rejected.enrichment.gate.rejectedRows, rejected.enrichment.gate.factsSatisfiedRows], [false, 1, 239]);
  assert.equal(rejected.images.configurationsWithoutImage, 0);
  assert.ok(rejected.openGates.some((gate) => gate.gate === 'facts-and-images' && gate.detail.includes('rejected 1')));
  assert.equal(closed.enrichment.gate.recordCoveredRows, 1);
  const noRender = await verify(reopened((rows) => { rows[0].imageReferences = []; }));
  assert.equal(noRender.enrichment.gate.closed, false); assert.ok(noRender.openGates.some((gate) => gate.gate === 'facts-and-images'));
  guard.assertZero();
});

// Rebuilds an evidence object around a changed entry list: counts and checksum stay consistent unless a test breaks them.
function withEntries(evidence, entries, { counts = true } = {}) {
  const jsonl = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  const manifest = structuredClone(evidence.manifest); manifest.checksums['enrichment.jsonl'] = sha(jsonl);
  if (counts) manifest.counts = recount(entries);
  return { manifest, jsonl };
}
function recount(entries) {
  const facts = {}; for (const name of ['acceleration', 'seats', 'luggageNormal', 'rangeOrEconomy', 'co2', 'luggageExpanded']) facts[name] = { known: 0, unknown: 0 };
  const counts = { rows: 0, observed: 0, notObserved: 0, rejected: 0, rowsWithExteriorReference: 0, facts };
  for (const e of entries) {
    counts.rows++; counts[e.observation === 'observed' ? 'observed' : e.observation === 'rejected' ? 'rejected' : 'notObserved']++;
    if (e.imageReferences.length) counts.rowsWithExteriorReference++;
    for (const name of Object.keys(facts)) facts[name][e.facts[name].state === 'known' ? 'known' : 'unknown']++;
  }
  return counts;
}
function completeEvidence(partial, evidence, plan) {
  const lines = evidence.jsonl.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const template = lines.find((entry) => entry.observation === 'observed');
  const entries = lines.map((entry) => (entry.observation === 'observed' || entry.reason?.startsWith('not-registrable:') ? entry : { ...structuredClone(template), configurationId: entry.configurationId,
    demoManifestDigest: entry.demoManifestDigest }));
  assert.equal(plan.publication.stagedDirectory.endsWith(entries[0].demoManifestDigest), true);
  return withEntries(evidence, entries);
}

test('the verifier rejects a foreign id, a duplicate, a digest or checksum mismatch and malformed facts or references', async (t) => {
  const h = await harness(t, { rows: 2 }); await h.run();
  const sidecarDir = await mkdtemp(join(tmpdir(), 'fucq77-sidecar-')); t.after(() => rm(sidecarDir, { recursive: true, force: true }));
  await composeEnrichment({ loaded, out: h.out, sidecarDir });
  const evidence = { manifest: JSON.parse(await readFile(join(sidecarDir, 'manifest.json'), 'utf8')), jsonl: await readFile(join(sidecarDir, 'enrichment.jsonl'), 'utf8') };
  const records = loaded.rows; const digest = loaded.manifestDigest;
  const base = scoreEnrichment(evidence, records, digest);
  assert.equal(base.summary.valid, true); assert.equal(base.entries.size, 240); assert.equal(base.summary.counts.observed, 2);
  const lines = evidence.jsonl.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const errorsFor = (mutate, options) => { const copy = structuredClone(lines); mutate(copy); const scored = scoreEnrichment(withEntries(evidence, copy, options), records, digest);
    assert.equal(scored.summary.valid, false); assert.equal(scored.entries.size, 0, 'no value of a rejected sidecar is applied'); return scored.summary.errors; };
  assert.deepEqual(errorsFor((rows) => { rows[0].configurationId = 'Zm9yZWlnbg=='; }), ['foreign-configuration']);
  assert.ok(errorsFor((rows) => { rows.push(structuredClone(rows[0])); }).includes('duplicate-entry'));
  assert.ok(errorsFor((rows) => { rows[0].demoManifestDigest = 'a'.repeat(64); }).includes('entry-digest-mismatch'));
  assert.ok(errorsFor((rows) => { rows[0].facts.seats = { state: 'known', value: 5 }; }).includes('malformed-fact'));
  assert.ok(errorsFor((rows) => { const o = rows.find((r) => r.observation === 'observed'); o.imageReferences[0].pointer = 'https://prod.cosy.bmw.cloud/a.webp'; }).includes('malformed-image-reference'));
  assert.ok(errorsFor((rows) => { rows.find((r) => r.observation === 'not-observed').imageReferences = structuredClone(rows.find((r) => r.observation === 'observed').imageReferences); })
    .includes('unobserved-entry-with-image'));
  assert.ok(errorsFor((rows) => { rows.find((r) => r.observation === 'not-observed').observation = 'observed'; }, { counts: false }).includes('count-mismatch'));
  assert.ok(errorsFor((rows) => { rows.pop(); }, { counts: false }).includes('count-mismatch'));
  const otherDigest = structuredClone(evidence); otherDigest.manifest.demoManifestDigest = 'b'.repeat(64);
  assert.ok(scoreEnrichment(otherDigest, records, digest).summary.errors.includes('manifest-digest-mismatch'));
  const tampered = { manifest: evidence.manifest, jsonl: `${evidence.jsonl}\n` };
  assert.ok(scoreEnrichment(tampered, records, digest).summary.errors.includes('checksum-mismatch'));
  assert.equal(scoreEnrichment(null, records, digest).summary.present, false);
});

test('sidecar files join the privacy scan and an asset URL planted in them is flagged', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fucq77-root-')); t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await enrichmentPrivacyFiles(root), []);
  const dir = join(root, 'server/data/gcsp/vehicle-evidence/demo-enrichment.v1'); await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
  await writeFile(join(dir, 'manifest.json'), '{"schemaVersion":"demo-enrichment.v1"}'); await writeFile(join(dir, 'enrichment.jsonl'), '{"a":"https://x.test/r.webp?sig=abc"}\n');
  const files = await enrichmentPrivacyFiles(root);
  assert.deepEqual(files.map(([name]) => name.split('/').pop()), ['manifest.json', 'enrichment.jsonl']);
  assert.equal(privacyScan(files).matches.imageUrlQuery, 1);
});

test('command line options are strict: live mode needs an absolute directory and a cap, and modes do not mix', () => {
  assert.deepEqual(parseEnrichmentArgs([]), {});
  assert.equal(parseEnrichmentArgs(['--execute', '--out', '/tmp/x', '--cap', '40']).cap, 40);
  for (const bad of [['--execute'], ['--execute', '--out', 'rel', '--cap', '40'], ['--execute', '--out', '/x', '--cap', '3'], ['--execute', '--compose', '--out', '/x', '--cap', '8'],
    ['--compose'], ['--cap', '8'], ['--out', '/x'], ['--execute', '--out', '/x', '--cap', '8', '--cap', '9']]) assert.equal(parseEnrichmentArgs(bad), null, bad.join(' '));
  assert.equal(parseEnrichmentArgs(['--compose', '--out', '/x']).out, '/x');
});
