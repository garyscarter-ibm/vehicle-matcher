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

// New keys and identities exist only in memory; assertions never print either private request form.
const { generateKeyPairSync, privateDecrypt, constants: cryptoConstants, publicEncrypt, randomBytes } = await import('node:crypto');
const { createBmwDriversGuideAdapter } = await import('../vehicle-evidence/bmw-drivers-guide-provider.js');
const rsaKeys = [0, 1].map(() => generateKeyPairSync('rsa', { modulusLength: 2048 }));
const keyBody = (key = rsaKeys[0].publicKey) => ({ interfaceVersion: '4.0', status: 'OK',
  publicKeyData: { algorithm: 'RSA', pem: key.export({ format: 'der', type: 'spki' }).toString('base64') } });
const manualBody = (locale = 'en-gb', status = 'OK') => ({ interfaceVersion: '4.0', status,
  manualData: { locale, carName: 'Fictional handbook', derivative: 'Fictional reference', brand: 'BMW',
    handbookDisclaimer: 'Non-binding additional service. Described equipment may not be fitted. Consult the vehicle handbook.',
    sections: [{ title: 'Getting started' }], links: [{ label: 'Handbook', format: 'pdf', availability: 'available' }] } });
const response = (data, status = 200) => ({ status, body: JSON.stringify(data) });
function providerAuthority({ allow = () => true } = {}) {
  const context = Object.freeze({ purpose: 'private-offline-guide-test' });
  let checks = 0;
  const guard = createBmwVinGuideIdentityGuard({ registry: unknownRegistry,
    authorizeExternalLookup: async ({ context: candidate, vin: target, locale }) => {
      checks += 1;
      return candidate === context && target === vin && allow({ checks, locale })
        ? { status: 'ok', identityKind: 'real', lookupFlow: 'externally-authorised', authorized: true }
        : { status: 'forbidden' };
    } });
  return { context, guard, get checks() { return checks; } };
}
function providerHarness({ manual = (_call, locale) => response(manualBody(locale)), key = () => response(keyBody()),
  authority: permitted = providerAuthority(), timeoutMs = 1500, keyHandling, decodeManual = (data) => data.manualData, useDefaultDecoder = false, clock = () => new Date('2026-11-05T12:00:00Z') } = {}) {
  const calls = [];
  const transport = async (call) => {
    calls.push(call);
    assert.equal(call.method, 'GET'); assert.equal(call.redirect, 'error');
    assert.equal(call.signal.aborted, false); assert.ok(Number.isSafeInteger(call.maxResponseBytes));
    const url = new URL(call.url);
    assert.ok(url.origin === 'https://baonline.bmw.com' && !url.hash);
    if (url.pathname === '/digital/v4.0/key') {
      assert.ok(!url.search); return key(call, calls.filter((row) => new URL(row.url).pathname.endsWith('/key')).length);
    }
    assert.ok(url.pathname === '/digital/v4.0/manual');
    assert.deepEqual([...url.searchParams.keys()], ['encryptedVin', 'locale']);
    return manual(call, url.searchParams.get('locale'));
  };
  return { calls, permitted, adapter: createBmwDriversGuideAdapter({ transport, guard: permitted.guard, timeoutMs, keyHandling, clock, decodeManual: useDefaultDecoder ? undefined : decodeManual }) };
}
function assertPrivate(result, secrets = []) {
  const output = JSON.stringify(result).toUpperCase();
  for (const secret of [vin, vin.slice(-7), ...secrets]) assert.ok(!output.includes(secret.toUpperCase()), 'private value absent');
  assert.ok(!/https?:|encryptedVin|[?#]/i.test(output), 'private URLs absent');
  assert.deepEqual(result.equipment, { state: 'unknown', codes: null, complete: false });
  for (const field of expectedUnknowns) assert.deepEqual(result.facts[field], { state: 'unknown', value: null });
}

test('Driver’s Guide defaults disabled and cannot enter its private provider without current trusted authority', async () => {
  assert.equal((await createBmwDriversGuideAdapter().resolve(request)).status, 'disabled');
  const harness = providerHarness();
  for (const context of [undefined, {}, structuredClone(harness.permitted.context)]) {
    const result = await harness.adapter.resolve(request, context);
    assert.equal(result.failureDetail, 'identity-denied'); assertPrivate(result);
  }
  assert.equal(harness.calls.length, 0);
  assert.equal((await harness.adapter.resolve({ vin: vin.slice(-7), locale: 'en-GB' }, harness.permitted.context)).status, 'invalid-input');
  assert.equal(harness.calls.length, 0);
  for (const allow of [({ checks }) => checks < 2, ({ checks }) => checks < 3]) {
    const denied = providerHarness({ authority: providerAuthority({ allow }) });
    const result = await denied.adapter.resolve(request, denied.permitted.context);
    assert.equal(result.failureDetail, 'identity-denied');
    assert.equal(denied.calls.length, denied.permitted.checks === 2 ? 0 : 1);
  }
});

test('fresh source keys encrypt the exact private identity as RSA PKCS#1 v1.5 and base64url on each resolve', async () => {
  const harness = providerHarness({ key: (_call, count) => response(keyBody(rsaKeys[(count - 1) % 2].publicKey)) });
  const ciphertexts = [];
  for (let i = 0; i < 2; i += 1) {
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, 'partial'); assert.equal(result.source.kind, 'authorised-live');
    assert.equal(result.source.provider, 'bmw-drivers-guide'); assert.equal(result.source.observedDate, '2026-11-05');
    assert.equal(result.requestedLocale, 'en-GB'); assert.equal(result.resolvedLocale, 'en-GB');
    const encrypted = new URL(harness.calls[i * 2 + 1].url).searchParams.get('encryptedVin'); ciphertexts.push(encrypted);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(encrypted));
    const padded = privateDecrypt({ key: rsaKeys[i].privateKey, padding: cryptoConstants.RSA_NO_PADDING }, Buffer.from(encrypted, 'base64url'));
    assert.equal(padded[0], 0); assert.equal(padded[1], 2);
    const end = padded.indexOf(0, 2); assert.ok(end >= 10);
    assert.ok(padded.subarray(2, end).every((byte) => byte !== 0));
    assert.ok(padded.subarray(end + 1).equals(Buffer.from(vin, 'ascii')), 'decrypts exact original identity privately');
    assertPrivate(result, [encrypted]);
    const shown = presentBmwVinGuide(result, { paint: 'Independent scenario blue' });
    assert.match(shown.guide.disclaimer, /may not be fitted/); assert.equal(shown.currentCarFacts.paint, 'Independent scenario blue');
    assert.equal(shown.guide.links[0].href, null); assert.equal(shown.guide.links[0].delivery, 'metadata-only');
    assert.equal(shown.completeness.handbook, 'partial'); assert.deepEqual(shown.equipment, result.equipment);
  }
  assert.equal(harness.calls.length, 4); assert.equal(harness.permitted.checks, 6);
  assert.ok(ciphertexts[0] !== ciphertexts[1]);
});

