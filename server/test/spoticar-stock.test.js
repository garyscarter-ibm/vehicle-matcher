import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpoticarClient, SpoticarUnavailableError } from '../spoticar-stock.js';

const row = (n, overrides = {}) => ({
  vin: `TESTVIN${n}`, dealer_code: 'D1', make: 'RAM', model: '1500',
  internetprice: 30000, miles: 10000, year: 2024, vehicle_type_flag: 'cpo', ...overrides,
});
const json = (value, headers = {}) => ({ status: 200, headers, body: JSON.stringify(value) });
const bootstrap = () => ({
  status: 200, headers: { 'set-cookie': ['XSRF-TOKEN=visitor-csrf; Path=/', 'session=first; HttpOnly; Path=/'] },
  body: '<meta content="csrf-test" name="csrf-token"><meta name="web-token" content="bearer-test">',
});
const dealerResponse = () => json({ success: true, data: [{ dealer_code: 'D1' }, { dealer_code: 'D2' }] }, {
  'set-cookie': ['session=rotated; HttpOnly; Path=/'],
});
const filterResponse = () => json({ success: true, data: { sniFilter: {
  priceRange: { min: 0, max: 100000 }, milesRange: { min: 0, max: 500000 },
  yearRange: { min: 2015, max: 2027 },
} } });
const pageResponse = (rows, total = rows.length) => json({ success: true, sniData: rows, total });

function harness(pages = [pageResponse([row(1)])], overrides = {}) {
  const calls = [];
  const pauses = [];
  let pageIndex = 0;
  const transport = async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'GET') return bootstrap();
    if (url.endsWith('/api/zipcode')) return dealerResponse();
    if (url.endsWith('/api/sni')) return filterResponse();
    return pages[pageIndex++];
  };
  const client = createSpoticarClient({
    transport, pause: async (ms) => { pauses.push(ms); }, ...overrides,
  });
  return { client, calls, pauses };
}

test('cold visitor setup sends encoded national dealer/filter contract and rotates cookies', async () => {
  const { client, calls, pauses } = harness([
    pageResponse([row(1), row(2)], 3), pageResponse([row(3)], 3),
  ]);
  const cars = await client.fetchStock();
  assert.equal(cars.length, 3);
  assert.equal(calls.length, 5);
  assert.deepEqual(pauses, [500, 500, 500, 500]);
  assert.equal(calls[0].headers.Cookie, undefined);
  const zip = new URLSearchParams(calls[1].body);
  assert.equal(zip.get('zipcode'), '12345');
  assert.equal(zip.get('radius[max]'), '3000');
  assert.equal(zip.get('pagename'), 'sni');
  const sni = new URLSearchParams(calls[2].body);
  assert.equal(sni.get('recordType'), 'filter');
  assert.equal(sni.get('sortBy'), 'internetprice_asc');
  assert.deepEqual(sni.getAll('dealerCode[]'), ['D1', 'D2']);
  const list = new URLSearchParams(calls[3].body);
  assert.deepEqual(list.getAll('brand[]'), ['RAM']);
  assert.deepEqual(list.getAll('vehicleType[]'), ['cpo']);
  assert.deepEqual(list.getAll('dealerCode[]'), ['D1', 'D2']);
  assert.equal(list.get('mileages[max]'), '500000');
  assert.equal(list.get('page'), '1');
  assert.equal(list.get('sortBy'), 'internetprice_asc');
  assert.equal(new URLSearchParams(calls[4].body).get('page'), '2');
  assert.equal(calls[1].headers['X-CSRF-TOKEN'], 'csrf-test');
  assert.equal(calls[1].headers.Authorization, 'Bearer bearer-test');
  assert.match(calls[2].headers.Cookie, /session=rotated/);
  assert.doesNotMatch(calls[2].headers.Cookie, /session=first|HttpOnly|Path/);
  assert.equal(calls[3].headers['Content-Length'], Buffer.byteLength(calls[3].body));
  assert.equal(calls[3].maxBytes, 8 * 1024 * 1024);
  assert.ok(calls[3].timeoutMs > 0 && calls[3].timeoutMs <= 35000);
});

test('complete raw coverage applies strict actual CPO RAM pickup mapping', async () => {
  const { client } = harness([pageResponse([
    row(1), row(2, { vehicle_type_flag: 'cpo-go' }), row(3, { model: 'ProMaster' }),
    row(4, { make: 'JEEP' }), row(5, { internetprice: 0 }), row(6, { model: '3500' }),
  ])]);
  assert.deepEqual((await client.fetchStock()).map((car) => car.id), ['TESTVIN1_D1', 'TESTVIN6_D1']);
});

test('genuine empty inventory returns empty only with explicit zero total and empty rows', async () => {
  assert.deepEqual(await harness([pageResponse([], 0)]).client.fetchStock(), []);
  await assert.rejects(harness([pageResponse([], 5)]).client.fetchStock(), /page bound/);
});

