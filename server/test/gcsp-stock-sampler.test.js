import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { sampleStockLocator, accumulatePage, createAggregate } from '../../scripts/gcsp/sample-stock-locator.mjs';

const script = new URL('../../scripts/gcsp/sample-stock-locator.mjs', import.meta.url);
const first = 'https://stock.bmw.co.uk/results?synthetic=one';
const more = 'https://stock.bmw.co.uk/results/more?synthetic=two';
const model = () => ({ modelLineId: 'synthetic-model', title: 'Synthetic model',
  colours: ['Black', 'White'], upholsteries: ['Cloth', 'Leather'], requests: [first] });
const plan = () => ({ kind: 'fixture', fixture: true, maxRequests: 400, concurrency: 1,
  retries: 0, models: [model()] });
const page = (location = [], finished = true) => new Response(JSON.stringify({ location, finished }),
  { headers: { 'content-type': 'application/json' } });
const syntheticCar = () => ({ colour: 'Black', upholstery_text: 'Cloth', visible_cash_price: '£42,500.50',
  lead_time_in_weeks_min: 3, lead_time_in_weeks_max: 6, confirmed_delivery_date_to: '2026-12-20',
  order_number: 'SYNTHETIC_PRIVATE_ORDER', vin: 'SYNTHETIC_PRIVATE_VIN', iv: 'SYNTHETIC_PRIVATE_IV',
  dealer_id: 'SYNTHETIC_PRIVATE_DEALER', image: 'https://private.invalid/image' });