test('only source-offered UK English permits a second locale attempt with unchanged encrypted identity', async () => {
  const harness = providerHarness({ manual: (_call, locale) => {
    const body = manualBody(locale, locale === 'en-us' ? 'MANUAL_NOT_AVAILABLE' : 'OK');
    body.manualData.availableLocales = ['fr-fr', 'en-gb']; return response(body);
  } });
  const result = await harness.adapter.resolve({ ...request, locale: 'en-US' }, harness.permitted.context);
  assert.equal(result.status, 'partial'); assert.equal(result.locale, 'en-US');
  assert.equal(result.requestedLocale, 'en-US'); assert.equal(result.resolvedLocale, 'en-GB');
  assert.equal(harness.calls.length, 3); assert.equal(harness.permitted.checks, 4);
  const first = new URL(harness.calls[1].url); const second = new URL(harness.calls[2].url);
  assert.ok(first.searchParams.get('encryptedVin') === second.searchParams.get('encryptedVin'));
  assert.equal(first.searchParams.get('locale'), 'en-us'); assert.equal(second.searchParams.get('locale'), 'en-gb');
  for (const offered of [undefined, [], ['de-de'], ['en-GB'], ['en-gb?private']]) {
    const limited = providerHarness({ manual: (_call, locale) => {
      const body = manualBody(locale, 'MANUAL_NOT_AVAILABLE'); body.manualData.availableLocales = offered; return response(body);
    } });
    assert.equal((await limited.adapter.resolve({ ...request, locale: 'en-US' }, limited.permitted.context)).status, 'no-guide');
    assert.equal(limited.calls.length, 2);
  }
  const bounded = providerHarness({ manual: (_call, locale) => {
    const body = manualBody(locale, 'UNSUPPORTED_LOCALE'); body.manualData.availableLocales = ['en-gb']; return response(body);
  } });
  const exhausted = await bounded.adapter.resolve({ ...request, locale: 'en-US' }, bounded.permitted.context);
  assert.equal(exhausted.status, 'unsupported-locale'); assert.equal(exhausted.resolvedLocale, 'en-GB'); assert.equal(bounded.calls.length, 3);
  const shown = presentBmwVinGuide(exhausted);
  assert.equal(shown.requestedLocale, 'en-US'); assert.equal(shown.resolvedLocale, 'en-GB');
  assert.match(shown.message, /equipment remains unknown/);
  const denied = providerHarness({ authority: providerAuthority({ allow: ({ locale }) => locale !== 'en-GB' }), manual: (_call, locale) => {
    const body = manualBody(locale, 'MANUAL_NOT_AVAILABLE'); body.manualData.availableLocales = ['en-gb']; return response(body);
  } });
  assert.equal((await denied.adapter.resolve({ ...request, locale: 'en-US' }, denied.permitted.context)).failureDetail, 'identity-denied');
  assert.equal(denied.calls.length, 2);
});

