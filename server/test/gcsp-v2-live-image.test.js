/** Exact v2 accepted identity and pinned manifest variant; all transport is synthetic. */
import test from 'node:test'; import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inputDigest } from '../gcsp/repository/core.js';
import { createBmwLiveImageryProvider, bmwLiveImageLookupIdentity, presentBmwLiveImage } from '../vehicle-evidence/bmw-live-imagery.js';
const plan = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/observation-plan.json', import.meta.url)));
const r = plan.registration; const pointer = '/stage-fullscreen-views-legacy-newnames/desktop/namedImages/0/images/0';
const assetUrl = 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?opaque=fixture-never-retain';
const bytes = await readFile(new URL('../vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp', import.meta.url));
const request = () => ({ configurationId: r.configurationId, bindingDigest: r.bindingDigest, viewport: 'desktop', viewpoint: 'HEROFRONT',
  size: { width: 2560, height: 1646 }, variantPointer: pointer });
function setup(mutate = () => {}, override = {}) {
  const calls = []; const manifest = { 'stage-fullscreen-views-legacy-newnames': { desktop: { metaData: { width: 2560, height: 1646 },
    namedImages: [{ name: 'ActualGroup', images: [{ viewImage: assetUrl, distinctionParameters: { POV: 'HEROFRONT', X: '1720', Y: '500', BKGND: 'sand' } }] }] } } };
  mutate(manifest); const provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator',
    sourceRegistration: r, clock: () => new Date('2026-11-07T04:00:00Z'), getCredential: async () => 'fixture-v2-key',
    transport: async (input) => { calls.push(input); return { status: 200, contentType: input.url === assetUrl ? 'image/webp' : 'application/json',
      body: input.url === assetUrl ? bytes : JSON.stringify(manifest) }; },
    resolveConfiguration: async () => ({ basis: 'independent-source-proof', identity: { configurationId: r.configurationId, bindingDigest: r.bindingDigest },
      registrationDigest: inputDigest(r), acceptedLineSha256: r.sourceAcceptedSha256, observedDate: '2026-11-07', fidelity: {} }), ...override });
  return { calls, provider };
}
test('v2 imagery needs no fabricated trim/build fields and retains actual unique group/distinctions without URLs', async () => {
  const lookup = bmwLiveImageLookupIdentity(request(), r); assert.ok(lookup); assert.equal(lookup.providerVersion, '2');
  assert.equal(lookup.requestRegistration.model.effectDate, '2027-01-05'); assert.equal(lookup.productionDate, undefined);
  const f = setup(); const result = await f.provider.resolve(request()); assert.equal(result.status, 'ok'); assert.equal(f.calls.length, 2);
  assert.equal(new URL(f.calls[0].url).searchParams.get('options'), r.factoryOptionCodes.join(','));
  assert.equal(result.image.namedImage, 'ActualGroup'); assert.equal(result.selectedVariant.distinctions.X, '1720');
  assert.equal(result.selectedVariant.pointer, pointer); assert.equal(result.image.fidelity.model, 'unknown');
  assert.equal(JSON.stringify(result).includes('fixture-never-retain'), false); assert.equal(JSON.stringify(result).includes('fixture-v2-key'), false);
  assert.equal(presentBmwLiveImage(result).status, 'ok'); const read = await f.provider.readAsset(result.image.assetId); assert.deepEqual(read.bytes, bytes);
});
test('v2 wrong binding/pointer and changed/ambiguous manifest or unproved source refuse without asset fallback', async () => {
  assert.equal(bmwLiveImageLookupIdentity({ ...request(), bindingDigest: '0'.repeat(64) }, r), null);
  assert.equal(bmwLiveImageLookupIdentity({ ...request(), variantPointer: pointer.replace('/0', '/1') }, r), null);
  for (const mutate of [(m) => { m['stage-fullscreen-views-legacy-newnames'].desktop.namedImages[0].images[0].distinctionParameters.POV = 'HEROREAR'; },
    (m) => { const a = m['stage-fullscreen-views-legacy-newnames'].desktop.namedImages[0].images; a.push(structuredClone(a[0])); },
    (m) => { m['stage-fullscreen-views-legacy-newnames'].desktop.namedImages[0].images[0].distinctionParameters.W = '600'; },
    (m) => { m['stage-fullscreen-views-legacy-newnames'].desktop.metaData.width = 1280; }]) {
    const f = setup(mutate); assert.notEqual((await f.provider.resolve(request())).status, 'ok'); assert.equal(f.calls.length, 1);
  }
  const f = setup(() => {}, { resolveConfiguration: async () => ({ basis: 'independent-source-proof', identity: { configurationId: r.configurationId, bindingDigest: r.bindingDigest },
    registrationDigest: '0'.repeat(64), acceptedLineSha256: r.sourceAcceptedSha256, observedDate: '2026-11-07' }) });
  assert.notEqual((await f.provider.resolve(request())).status, 'ok'); assert.equal(f.calls.length, 1);
});

