import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalBmwVinGuideRequest, createBmwVinGuideAdapter, createBmwVinGuideIdentityGuard,
  presentBmwVinGuide } from '../vehicle-evidence/bmw-vin-guide-adapter.js';
import { createSyntheticBmwVinGuideProvider } from '../vehicle-evidence/bmw-vin-guide-synthetic.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';

// Reuse the existing explicitly fictional current-car allocator; never retain or print its VIN.
const input = await corpusInput();
const vin = input.allocationInventory.records[0].vin17;
const request = { vin, locale: 'en-GB' };
const synthetic = (scenario = 'available') => createSyntheticBmwVinGuideProvider({ vin, scenario });
const offline = (scenario) => createBmwVinGuideAdapter({ provider: synthetic(scenario) });
const expectedUnknowns = ['paint', 'wheels', 'installedEquipment', 'buildDate', 'connectedUsage', 'schemeEligibility'];
function transports() {
  const calls = { key: 0, manual: 0, pdf: 0, cosy: 0 };
  const provider = { id: 'instrumented-guide', version: '1', sourceKind: 'authorised-live',
    async resolve(req, { signal }) {
      for (const operation of Object.keys(calls)) calls[operation] += 1;
      assert.equal(signal.aborted, false);
      return synthetic().resolve(req);
    } };
  return { calls, provider, zero: () => assert.deepEqual(Object.values(calls), [0, 0, 0, 0]) };
}
const unknownRegistry = { async classifyIdentity() { return { status: 'not-found', identityKind: 'unknown', liveEligible: false }; } };
function authority(registry = unknownRegistry) {
  const owned = new WeakSet();
  const context = Object.freeze({ purpose: 'external-guide-lookup' }); owned.add(context);
  const guard = createBmwVinGuideIdentityGuard({ registry,
    authorizeExternalLookup: async ({ context: candidate, vin: target, locale }) => owned.has(candidate)
      && target === vin && locale === 'en-GB'
      ? { status: 'ok', identityKind: 'real', lookupFlow: 'externally-authorised', authorized: true }
      : { status: 'forbidden' } });
  return { guard, context };
}

test('lookup is disabled until explicitly selected; validation normalises exact 17-character VIN and explicit locale', async () => {
  assert.equal((await createBmwVinGuideAdapter().resolve(request)).status, 'disabled');
  assert.deepEqual(canonicalBmwVinGuideRequest({ vin: vin.toLowerCase(), locale: 'EN-gb' }), request);
  for (const bad of [null, {}, { vin, locale: '' }, { vin, locale: 'en' }, { vin: vin.slice(-7), locale: 'en-GB' },
    { vin: ` ${vin}`, locale: 'en-GB' }, ...['I', 'O', 'Q', '-', 'é'].map((x) => ({ vin: x + vin.slice(1), locale: 'en-GB' }))]) {
    assert.equal((await offline().resolve(bad)).status, 'invalid-input');
  }
  const regional = vin.slice(0, 8) + (vin[8] === '0' ? '1' : '0') + vin.slice(9);
  assert.ok(canonicalBmwVinGuideRequest({ vin: regional, locale: 'en-GB' }), 'regional check digit is not universal validation');
  assert.equal((await offline().resolve({ ...request, locale: 'fr-FR' })).status, 'unsupported-locale');
});

test('synthetic provider returns bounded handbook metadata and zero external calls', async (t) => {
  const calls = transports();
  const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error('unexpected external call'); };
  t.after(() => { globalThis.fetch = previous; });
  const result = await createBmwVinGuideAdapter({ provider: synthetic(), fallbackProvider: calls.provider }).resolve(request);
  assert.equal(result.status, 'available'); calls.zero();
  assert.equal(result.source.kind, 'synthetic'); assert.equal(result.source.observedDate, '2026-11-05');
  assert.equal(result.guide.title, 'Fictional BMW handbook'); assert.equal(result.guide.derivative, 'Fictional reference');
  assert.equal(result.guide.brand, 'BMW'); assert.match(result.guide.disclaimer, /may not be fitted/);
  assert.equal(result.guide.links[0].availability, 'available'); assert.equal(result.guide.links[0].format, 'pdf');
  assert.equal(result.guide.links[0].delivery, 'metadata-only'); assert.equal(result.guide.links[0].href, null);
  assert.equal(result.illustration.role, 'vin-linked-illustration'); assert.equal(result.illustration.status, 'available');
  assert.equal(result.illustration.fidelity, 'unverified'); assert.equal(result.completeness.handbook, 'complete');
  for (const name of expectedUnknowns) assert.deepEqual(result.facts[name], { state: 'unknown', value: null });
  assert.deepEqual(result.equipment, { state: 'unknown', codes: null, complete: false });
  assert.equal(JSON.stringify(result).includes(vin), false);
});