test('manual HTTP, application, schema, identity and locale outcomes stay distinct and safe', async () => {
  const otherInput = await corpusInput({ count: 2 }); const otherVin = otherInput.allocationInventory.records[1].vin17;
  const cases = [
    [() => response(manualBody('en-gb', 'MANUAL_NOT_AVAILABLE')), 'no-guide', null],
    [() => response(manualBody('en-gb', 'VEHICLE_NOT_FOUND')), 'no-match', null],
    [() => response(manualBody('en-gb', 'UNSUPPORTED_LOCALE')), 'unsupported-locale', null],
    [() => response(manualBody('en-gb', 'SERVICE_UNAVAILABLE')), 'source-unavailable', 'source-unavailable'],
    [() => response(manualBody('en-gb', 422)), 'source-unavailable', 'application-error'],
    [() => response(manualBody('en-gb', 'UNRECOGNISED')), 'source-unavailable', 'application-error'],
    [() => response(manualBody(), 422), 'source-unavailable', 'http-error'],
    [() => response(manualBody(), 503), 'source-unavailable', 'http-error'],
    [() => ({ ...response(manualBody()), redirected: true }), 'source-unavailable', 'http-error'],
    [() => ({ ...response(manualBody()), url: 'https://private.invalid/?private#private' }), 'source-unavailable', 'http-error'],
    [() => ({ status: 200, body: '<html>private</html>' }), 'source-unavailable', 'invalid-source'],
    [() => response({ ...manualBody(), interfaceVersion: '5.0' }), 'partial', null],
    [() => response({ status: 'OK' }), 'source-unavailable', 'invalid-source'],
    [() => response({ interfaceVersion: '4.0', status: 'OK' }), 'source-unavailable', 'invalid-source'],
    [() => response(manualBody('de-de')), 'source-unavailable', 'locale-mismatch'],
    [() => { const body = manualBody(); body.manualData.vin = otherVin; return response(body); }, 'source-unavailable', 'identity-mismatch'],
    [() => ({ status: 200, body: ' '.repeat(262145) }), 'source-unavailable', 'response-too-large'],
    [() => { throw new Error(`private ${vin} ${otherVin} https://private.invalid/?${vin}#${vin}`); }, 'source-unavailable', 'transport-error'],
  ];
  for (const [manual, status, detail] of cases) {
    const harness = providerHarness({ manual }); const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, status); assert.equal(result.failureDetail, detail); assert.equal(harness.calls.length, 2);
    assertPrivate(result, [otherVin, otherVin.slice(-7)]);
  }
});