async function ownedDirectory(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sampler-test-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const run = (options = {}) => sampleStockLocator({ plan: plan(), execute: true,
  fetchImpl: async () => page([syntheticCar()]), sampleDate: '2026-11-06', ...options });

test('offline default never calls transport or writes, even with output supplied', async () => {
  await ownedDirectory(async (dir) => {
    let calls = 0;
    const result = await sampleStockLocator({ plan: plan(), output: join(dir, 'result.json'),
      fetchImpl: async () => { calls++; throw Error('must not call'); } });
    assert.deepEqual(result, { status: 'offline' });
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('validates the complete plan before any request', async () => {
  const invalid = [undefined, {}, { ...plan(), maxRequests: 401 }, { ...plan(), concurrency: 2 },
    { ...plan(), retries: 1 }, { ...plan(), kind: 'accepted-f77', fixture: false },
    { ...plan(), models: [] }, { ...plan(), models: [model(), model()] }];
  for (const url of ['http://stock.bmw.co.uk/results', 'https://other.invalid/results',
    'https://stock.bmw.co.uk/vehicle/secret', 'https://user:secret@stock.bmw.co.uk/results',
    'https://stock.bmw.co.uk/results#secret']) {
    invalid.push({ ...plan(), models: [model(), { ...model(), modelLineId: 'second', requests: [url] }] });
  }
  invalid.push({ ...plan(), models: [{ ...model(), requests: Array(401).fill(first) }] });
  for (const candidate of invalid) {
    let calls = 0;
    await assert.rejects(run({ plan: candidate, fetchImpl: async () => { calls++; return page(); } }),
      /^Error: plan-invalid$/);
    assert.equal(calls, 0);
  }
});

test('fixture plans cannot use implicit live transport', async () => {
  await assert.rejects(run({ fetchImpl: undefined }), /^Error: plan-invalid$/);
});

test('execution needs literal true and validated request plan cannot mutate during sampling', async () => {
  let calls = 0;
  assert.deepEqual(await run({ execute: 'false', fetchImpl: async () => { calls++; return page(); } }),
    { status: 'offline' });
  assert.equal(calls, 0);
  const candidate = plan(); candidate.models[0].requests.push(more);
  const urls = [];
  const report = await run({ plan: candidate, fetchImpl: async (url) => {
    urls.push(url); candidate.models[0].requests[1] = 'https://other.invalid/private';
    candidate.models[0].title = 'PRIVATE_TITLE';
    return page([], urls.length === 2);
  } });
  assert.deepEqual(urls, [first, more]);
  assert.equal(report.models[0].title, 'Synthetic model');
});

test('parser rejects tampered aggregate state instead of retaining unknown fields', () => {
  for (const state of [{ ...createAggregate(model()), vin: 'PRIVATE' },
    { ...createAggregate(model()), priceBand: { min: null, max: null, currency: 'GBP', unknownCount: 0, vin: 'PRIVATE' } },
    { ...createAggregate(model()), colourShares: [{ label: 'PRIVATE', count: 1, share: 1 }] }]) {
    assert.throws(() => accumulatePage(state, { location: [], finished: true }, model()), /^Error: source-invalid$/);
  }
});

test('aggregate parser returns only reviewed dimensions and explicit unknown coverage', () => {
  const initial = createAggregate(model());
  const state = accumulatePage(initial, { location: [syntheticCar(), { colour: 'White',
    upholstery_type: 'Leather', visible_cash_price: 44000, lead_time_in_weeks_min: '4',
    lead_time_in_weeks_max: '8', confirmed_delivery_date_to: '2027-01-03' }, {}], finished: true }, model());
  assert.equal(initial.carCount, 0, 'parser is pure');
  assert.equal(state.carCount, 3);
  assert.deepEqual(state.leadTimeWeeks, { min: 3, max: 8, unknownCount: 1 });
  assert.deepEqual(state.deliveryDateSpread, { min: '2026-12-20', max: '2027-01-03', unknownCount: 1 });
  assert.deepEqual(state.priceBand, { min: 42500.5, max: 44000, currency: 'GBP', unknownCount: 1 });
  assert.deepEqual(state.colourShares, [{ label: 'Black', count: 1, share: 1 / 3 },
    { label: 'White', count: 1, share: 1 / 3 }]);
  assert.equal(state.unknownCounts.colour, 1);
  assert.equal(state.unknownCounts.upholstery, 1);
  const serialised = JSON.stringify(state);
  for (const forbidden of ['SYNTHETIC_PRIVATE', 'private.invalid', 'order_number', 'dealer_id', 'vin', 'image']) {
    assert.equal(serialised.includes(forbidden), false);
  }
});

test('successful complete sampling writes exactly one final aggregate file', async () => {
  await ownedDirectory(async (dir) => {
    const output = join(dir, 'stock-aggregates-2026-11-06.json');
    const result = await run({ output });
    assert.equal(result.sampleDate, '2026-11-06');
    assert.equal(result.requestCount, 1);
    assert.equal(result.evidenceKind, 'synthetic fixture');
    assert.equal(result.models[0].carCount, 1);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result);
    assert.deepEqual(await readdir(dir), ['stock-aggregates-2026-11-06.json']);
  });
});

test('report provenance is reproducible and model request counts exclude unused planned pages', async () => {
  const candidate = plan();
  candidate.models.push({ ...model(), modelLineId: 'synthetic-second', title: 'Synthetic second',
    requests: [first, more, `${more}&unused=true`] });
  let calls = 0;
  const report = await run({ plan: candidate, fetchImpl: async () => {
    calls++; return page([], calls !== 2);
  } });
  assert.equal(report.source, 'BMW UK new-car stock locator');
  assert.match(report.planDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.f77, null);
  assert.deepEqual(report.models.map(({ sampleDate, requestCount }) => ({ sampleDate, requestCount })),
    [{ sampleDate: '2026-11-06', requestCount: 1 }, { sampleDate: '2026-11-06', requestCount: 2 }]);
  assert.equal(report.requestCount, 3);
  const repeat = await run({ plan: candidate, fetchImpl: async () => page() });
  assert.equal(repeat.planDigest, report.planDigest);
  const changed = plan(); changed.models[0].requests[0] += '&reviewed=true';
  assert.notEqual((await run({ plan: changed })).planDigest, (await run()).planDigest);
  const text = JSON.stringify(report);
  assert.equal(text.includes('https://'), false);
  assert.equal(text.includes('requests'), false);
  assert.equal(text.includes('synthetic=one'), false);
});

test('400-page ceiling stays sequential and stops at each model finished marker', async () => {
  const candidate = plan(); candidate.models[0].requests = Array.from({ length: 400 }, (_, i) =>
    `https://stock.bmw.co.uk/results${i ? '/more' : ''}?synthetic=${i}`);
  let calls = 0; let active = 0; let peak = 0;
  const result = await run({ plan: candidate, fetchImpl: async (_, options) => {
    active++; peak = Math.max(peak, active); calls++;
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    await Promise.resolve(); active--;
    return page([], calls === 400);
  } });
  assert.equal(result.requestCount, 400);
  assert.equal(peak, 1);
  assert.equal(calls, 400);
  calls = 0;
  const short = await run({ plan: candidate, fetchImpl: async () => { calls++; return page(); } });
  assert.equal(short.requestCount, 1);
  assert.equal(calls, 1);
});

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} hard stop makes no later request or output`, async () => {
    await ownedDirectory(async (dir) => {
      const candidate = plan(); candidate.models[0].requests.push(more);
      let calls = 0;
      await assert.rejects(run({ plan: candidate, output: join(dir, 'result.json'),
        fetchImpl: async () => { calls++; return new Response('PRIVATE_BODY', { status }); } }),
      new RegExp(`^Error: source-stopped-${status}$`));
      assert.equal(calls, 1);
      assert.deepEqual(await readdir(dir), []);
    });
  });
}

test('incomplete pages, missing model coverage and fetch failure never publish partial data', async () => {
  for (const response of [() => page([], false), () => { throw Error('PRIVATE_EXCEPTION_URL'); },
    () => new Response('PRIVATE_INVALID_JSON', { headers: { 'content-type': 'application/json' } })]) {
    await ownedDirectory(async (dir) => {
      const output = join(dir, 'result.json');
      await writeFile(output, 'prior evidence');
      await assert.rejects(run({ output, fetchImpl: response }), (error) =>
        !error.message.includes('PRIVATE') && /^(sampling-incomplete|source-invalid|request-failed)$/.test(error.message));
      assert.equal(await readFile(output, 'utf8'), 'prior evidence');
      assert.deepEqual(await readdir(dir), ['result.json']);
    });
  }
  const candidate = plan(); candidate.models.push({ ...model(), modelLineId: 'second' });
  let calls = 0;
  await assert.rejects(run({ plan: candidate, fetchImpl: async () => { calls++;
    return calls === 1 ? page() : page([], false); } }), /^Error: sampling-incomplete$/);
});

test('malformed and hostile source dimensions fail without leaking their values', async () => {
  for (const car of [null, [], { colour: 'PRIVATE_VIN_1234567' }, { upholstery_text: 'https://private.invalid' },
    { upholstery_text: 0 }, { upholstery_text: false },
    { colour: 'Unreviewed label' }]) {
    await assert.rejects(run({ fetchImpl: async () => page([car]) }), /^Error: source-invalid$/);
  }
  for (const data of [{ location: {}, finished: true }, { location: [], finished: 'true' }]) {
    await assert.rejects(run({ fetchImpl: async () => new Response(JSON.stringify(data),
      { headers: { 'content-type': 'application/json' } }) }), /^Error: source-invalid$/);
  }
  const result = await run({ fetchImpl: async () => page([{ visible_cash_price: 'secret 1234567',
    lead_time_in_weeks_min: -1, lead_time_in_weeks_max: Infinity, confirmed_delivery_date_to: '2026-02-30' }]) });
  assert.equal(result.models[0].priceBand.unknownCount, 1);
  assert.equal(result.models[0].deliveryDateSpread.unknownCount, 1);
  assert.equal(result.models[0].leadTimeWeeks.unknownCount, 1);
});

test('transport bounds body size, redirects, content type and time without output', async () => {
  for (const response of [() => new Response('x'.repeat(1024 * 1024 + 1),
    { headers: { 'content-type': 'application/json' } }), () => new Response('', { status: 302 }),
    () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    () => new Promise(() => {})]) {
    await assert.rejects(run({ fetchImpl: response, requestTimeoutMs: 10 }),
      /^(Error: (response-too-large|redirect-refused|source-invalid|request-timeout))$/);
  }
});

test('failed final write returns generic error and leaves no temporary artifact', async () => {
  await ownedDirectory(async (dir) => {
    await assert.rejects(run({ output: join(dir, 'missing', 'result.json') }), /^Error: output-failed$/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('real CLI is offline by default and requires persisted non-fixture authority to execute', async () => {
  await ownedDirectory(async (dir) => {
    const invoke = (args) => spawnSync(process.execPath, [script.pathname, ...args],
      { encoding: 'utf8', timeout: 3000, env: process.env });
    const output = join(dir, 'output.json');
    assert.equal(invoke(['--output', output]).status, 0);
    for (const args of [['--execute'], ['--execute', '--output', output],
      ['--execute', '--plan', join(dir, 'absent.json'), '--output', output]]) {
      const result = invoke(args); assert.equal(result.status, 1);
      assert.match(result.stderr, /^plan-invalid\n$/);
    }
    const fixture = join(dir, 'fixture.json'); await writeFile(fixture, JSON.stringify(plan()));
    const rejected = invoke(['--execute', '--plan', fixture, '--output', output]);
    assert.equal(rejected.status, 1);
    assert.equal(rejected.stderr, 'plan-invalid\n');
    assert.deepEqual(await readdir(dir), ['fixture.json']);
  });
});