test('existing bounded imagery transport owns the exact four-operation sequence, durable counts and byte/privacy ceilings', async () => {
  const { createBoundedTransport } = await import('../../scripts/gcsp/verify-live-imagery.mjs');
  const { bmwEnrichmentObservationRequestUrls } = await import('../../scripts/gcsp/bmw-public-registration.mjs');
  const urls = bmwEnrichmentObservationRequestUrls(r); const progress = []; let calls = 0;
  const transport = createBoundedTransport({ sourceRegistration: r, onProgress: async (state) => { progress.push(structuredClone(state)); },
    fetchImpl: async (url) => { calls += 1; assert.equal(progress.at(-1).requestCount, calls);
      return new Response(url === urls.page ? 'settings.fixture.json' : url === assetUrl ? bytes : '{}', { headers: { 'content-type': url === urls.page ? 'text/html' : url === assetUrl ? 'image/webp' : 'application/json' } }); } });
  const get = (url, maxResponseBytes = 1048576) => transport.get({ method: 'GET', url, headers: {}, maxResponseBytes, credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0 });
  await get(urls.page); await get('https://configure.bmw.co.uk/en_GB/settings.fixture.json'); await get(urls['image-manifest']); await get(assetUrl, 2097152);
  assert.equal(transport.state().requestCount, 4); assert.equal(transport.state().imageCount, 1);
  assert.equal(JSON.stringify(progress).includes('fixture-never-retain'), false); assert.equal(transport.state().requests[3].responseSha256.length, 64);
  await assert.rejects(get(assetUrl)); assert.equal(calls, 4);
  const wrong = createBoundedTransport({ sourceRegistration: r, fetchImpl: async () => assert.fail('changed request must not fetch') });
  await assert.rejects(wrong.get({ method: 'GET', url: urls['image-manifest'], headers: {}, maxResponseBytes: 1048576,
    credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0 }));
});

test('existing pure v2 enrichment uses the accepted catalogue and captured representative image without mutating it', async () => {
  const { enrichConfiguration } = await import('../../scripts/gcsp/enrich-fleet.mjs');
  const accepted = JSON.parse((await readFile(new URL('../../docs/gcsp/evidence/fucq59/f70-1f7e-first32-solver-2026-11-07/accepted.jsonl', import.meta.url), 'utf8')).split('\n')[0]);
  const original = inputDigest(accepted); const f = setup(); const image = await f.provider.resolve(request());
  const catalogueOptions = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, accepted.lookupIdentity[k]]));
  const input = { configurationId: r.configurationId, request: { ...accepted.catalogueRequest, viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 } },
    catalogue: accepted.catalogue, catalogueOptions, image, retention: { status: 'allowed', decision: 'f60-authorized-retention' }, asOf: '2026-11-07' };
  const out = enrichConfiguration(input); assert.equal(out.sources.image.outcome, 'ok'); assert.ok(out.image);
  assert.equal(out.image.modelCode, '1F7E'); assert.equal(out.image.fidelity.model, 'unknown'); assert.equal(out.image.selectedVariant.namedImage, 'ActualGroup');
  assert.equal(out.completeness.image, 'partial'); assert.equal(inputDigest(accepted), original);
  const bad = structuredClone(image); bad.lookupIdentity.requestRegistration.model.agModelCode = '72HH';
  assert.equal(enrichConfiguration({ ...input, image: bad }).image, null);
  assert.equal(enrichConfiguration({ ...input, retention: null }).image, null);
  for (const mutate of [(x) => { x.requestedIdentity.configurationId = 'OTHER'; x.resolvedIdentity.configurationId = 'OTHER'; },
    (x) => { x.selectedVariant.distinctions.X = 'https://secret.invalid'; }, (x) => { x.providerVersion = '1'; },
    (x) => { x.identityProvenance.extra = 'unrelated-source-value'; }, (x) => { x.image.namedImage = 'Other'; }]) {
    const changed = structuredClone(image); mutate(changed); assert.equal(enrichConfiguration({ ...input, image: changed }).image, null);
  }
});