test('invalid key metadata, algorithms, decoded key types, sizes and HTTP never enter manual or custom encrypt', async () => {
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey;
  const small = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
  const large = generateKeyPairSync('rsa', { modulusLength: 4352 }).publicKey;
  const pss = generateKeyPairSync('rsa-pss', { modulusLength: 2048 }).publicKey;
  const cases = [
    () => response({ ...keyBody(), status: 422 }),
    () => response({ interfaceVersion: '4.0', status: 'OK' }),
    () => response({ ...keyBody(), publicKeyData: { ...keyBody().publicKeyData, algorithm: 'RSA-OAEP' } }),
    () => response({ ...keyBody(), publicKeyData: { algorithm: 'RSA', pem: 'bad base64' } }),
    () => response({ ...keyBody(), publicKeyData: { algorithm: 'RSA', pem: Buffer.from('not DER').toString('base64') } }),
    () => response(keyBody(ec)), () => response(keyBody(small)), () => response(keyBody(large)), () => response(keyBody(pss)),
    () => response({ ...keyBody(), publicKeyData: { algorithm: 'RSA',
      pem: Buffer.concat([rsaKeys[0].publicKey.export({ format: 'der', type: 'spki' }), Buffer.from([0])]).toString('base64') } }),
    () => response(keyBody(), 302), () => response(keyBody(), 503),
    () => ({ status: 200, body: ' '.repeat(16385) }),
  ];
  for (const key of cases) {
    let encrypted = 0;
    const harness = providerHarness({ key, keyHandling: { encrypt: () => { encrypted += 1; return Buffer.alloc(256); } } });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, 'source-unavailable'); assert.equal(harness.calls.length, 1); assert.equal(encrypted, 0); assertPrivate(result);
  }
  for (const encrypt of [() => Buffer.alloc(0), () => { throw new Error(vin); }]) {
    const harness = providerHarness({ keyHandling: { encrypt } });
    assert.equal((await harness.adapter.resolve(request, harness.permitted.context)).failureDetail, 'invalid-source');
    assert.equal(harness.calls.length, 1);
  }
  assert.throws(() => createBmwDriversGuideAdapter({ timeoutMs: 30001 }), /bounded/);
  const custom = providerHarness({ keyHandling: { encrypt: (key, bytes) => publicEncrypt({ key, padding: cryptoConstants.RSA_PKCS1_PADDING }, bytes) } });
  assert.equal((await custom.adapter.resolve(request, custom.permitted.context)).status, 'partial');
});

test('timeouts abort key/manual and prevent late fallback even when injected transport ignores cancellation', async () => {
  for (const at of ['key', 'manual']) {
    const pending = () => new Promise(() => {});
    const harness = providerHarness({ [at]: pending, timeoutMs: 20 });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.failureDetail, 'timeout'); assert.equal(harness.calls.length, at === 'key' ? 1 : 2);
    assert.ok(harness.calls.every((call) => call.signal.aborted)); assertPrivate(result);
  }
  let release;
  const harness = providerHarness({ timeoutMs: 20, manual: (_call, locale) => new Promise((done) => { release = () => {
    const body = manualBody(locale, 'MANUAL_NOT_AVAILABLE'); body.manualData.availableLocales = ['en-gb']; done(response(body));
  }; }) });
  const result = await harness.adapter.resolve({ ...request, locale: 'en-US' }, harness.permitted.context);
  release(); await new Promise((done) => setImmediate(done));
  assert.equal(result.failureDetail, 'timeout'); assert.equal(harness.calls.length, 2);
});