test('seven presentation states retain independent current-car evidence and never infer empty equipment', async () => {
  const results = [await createBmwVinGuideAdapter().resolve(request), await offline().resolve({}), await offline().resolve(request),
    await offline('no-guide').resolve(request), await offline().resolve({ ...request, locale: 'de-DE' }),
    await offline('partial').resolve(request), await offline('unavailable').resolve(request)];
  assert.deepEqual(results.map((r) => r.status), ['disabled', 'invalid-input', 'available', 'no-guide', 'unsupported-locale', 'partial', 'source-unavailable']);
  const existing = { paint: { state: 'known', value: 'Scenario blue', source: 'supplied scenario' },
    installedEquipment: { state: 'known', codes: ['scenario-feature'] } };
  for (const result of results) {
    const projection = presentBmwVinGuide(result, existing);
    assert.equal(projection.status, result.status); assert.ok(projection.message.length > 10);
    assert.deepEqual(projection.currentCarFacts, existing); assert.deepEqual(projection.equipment, { state: 'unknown', codes: null, complete: false });
    projection.currentCarFacts.paint.value = 'mutated'; assert.equal(existing.paint.value, 'Scenario blue');
  }
});

test('real entry denies missing/forged/browser context, registry misses/outages and synthetic flows before every transport', async () => {
  for (const registry of [undefined, unknownRegistry, { classifyIdentity: async () => { throw new Error('private upstream detail'); } },
    { classifyIdentity: async () => ({ status: 'source-unavailable', identityKind: 'unknown' }) },
    { classifyIdentity: async () => ({ status: 'ok', identityKind: 'synthetic' }) }]) {
    const real = transports(); const { guard, context } = authority(registry);
    const adapter = createBmwVinGuideAdapter({ provider: real.provider, guard });
    for (const candidate of [undefined, {}, { identityKind: 'real', authorized: true, lookupFlow: 'externally-authorised' }]) {
      assert.equal((await adapter.resolve({ ...request, identityKind: 'real', liveEligible: true }, candidate)).status, 'source-unavailable');
    }
    if (registry !== unknownRegistry && registry !== undefined) assert.equal((await adapter.resolve(request, context)).status, 'source-unavailable');
    real.zero();
  }
  const real = transports(); const guard = createBmwVinGuideIdentityGuard({ registry: unknownRegistry,
    authorizeExternalLookup: async () => ({ status: 'ok', identityKind: 'synthetic', lookupFlow: 'synthetic', authorized: true }) });
  assert.equal((await createBmwVinGuideAdapter({ provider: real.provider, guard }).resolve(request, {})).status, 'source-unavailable'); real.zero();
});

test('only injected server authority can explicitly permit a real entry; permission binds VIN and locale', async () => {
  const real = transports(); const { guard, context } = authority(); const adapter = createBmwVinGuideAdapter({ provider: real.provider, guard });
  assert.equal((await adapter.resolve(request, structuredClone(context))).status, 'source-unavailable'); real.zero();
  const result = await adapter.resolve(request, context);
  assert.equal(result.status, 'available'); assert.equal(result.source.kind, 'authorised-live');
  assert.deepEqual(Object.values(real.calls), [1, 1, 1, 1]);
  assert.equal((await adapter.resolve({ ...request, locale: 'en-US' }, context)).status, 'source-unavailable');
});

test('provider switching and fallback recheck server authority; denial cannot trigger another provider', async () => {
  const real = transports(); const { guard, context } = authority();
  assert.equal((await createBmwVinGuideAdapter({ provider: synthetic(), guard }).resolve(request)).status, 'available');
  assert.equal((await createBmwVinGuideAdapter({ provider: real.provider, guard }).resolve(request)).status, 'source-unavailable');
  const fallback = createBmwVinGuideAdapter({ provider: synthetic('unavailable'), fallbackProvider: real.provider, guard });
  assert.equal((await fallback.resolve(request, { identityKind: 'synthetic' })).status, 'source-unavailable'); real.zero();
  assert.equal((await fallback.resolve(request, context)).status, 'source-unavailable'); real.zero();
  const primary = { ...real.provider, resolve: async () => ({ status: 'source-unavailable' }) };
  const permitted = await createBmwVinGuideAdapter({ provider: primary, fallbackProvider: real.provider, guard }).resolve(request, context);
  assert.equal(permitted.status, 'available'); assert.equal(permitted.attempts.length, 2);
  assert.equal(permitted.source.kind, 'authorised-live');
  let checks = 0; const changing = authority({ async classifyIdentity() { checks += 1;
    return checks === 1 ? { status: 'not-found', identityKind: 'unknown' } : { status: 'ok', identityKind: 'synthetic' }; } });
  const first = { ...real.provider, resolve: async () => ({ status: 'source-unavailable' }) };
  const denied = await createBmwVinGuideAdapter({ provider: first, fallbackProvider: real.provider, guard: changing.guard }).resolve(request, changing.context);
  assert.equal(denied.status, 'source-unavailable'); assert.equal(checks, 2); assert.deepEqual(Object.values(real.calls), [1, 1, 1, 1]);
});

