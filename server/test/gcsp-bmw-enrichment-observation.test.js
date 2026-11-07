/** Synthetic HTTP protocol checks only; no actual source or enrichment qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEnrichmentObserver } from '../../scripts/gcsp/enrichment-observation.mjs';
import * as source from '../../scripts/gcsp/public-bmw-source.mjs';
import * as registration from '../../scripts/gcsp/bmw-public-registration.mjs';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';
import { inputDigest } from '../gcsp/repository/core.js';

const approved = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq60/actual-v2-enrichment-next-plan-2026-11-07.json', import.meta.url)));
function plan() {
  const p = approved.pilot; const c = p.confirmedContext;
  return { schemaVersion: 'bmw-enrichment-observation-plan.v1', planId: 'f60-exact-v2-shape-fixture', qualificationDate: '2026-11-07',
    source: { id: 'bmw-uk-public', version: 'f60-enrichment-observation-20261107.v1', kind: 'public-bmw-uk' },
    registration: { schemaVersion: 'bmw-public-enrichment-observation-registration.v1', configurationId: p.configurationId,
      bindingDigest: p.catalogueRequest.bindingDigest, sourceAcceptedSha256: p.lineSha256,
      model: { schemaVersion: 'bmw-public-model-registration.v1', modelCode: '1F7E', agModelCode: '82GE', catalogueRangeKey: 'F70',
        rawModelRange: 'F70', aliases: ['1'], market: 'GB', locale: 'en-GB', steering: 'RL', catalogueDate: '2026-11-01',
        orderDate: c.orderDate.value, effectDate: c.effectDate.value }, factoryOptionCodes: p.canonicalIdentity.factoryOptionCodes,
      accessories: [], paintCode: p.paint.value.code, upholsteryCode: p.upholstery.value.code },
    limits: { maxAttempts: 1, retryDelayMs: 0, concurrency: 1, imageRequests: 0, sourceAttempts: 4, sourceBytes: 4194304,
      responseBytes: 1048576, operationTimeoutMs: 10000, deadlineMs: 90000, checkpointBytes: 4194304,
      cacheEntries: 8, cacheRetentionMs: 86400000, requestBudgets: { page: 1, settings: 1, technical: 1, 'image-manifest': 1 } } };
}
async function setup(t, mutate = () => {}, hooks = {}) {
  assert.equal(typeof source.publicBmwEnrichmentObservationOperations, 'function');
  const root = await mkdtemp(join(tmpdir(), 'f60-observation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const p = plan(); const calls = []; const secret = 'ephemeral-f60-fixture-key';
  const data = { settings: { APP: { backend: { settingsOtd: { 'x-api-key': secret },
    settingsCosy: { baseUrl: 'https://prod.cosy.bmw.cloud', 'x-api-key': secret } } } },
    technical: { businessKey: '120618215', status: 1, values: { N_SITZE: { referenceName: 'N_SITZE', targetValue: 5 },
      A_GEPR_V211: { referenceName: 'A_GEPR_V211', targetValue: '0000' } }, preConfigurationOptions: ['S0337'] },
    image: { desktop: { metaData: { width: 2560, height: 1646 }, namedImages: [{ name: 'Gallery', images: [
      { viewImage: 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?opaque=do-not-retain', distinctionParameters: { POV: 'HEROFRONT' } }] }] } } };
  mutate(data, p);
  const urls = registration.bmwEnrichmentObservationRequestUrls(p.registration);
  const fetch = async (url, options) => {
    calls.push({ url, headers: options.headers });
    if (hooks.fetch) return hooks.fetch(url, options, data, urls);
    if (url === urls.page) return new Response('settings.fixture.json', { headers: { 'content-type': 'text/html' } });
    if (url.includes('/settings.')) return Response.json(data.settings);
    if (url === urls.technical) return Response.json(data.technical);
    if (url === urls['image-manifest']) return Response.json(data.image);
    throw new Error('Unallocated source operation');
  };
  const operations = source.publicBmwEnrichmentObservationOperations(p);
  if (hooks.operations) hooks.operations(operations, urls);
  const statePath = join(root, 'primary.json');
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(p), stage: 'f60-source-observation', version: '1' },
    operations, limits: p.limits, statePath, http: { kind: 'fixture', fetch }, now: () => Date.parse('2026-11-07T05:00:00Z'),
    onPhase: hooks.onPhase });
  const run = () => session.withCheckpoint(async ({ state, execute }) => {
    const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
    const technical = await execute('technical', {}); const image = await execute('image-manifest', {});
    return { technical, image, counts: structuredClone(state.counts) };
  });
  return { p, calls, secret, statePath, operations, session, run, urls, fetch }; 
}

test('four exact GETs observe technical/COSY shape without admitting facts, retaining keys/opaque URLs or downloading images', async (t) => {
  const f = await setup(t); const result = await f.run();
  assert.equal(f.calls.length, 4); assert.equal(result.counts.httpAttempts, 4);
  assert.equal(result.counts.sourceCalls, 0); assert.equal(result.technical.document.report.admission, false);
  assert.equal(result.technical.document.report.status, 'schema-review-required');
  assert.equal(result.technical.document.report.values.find((x) => x.code === 'N_SITZE').targetValue, 5);
  assert.equal(result.technical.document.report.values.find((x) => x.code === 'A_GEPR_V211').targetValue, '0000');
  assert.equal(result.image.document.report.views[0].viewpoint, 'HEROFRONT');
  assert.deepEqual(result.image.document.report.dimensions[0].value, { width: 2560, height: 1646 });
  const saved = await readFile(f.statePath, 'utf8'); assert.equal(saved.includes(f.secret), false);
  assert.equal(saved.includes('cosySec'), false); assert.equal(saved.includes('do-not-retain'), false);
  assert.ok(f.calls.slice(2).every((x) => x.headers['x-api-key'] === f.secret));
  assert.equal(result.technical.document.requestScope.role, 'request-input-only');
});

test('registration binds canonical selection/model/AG/date and rejects accessories or a changed canonical ID', async () => {
  assert.equal(typeof registration.validateBmwEnrichmentObservationRegistration, 'function');
  const p = plan(); const urls = registration.bmwEnrichmentObservationRequestUrls(p.registration);
  assert.equal(new URL(urls.technical).searchParams.get('included-options'), p.registration.factoryOptionCodes.join(','));
  assert.equal(new URL(urls['image-manifest']).searchParams.get('options'), p.registration.factoryOptionCodes.join(','));
  for (const mutate of [(r) => { r.configurationId += 'A'; }, (r) => { r.factoryOptionCodes.reverse(); },
    (r) => { r.accessories.push({ code: 'SE000001' }); }, (r) => { r.paintCode = 'P0300'; }]) {
    const r = structuredClone(p.registration); mutate(r);
    assert.throws(() => registration.validateBmwEnrichmentObservationRegistration(r));
  }
});

test('executor refuses URL/model/date/selection substitution before fetching the changed request', async (t) => {
  for (const field of ['model', 'date', 'selection', 'host']) {
    const f = await setup(t, () => {}, { operations(ops, urls) { ops.technical.prepare = async () => {
      const url = new URL(urls.technical);
      if (field === 'model') url.pathname = url.pathname.replace('82GE', '72HH');
      if (field === 'date') url.pathname = url.pathname.replace('2027-01-05', '2027-01-06');
      if (field === 'selection') url.searchParams.set('included-options', 'P0300');
      if (field === 'host') url.hostname = 'unregistered.invalid';
      return { method: 'GET', url: url.href, headers: {} };
    }; } });
    await assert.rejects(f.run(), { code: 'source-endpoint-refused' }); assert.equal(f.calls.length, 2);
  }
});

test('settings profile refusal and sensitive technical values stop without persisting credentials or image URLs', async (t) => {
  const missing = await setup(t, (d) => { delete d.settings.APP.backend.settingsCosy; });
  await assert.rejects(missing.run(), { code: 'settings-header-shape' }); assert.equal(missing.calls.length, 2);
  const leaked = await setup(t, (d) => { d.technical.values.N_SITZE.textValue = 'ephemeral-f60-fixture-key'; });
  await assert.rejects(leaked.run(), { code: 'source-sensitive-projection' }); assert.equal(leaked.calls.length, 3);
  assert.equal((await readFile(leaked.statePath, 'utf8')).includes(leaked.secret), false);
});

test('completed executor cache remains reusable and spent settings cannot repeat', async (t) => {
  const f = await setup(t); await f.run();
  await assert.rejects(f.run(), { code: 'request-budget' }); assert.equal(f.calls.length, 4);
  const resumed = await f.session.withCheckpoint(async ({ execute, state }) => ({
    technical: await execute('technical', {}), image: await execute('image-manifest', {}), counts: structuredClone(state.counts) }));
  assert.equal(resumed.counts.cacheHits.technical, 1); assert.equal(resumed.counts.httpAttempts, 4); assert.equal(f.calls.length, 4);
});

test('source context mismatch, wrong content type, redirects and duplicate JSON stop before the image operation', async (t) => {
  const mismatch = await setup(t, (d) => { d.technical.agModelCode = '72HH'; });
  await assert.rejects(mismatch.run(), { code: 'source-context-mismatch' }); assert.equal(mismatch.calls.length, 3);
  for (const response of [new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    new Response(null, { status: 302, headers: { location: 'https://unregistered.invalid' } }),
    new Response('{"status":1,"status":2}', { headers: { 'content-type': 'application/json' } })]) {
    const f = await setup(t, () => {}, { fetch(url, _options, d, urls) {
      if (url === urls.page) return new Response('settings.fixture.json', { headers: { 'content-type': 'text/html' } });
      if (url.includes('/settings.')) return Response.json(d.settings);
      return response;
    } });
    await assert.rejects(f.run()); assert.equal(f.calls.length, 3);
  }
});


test('production observer completes once and reopens without source calls; a failed image retains technical evidence', async (t) => {
  for (const failImage of [false, true]) {
    const f = await setup(t, () => {}, { fetch(url, _options, d, urls) {
      if (url === urls.page) return new Response('settings.fixture.json', { headers: { 'content-type': 'text/html' } });
      if (url.includes('/settings.')) return Response.json(d.settings);
      if (url === urls.technical) return Response.json(d.technical);
      return failImage ? new Response('{}', { status: 503 }) : Response.json(d.image);
    } });
    const create = () => createEnrichmentObserver({ plan: f.p, statePath: f.statePath, http: { kind: 'fixture', fetch: f.fetch }, now: () => Date.parse('2026-11-07T05:00:00Z') });
    const first = await (await create()).run(); assert.equal(first.status, failImage ? 'incomplete' : 'observed');
    assert.ok(first.observations.technical); assert.equal(first.admission, false); assert.equal(f.calls.length, 4);
    const second = await (await create()).run(); assert.deepEqual(second, first); assert.equal(f.calls.length, 4);
  }
});

test('interrupted bootstrap never obtains a second memory-only key', async (t) => {
  const f = await setup(t); let interrupt = true;
  const make = () => createEnrichmentObserver({ plan: f.p, statePath: f.statePath, http: { kind: 'fixture', fetch: f.fetch },
    now: () => Date.parse('2026-11-07T05:00:00Z'), onPhase: async (phase, detail) => { if (interrupt && phase === 'before-rename' && detail.kind === 'cache') throw new Error('synthetic-interruption'); } });
  await assert.rejects((await make()).run(), /synthetic-interruption/); interrupt = false;
  const resumed = await (await make()).run(); assert.equal(resumed.reason, 'observation-interrupted');
  assert.equal(resumed.counts.httpAttempts, 1); assert.equal(f.calls.length, 1);
});

test('prepared executable refuses absent grant before consuming marker or creating primary', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const base = new URL('../../docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/', import.meta.url);
  await assert.rejects(promisify(execFile)(process.execPath, [new URL('run-live.mjs', base).pathname],
    { env: { PATH: process.env.PATH }, timeout: 10000 }), (error) => /explicit-root-traffic-grant-required/.test(error.stderr));
  for (const name of ['execution-once.json', 'observer-checkpoint.json', 'source-events.jsonl']) await assert.rejects(readFile(new URL(name, base)), { code: 'ENOENT' });
});

test('prepared executable rejects changed plan/code hashes before any consumed marker or primary', async (t) => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { mkdir, symlink, writeFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const actualRoot = fileURLToPath(new URL('../../', import.meta.url));
  const relative = 'docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07';
  for (const changed of ['plan', 'code']) {
    const root = await mkdtemp(join(tmpdir(), 'f60-gate-')); t.after(() => rm(root, { recursive: true, force: true }));
    const base = join(root, relative); await mkdir(base, { recursive: true });
    for (const name of ['scripts', 'server']) await symlink(join(actualRoot, name), join(root, name), 'dir');
    for (const name of ['run-live.mjs', 'observation-plan.json']) await writeFile(join(base, name), await readFile(join(actualRoot, relative, name)));
    const allocation = JSON.parse(await readFile(join(actualRoot, relative, 'execution-plan.json')));
    if (changed === 'plan') allocation.planDigest = '0'.repeat(64);
    else allocation.codePins[Object.keys(allocation.codePins)[0]] = '0'.repeat(64);
    await writeFile(join(base, 'execution-plan.json'), JSON.stringify(allocation));
    await assert.rejects(promisify(execFile)(process.execPath, [join(base, 'run-live.mjs')], {
      env: { PATH: process.env.PATH, F60_OBSERVATION_SOURCE_GRANT: allocation.id }, timeout: 10000 }),
    (error) => error.stderr.includes(changed === 'plan' ? 'source-plan-date-mismatch' : 'source-code-pin-mismatch'));
    for (const name of ['execution-once.json', 'observer-checkpoint.json', 'source-events.jsonl']) await assert.rejects(readFile(join(base, name)), { code: 'ENOENT' });
  }
});