test('hostile source content and exceptions never emit identifiers, URL queries, raw errors or inferred equipment', async (t) => {
  const emitted = [];
  for (const name of ['log', 'error', 'warn', 'info', 'debug', 'trace']) {
    const previous = console[name]; console[name] = (...args) => emitted.push(args);
    t.after(() => { console[name] = previous; });
  }
  const otherInput = await corpusInput({ count: 2 }); const returnedVin = otherInput.allocationInventory.records[1].vin17;
  const harness = providerHarness({ manual: (call, locale) => {
    const encrypted = new URL(call.url).searchParams.get('encryptedVin');
    const body = manualBody(locale); body.manualData.vin = vin;
    body.manualData.privateIdentifier = returnedVin;
    body.manualData.id = `private-${returnedVin.slice(1, 9)}`;
    body.manualData.carName = `Private ${vin.slice(3, 10)}`;
    body.manualData.derivative = returnedVin.slice(-7);
    body.manualData.brand = encrypted.slice(0, 12);
    body.manualData.sections.push({ title: `Private ${returnedVin.slice(2, 8)}` });
    body.manualData.links.push({ label: `https://private.invalid/?${encrypted}#${returnedVin}`, format: 'pdf', availability: 'available' });
    body.manualData.handbookDisclaimer += ` https://private.invalid/?${vin}#${returnedVin}`;
    body.manualData.installedEquipment = ['fabricated-equipment']; body.manualData.paint = 'fabricated-paint';
    return response(body);
  } });
  const result = await harness.adapter.resolve(request, harness.permitted.context);
  assert.equal(result.status, 'partial'); assert.equal(result.guide.title, null); assert.equal(result.guide.derivative, null);
  assert.equal(result.guide.brand, null); assert.equal(result.guide.disclaimer, null);
  assert.equal(result.guide.sections.length, 1); assert.equal(result.guide.links.length, 1);
  assertPrivate(result, [returnedVin, returnedVin.slice(-7), 'fabricated-equipment', 'fabricated-paint']);
  assert.equal(emitted.length, 0);
  for (const operation of ['key', 'manual']) {
    const hostile = providerHarness({ [operation]: () => { throw new Error(`private ${vin} ${returnedVin} https://private.invalid/?${vin}#private`); } });
    const failed = await hostile.adapter.resolve(request, hostile.permitted.context);
    assert.equal(failed.failureDetail, 'transport-error'); assertPrivate(failed, [returnedVin]);
  }
  assert.equal(emitted.length, 0);
});


test('locale alternative rejects changed model or brand and permits matching or unknown identity metadata', async () => {
  for (const replacement of [{ derivative: 'G21', brand: 'BMW' }, { derivative: 'F30', brand: 'MINI' },
    { derivative: 'F30', brand: 'BMW' }, { derivative: null, brand: null }]) {
    const harness = providerHarness({ manual: (_call, locale) => {
      const body = manualBody(locale, locale === 'en-us' ? 'MANUAL_NOT_AVAILABLE' : 'OK');
      Object.assign(body.manualData, locale === 'en-us' ? { derivative: 'F30', brand: 'BMW' } : replacement);
      body.manualData.availableLocales = ['en-gb']; return response(body);
    } });
    const result = await harness.adapter.resolve({ ...request, locale: 'en-US' }, harness.permitted.context);
    const mismatch = replacement.derivative === 'G21' || replacement.brand === 'MINI';
    assert.equal(result.status, mismatch ? 'source-unavailable' : 'partial');
    assert.equal(result.failureDetail, mismatch ? 'identity-mismatch' : null);
    assert.equal(harness.calls.length, 3); assertPrivate(result);
    if (replacement.derivative === null) assert.equal(result.guide.derivative, null);
  }
});