test('missing guard/classifier/authorization, valid format and browser flags cannot establish real identity', async () => {
  const real = transports();
  for (const guard of [undefined, createBmwVinGuideIdentityGuard(), createBmwVinGuideIdentityGuard({ registry: unknownRegistry }),
    createBmwVinGuideIdentityGuard({ authorizeExternalLookup: async () => ({ status: 'ok', identityKind: 'real', lookupFlow: 'externally-authorised', authorized: true }) })]) {
    assert.equal((await createBmwVinGuideAdapter({ provider: real.provider, guard }).resolve(request,
      { identityKind: 'real', liveEligible: true, authorized: true })).status, 'source-unavailable');
  }
  real.zero();
});

test('truncated or unattributed content remains partial; private fields/links/identifiers never escape', async () => {
  const { guard, context } = authority();
  const provider = { id: 'safe-stub', version: '1', sourceKind: 'authorised-live', async resolve(req) {
    const data = await synthetic().resolve(req);
    data.guide.privateVin = vin; data.guide.links.push({ assetRef: vin, label: 'private', format: 'pdf', availability: 'available' });
    data.guide.sections.push({ id: 'private-reference', title: `Private reference ${vin.slice(-7)}` });
    data.guide.links[0].href = `https://private.invalid/${vin}`;
    data.guide.sections.push({ id: 'bad', title: '<p>unsafe</p>' });
    data.completeness = undefined; return data;
  } };
  const result = await createBmwVinGuideAdapter({ provider, guard }).resolve(request, context);
  assert.equal(result.status, 'partial'); assert.equal(result.completeness.links, 'partial');
  assert.equal(result.guide.links.length, 1); assert.equal(result.guide.sections.length, 1);
  assert.equal(JSON.stringify(result).includes(vin), false); assert.equal(JSON.stringify(result).includes('https:'), false);
});

test('a returned identifying suffix is rejected rather than published as ordinary handbook text', async () => {
  const { guard, context } = authority();
  const provider = { id: 'safe-stub', version: '1', sourceKind: 'authorised-live', async resolve(req) {
    const data = await synthetic().resolve(req); data.guide.title = `Private reference ${vin.slice(-7)}`; return data;
  } };
  const result = await createBmwVinGuideAdapter({ provider, guard }).resolve(request, context);
  assert.equal(result.status, 'partial'); assert.equal(result.guide.title, null);
  assert.equal(JSON.stringify(result).includes(vin.slice(-7)), false);
});

test('actual retained registry identities remain blocked through deactivation, restart, miss and damaged inventory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guide-registry-')); t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = join(root, 'candidate'); assert.equal((await writeCorpusCandidate(candidate, input, options)).status, 'ok');
  const registry = createSyntheticRegistry({ root: join(root, 'store'), ...options });
  assert.equal((await registry.publish(candidate)).status, 'ok');
  const real = transports();
  for (const port of [registry, createSyntheticRegistry({ root: join(root, 'store'), ...options })]) {
    await port.load(); const { guard, context } = authority(port);
    assert.equal((await createBmwVinGuideAdapter({ provider: real.provider, guard }).resolve(request, context)).status, 'source-unavailable');
    await port.deactivate();
    assert.equal((await createBmwVinGuideAdapter({ provider: synthetic('unavailable'), fallbackProvider: real.provider, guard }).resolve(request, context)).status, 'source-unavailable');
  }
  await rm(join(root, 'store', 'identity-inventory.json'));
  const restarted = createSyntheticRegistry({ root: join(root, 'store'), ...options }); const { guard, context } = authority(restarted);
  assert.equal((await createBmwVinGuideAdapter({ provider: real.provider, guard }).resolve(request, context)).status, 'source-unavailable'); real.zero();
});

test('malformed/private provider responses and thrown errors become safe unavailable; timeout is bounded', async () => {
  const { guard, context } = authority();
  for (const resolve of [async () => { throw new Error(`private-${vin}`); }, async () => ({ status: 'available', guide: { title: '<script>private</script>' } }),
    async (_req, { signal }) => new Promise((done) => signal.addEventListener('abort', () => done({ status: 'source-unavailable' }), { once: true }))]) {
    const provider = { id: 'stub', version: '1', sourceKind: 'authorised-live', resolve };
    const result = await createBmwVinGuideAdapter({ provider, guard, timeoutMs: 20 }).resolve(request, context);
    assert.equal(result.status, 'source-unavailable'); assert.equal(JSON.stringify(result).includes(vin), false);
    assert.equal(JSON.stringify(result).includes('<script>'), false);
  }
});