test('changing total, short pages and missing identity fail closed', async () => {
  for (const pages of [
    [pageResponse([row(1), row(2)], 3), pageResponse([row(3)], 4)],
    [pageResponse([row(1), row(2)], 4), pageResponse([row(3)], 4)],
    [pageResponse([row(1, { vin: '' })])],
    [json({ success: true, sniData: [], total: '0' })],
  ]) await assert.rejects(harness(pages).client.fetchStock(), SpoticarUnavailableError);
});

test('partial source overlaps are deduplicated after traversing every declared page', async () => {
  const { client, calls } = harness([
    pageResponse([row(1), row(2)], 5),
    pageResponse([row(2), row(3)], 5),
    pageResponse([row(4)], 5),
  ]);
  assert.deepEqual((await client.fetchStock()).map((car) => car.id), [
    'TESTVIN1_D1', 'TESTVIN2_D1', 'TESTVIN3_D1', 'TESTVIN4_D1',
  ]);
  assert.deepEqual(calls.filter((call) => call.url.endsWith('/sniLoadMore'))
    .map((call) => new URLSearchParams(call.body).get('page')), ['1', '2', '3']);
});

test('a repeated entire page is rejected even if source reorders its rows', async () => {
  const { client } = harness([
    pageResponse([row(1), row(2)], 4), pageResponse([row(2), row(1)], 4),
  ]);
  await assert.rejects(client.fetchStock(), /repeated inventory page/);
});

test('a page assembled entirely from earlier identities cannot silently stall traversal', async () => {
  const { client } = harness([
    pageResponse([row(1), row(2)], 6), pageResponse([row(3), row(4)], 6),
    pageResponse([row(1), row(3)], 6),
  ]);
  await assert.rejects(client.fetchStock(), /page added no new listings/);
});

test('page ceiling rejects complete delivery that cannot fit without silently returning a sample', async () => {
  const { client, calls } = harness([pageResponse([row(1)], 3)], { maxPages: 2 });
  await assert.rejects(client.fetchStock(), /page bound/);
  assert.equal(calls.length, 4);
});

test('each authorization status gets at most one fresh bootstrap and restarted walk', async () => {
  for (const status of [401, 403, 419]) {
    let gets = 0;
    let searches = 0;
    const client = createSpoticarClient({ pause: async () => {}, transport: async (url, options) => {
      if (options.method === 'GET') { gets += 1; return bootstrap(); }
      if (url.endsWith('/api/zipcode')) return dealerResponse();
      if (url.endsWith('/api/sni')) return filterResponse();
      searches += 1;
      return searches === 1 ? { status, headers: {}, body: 'private body' } : pageResponse([row(1)]);
    } });
    assert.equal((await client.fetchStock()).length, 1);
    assert.equal(gets, 2);
    assert.equal(searches, 2);
  }
});

test('repeated authorization refusal stops after one restart without leaking response content', async () => {
  let gets = 0;
  const client = createSpoticarClient({ pause: async () => {}, transport: async (url, options) => {
    if (options.method === 'GET') { gets += 1; return bootstrap(); }
    return { status: 403, headers: {}, body: 'private-secret-content' };
  } });
  await assert.rejects(client.fetchStock(), (error) => {
    assert.equal(error.upstreamStatus, 403);
    assert.doesNotMatch(error.message, /private-secret|csrf-test|bearer-test/);
    return true;
  });
  assert.equal(gets, 2);
});

test('transport errors and invalid JSON are redacted and not retried', async () => {
  const client = createSpoticarClient({ transport: async () => { throw new Error('Authorization: secret-token'); } });
  await assert.rejects(client.fetchStock(), { message: 'RAM inventory unavailable: transport failed' });
  const { client: malformed } = harness([{ status: 200, headers: {}, body: 'not-json secret-token' }]);
  await assert.rejects(malformed.fetchStock(), { message: 'RAM inventory unavailable: invalid JSON' });
  const { client: refused, calls } = harness([{ status: 422, headers: {}, body: 'secret-token' }]);
  await assert.rejects(refused.fetchStock(), /upstream HTTP failure/);
  assert.equal(calls.length, 4);
});

test('missing bootstrap metadata, invalid ranges, dealer coverage and oversized bodies fail closed', async () => {
  for (const broken of [
    { path: 'GET', response: { status: 200, headers: {}, body: '<html>no metadata</html>' } },
    { path: '/api/zipcode', response: json({ success: true, data: [] }) },
    { path: '/api/sni', response: json({ success: true, data: { sniFilter: {} } }) },
  ]) {
    const client = createSpoticarClient({ pause: async () => {}, transport: async (url, options) => {
      if (broken.path === 'GET' && options.method === 'GET') return broken.response;
      if (url.endsWith(broken.path)) return broken.response;
      if (options.method === 'GET') return bootstrap();
      if (url.endsWith('/api/zipcode')) return dealerResponse();
      return filterResponse();
    } });
    await assert.rejects(client.fetchStock(), SpoticarUnavailableError);
  }
  await assert.rejects(harness([], { maxBytes: 1 }).client.fetchStock(), /invalid response body/);
});