test('hostile thrown objects cannot expose error getters or forge internal diagnostics', async () => {
  let getterCalls = 0;
  const hostile = Object.defineProperty({}, 'detail', { get() { getterCalls += 1; throw new Error(vin); } });
  for (const thrown of [hostile, { detail: 'identity-denied', message: vin }, vin, null]) {
    const harness = providerHarness({ key: () => { throw thrown; } });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.failureDetail, 'transport-error'); assertPrivate(result);
  }
  assert.equal(getterCalls, 0);
});


test('default parser accepts known root metadata and root RSA declaration without invented interface or key status fields', async () => {
  for (const returnedLocale of ['en-gb', undefined]) {
    const harness = providerHarness({ useDefaultDecoder: true, key: () => {
      const body = keyBody(); delete body.interfaceVersion; delete body.status; delete body.publicKeyData.algorithm;
      body.algorithm = 'RSA'; body.interfaceMetadata = { unverified: 'ignored' }; return response(body);
    }, manual: () => {
      const body = { status: 'OK', ...manualBody().manualData, interfaceVersion: 'unverified-value' };
      if (returnedLocale === undefined) delete body.locale; return response(body);
    } });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, 'partial'); assert.equal(result.guide.title, 'Fictional handbook');
    assert.equal(result.resolvedLocale, returnedLocale ? 'en-GB' : null); assert.equal(result.requestedLocale, 'en-GB');
    assert.equal(result.source.kind, 'authorised-live'); assertPrivate(result);
  }
  for (const algorithms of [{ algorithm: 'RSA-OAEP' }, { algorithm: null }, { algorithm: 'RSA', nested: 'RSA-PSS' },
    { algorithm: 'RSA', nested: {} }, {}]) {
    const harness = providerHarness({ key: () => {
      const body = keyBody(); delete body.publicKeyData.algorithm; delete body.status;
      if (Object.hasOwn(algorithms, 'algorithm')) body.algorithm = algorithms.algorithm;
      if (Object.hasOwn(algorithms, 'nested')) body.publicKeyData.algorithm = algorithms.nested;
      return response(body);
    } });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.failureDetail, 'invalid-source'); assert.equal(harness.calls.length, 1); assertPrivate(result);
  }
});

test('default negative application states need no invented manual container or returned locale', async () => {
  for (const [status, expected] of [['MANUAL_NOT_AVAILABLE', 'no-guide'], ['UNSUPPORTED_LOCALE', 'unsupported-locale'],
    ['VEHICLE_NOT_FOUND', 'no-match'], ['SERVICE_UNAVAILABLE', 'source-unavailable']]) {
    const harness = providerHarness({ useDefaultDecoder: true, manual: () => response({ status }) });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, expected); assert.equal(result.resolvedLocale, null); assert.equal(harness.calls.length, 2); assertPrivate(result);
  }
  const fallback = providerHarness({ useDefaultDecoder: true, manual: (_call, locale) => response(locale === 'en-us'
    ? { status: 'MANUAL_NOT_AVAILABLE', derivative: 'F30', brand: 'BMW', availableLocales: ['en-gb'] }
    : { status: 'OK', derivative: 'F30', brand: 'BMW', carName: 'Fictional handbook' }) });
  const result = await fallback.adapter.resolve({ ...request, locale: 'en-US' }, fallback.permitted.context);
  assert.equal(result.status, 'partial'); assert.equal(result.resolvedLocale, null); assert.equal(result.requestedLocale, 'en-US');
  assert.equal(fallback.calls.length, 3); assert.equal(fallback.permitted.checks, 4); assertPrivate(result);
});