test('prepared runner refuses absent release; isolated complete fixture persists tuple before one asset and emits existing enrichment output', async (t) => {
  const { mkdtemp, mkdir, rm, symlink, writeFile, copyFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join, dirname } = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const actualRoot = fileURLToPath(new URL('../../', import.meta.url)); const relative = 'docs/gcsp/evidence/fucq60/v2-image-capture-2026-11-07';
  const actualBase = join(actualRoot, relative);
  const retainedNames = ['execution-once.json', 'image-checkpoint.json', 'captured.webp'];
  const before = await Promise.all(retainedNames.map(async (name) => { try { return await readFile(join(actualBase, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } }));
  await assert.rejects(promisify(execFile)(process.execPath, [join(actualBase, 'run-live.mjs')], { env: { PATH: process.env.PATH }, timeout: 10000 }),
    (error) => error.stderr.includes('explicit-root-traffic-grant-required'));
  for (const [index, name] of retainedNames.entries()) {
    if (before[index] === null) await assert.rejects(readFile(join(actualBase, name)), { code: 'ENOENT' });
    else assert.deepEqual(await readFile(join(actualBase, name)), before[index]);
  }
  const root = await mkdtemp(join(tmpdir(), 'f60-capture-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['scripts', 'server', '_tools']) await symlink(join(actualRoot, name), join(root, name), 'dir');
  const allocation = JSON.parse(await readFile(join(actualBase, 'execution-plan.json'))); const base = join(root, relative);
  // The retained plan pins 7 Nov code; the fixture run exercises the runner flow against current code (FUCQ-230).
  const { createHash } = await import('node:crypto');
  for (const k of Object.keys(allocation.codePins).filter((p) => !p.startsWith('docs/'))) allocation.codePins[k] = createHash('sha256').update(await readFile(join(actualRoot, k))).digest('hex');
  const copied = [...Object.keys(allocation.codePins).filter((p) => p.startsWith('docs/')), allocation.acceptedSource.path, allocation.technical.path];
  for (const p of copied) { await mkdir(dirname(join(root, p)), { recursive: true }); await copyFile(join(actualRoot, p), join(root, p)); }
  allocation.primary = join(base, 'image-checkpoint.json'); await writeFile(join(base, 'execution-plan.json'), JSON.stringify(allocation));
  const loader = join(root, 'fixture.mjs');
  await writeFile(loader, `import { readFile } from 'node:fs/promises';\nconst bytes=await readFile(${JSON.stringify(join(actualRoot, 'server/vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp'))});\nlet calls=0;globalThis.fetch=async(url)=>{calls+=1;if(calls>4)throw new Error('extra-call');if(url.includes('/configure/'))return new Response('settings.fixture.json',{headers:{'content-type':'text/html'}});if(url.includes('/settings.'))return Response.json({APP:{backend:{settingsCosy:{baseUrl:'https://prod.cosy.bmw.cloud','x-api-key':'ephemeral-fixture-secret'}}}});if(url.includes('/image-urls/'))return Response.json({'stage-fullscreen-views-legacy-newnames':{desktop:{metaData:{width:2560,height:1646},namedImages:[{name:'FixtureActualGroup',images:[{viewImage:${JSON.stringify(assetUrl)},distinctionParameters:{POV:'HEROFRONT',X:'1720',Y:'500',BKGND:'sand'}}]}]}}});if(url===${JSON.stringify(assetUrl)}){const primary=JSON.parse(await readFile(${JSON.stringify(join(base, 'image-checkpoint.json'))}));if(primary.selectedVariant?.namedImage!=='FixtureActualGroup')throw new Error('variant-not-retained-before-asset');return new Response(bytes,{headers:{'content-type':'image/webp'}});}throw new Error('unallocated-url');};`);
  // The retained runner only runs on its plan's qualification day (FUCQ-230); pin the child's clock to it.
  const datePin = (day) => `const Real = Date; const offset = Real.parse('${day}T12:00:00.000Z') - Real.now();\n`
    + `globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + offset])); } static now() { return Real.now() + offset; } };\n`;
  const day = JSON.parse(await readFile(join(actualBase, 'image-plan.json'))).qualificationDate;
  const datePinPath = join(root, 'date-pin.mjs'); await writeFile(datePinPath, datePin(day));
  const env = { PATH: process.env.PATH, F60_V2_IMAGE_SOURCE_GRANT: allocation.id };
  await promisify(execFile)(process.execPath, ['--import', datePinPath, '--import', loader, join(base, 'run-live.mjs')], { env, timeout: 20000 });
  const receipt = JSON.parse(await readFile(join(base, 'receipt.json'))); assert.equal(receipt.status, 'captured');
  assert.equal(receipt.ledger.requestCount, 4); assert.equal(receipt.ledger.imageCount, 1); assert.equal(receipt.opaqueAssetUrlRetained, false);
  const out = JSON.parse(await readFile(join(base, 'enrichment.json'))); assert.equal(out.records[0].facts.seats.value, 5); assert.ok(out.records[0].image);
  assert.equal(out.records[0].image.fidelity.model, 'unknown'); assert.equal(out.records[0].facts.bodyLength.state, 'unknown');
  for (const name of ['receipt.json', 'image-checkpoint.json', 'image.json', 'enrichment.json']) {
    const retained = await readFile(join(base, name), 'utf8'); assert.equal(retained.includes('fixture-never-retain'), false); assert.equal(retained.includes('ephemeral-fixture-secret'), false);
  }
  await assert.rejects(promisify(execFile)(process.execPath, ['--import', datePinPath, '--import', loader, join(base, 'run-live.mjs')], { env, timeout: 10000 }),
    (error) => error.stderr.includes('existing-output-preserved'));
  allocation.planDigest = '0'.repeat(64); await writeFile(join(base, 'execution-plan.json'), JSON.stringify(allocation));
  await assert.rejects(promisify(execFile)(process.execPath, ['--import', datePinPath, '--import', loader, join(base, 'run-live.mjs')], { env, timeout: 10000 }),
    (error) => error.stderr.includes('source-plan-date-mismatch'));
});