test('default OK requires recognized metadata and raw application validation precedes any manual decoder', async () => {
  for (const body of [{ status: 'OK' }, { status: 'OK', unknownContainer: { carName: 'Fictional handbook' } },
    manualBody(), { carName: 'Fictional handbook' }]) {
    const harness = providerHarness({ useDefaultDecoder: true, manual: () => response(body) });
    assert.equal((await harness.adapter.resolve(request, harness.permitted.context)).failureDetail, 'invalid-source');
  }
  const unknown = providerHarness({ useDefaultDecoder: true, manual: () => response({ status: 'OK', carName: null, sections: false, links: {} }) });
  const partial = await unknown.adapter.resolve(request, unknown.permitted.context);
  assert.equal(partial.status, 'partial'); assert.equal(partial.guide.title, null); assert.equal(partial.completeness.title, 'unknown');
  assert.equal(partial.guide.sections.length, 0); assert.equal(partial.completeness.sections, 'unknown');
  for (const [body, httpStatus, expected] of [[{ status: 422 }, 200, 'application-error'],
    [{ status: 'UNKNOWN' }, 200, 'application-error'], [{ status: 'OK' }, 503, 'http-error']]) {
    let decoderCalls = 0;
    const harness = providerHarness({ manual: () => response(body, httpStatus), decodeManual: () => {
      decoderCalls += 1; return { status: 'OK', ...manualBody().manualData };
    } });
    const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.failureDetail, expected); assert.equal(decoderCalls, 0); assertPrivate(result);
  }
});

test('explicit provisional decoder failures and returned identifiers remain bounded and private', async () => {
  const otherInput = await corpusInput({ count: 2 }); const otherVin = otherInput.allocationInventory.records[1].vin17;
  for (const decodeManual of [() => { throw new Error(`private ${vin} https://private.invalid/?${otherVin}#private`); },
    () => null, () => [], () => 'unsupported', () => ({}), () => ({ carName: 'x'.repeat(262145) })]) {
    const harness = providerHarness({ decodeManual }); const result = await harness.adapter.resolve(request, harness.permitted.context);
    assert.equal(result.status, 'source-unavailable'); assert.ok(['invalid-source', 'response-too-large'].includes(result.failureDetail));
    assertPrivate(result, [otherVin]);
  }
  const mismatch = providerHarness({ decodeManual: () => ({ ...manualBody().manualData, vin: otherVin }) });
  const denied = await mismatch.adapter.resolve(request, mismatch.permitted.context);
  assert.equal(denied.failureDetail, 'identity-mismatch'); assertPrivate(denied, [otherVin]);
  let decoded = 0;
  const rawMismatch = providerHarness({ manual: () => response({ status: 'OK', vin: otherVin }), decodeManual: () => {
    decoded += 1; return manualBody().manualData;
  } });
  assert.equal((await rawMismatch.adapter.resolve(request, rawMismatch.permitted.context)).failureDetail, 'identity-mismatch');
  assert.equal(decoded, 0);
  const privateMetadata = providerHarness({ decodeManual: () => ({ ...manualBody().manualData,
    privateIdentifier: otherVin, carName: `Private ${otherVin.slice(-7)}` }) });
  const safe = await privateMetadata.adapter.resolve(request, privateMetadata.permitted.context);
  assert.equal(safe.status, 'partial'); assert.equal(safe.guide.title, null); assertPrivate(safe, [otherVin, otherVin.slice(-7)]);
});

test('nested returned identifier containers cannot leak their values through handbook metadata', async () => {
  const opaque = [...randomBytes(8)].map((byte) => `i${byte.toString(16).padStart(2, '0')}`).join('');
  const harness = providerHarness({ manual: (_call, locale) => {
    const body = manualBody(locale);
    body.manualData.privateIdentifier = { nested: [{ value: opaque }] };
    body.manualData.carName = `Private ${opaque}`;
    return response(body);
  } });
  const result = await harness.adapter.resolve(request, harness.permitted.context);
  assert.equal(result.status, 'partial'); assert.equal(result.guide.title, null); assertPrivate(result, [opaque]);
});
